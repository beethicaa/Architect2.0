/*
 * Dry-run the import + preview pipeline against every repository the user can
 * reach, without writing anything to the database.
 *
 * Why this exists: every fix in this area so far was driven by one repository
 * (Flow-State), one failure at a time. That is a slow way to find out whether a
 * problem is a bug or a property of that repo. This walks the whole catalogue and
 * reports, per repo: how many files would be imported, whether the preview can
 * find an entry point, and what the compile says. Read-only by construction —
 * it calls planImport and compilePreview, never an import or a write.
 */
import { readFileSync } from "node:fs";
import { planImport } from "./lib/github/import-plan.ts";
import { compilePreview, findEntry, findEntryFallback } from "./lib/agent/preview.ts";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
};
const REST = env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/";
const conn = (
  await (
    await fetch(REST + "github_connections?select=access_token,login&limit=1", { headers: H })
  ).json()
)[0];

if (!conn) {
  console.log("No GitHub connection stored.");
  process.exit(0);
}

const gh = {
  Authorization: "Bearer " + conn.access_token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const repos = await (
  await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", { headers: gh })
).json();

if (!Array.isArray(repos)) {
  console.log("Could not list repos: " + JSON.stringify(repos).slice(0, 200));
  process.exit(0);
}

console.log(`dry run over ${repos.length} repositories (nothing is written)\n`);

const rows = [];
for (const repo of repos) {
  const treeRes = await fetch(
    `https://api.github.com/repos/${repo.full_name}/git/trees/HEAD?recursive=1`,
    { headers: gh },
  );
  const tree = await treeRes.json();

  if (!tree.tree) {
    rows.push({ name: repo.full_name, lang: repo.language ?? "-", status: `unreadable (${treeRes.status})` });
    continue;
  }

  const blobs = tree.tree.filter((e) => e.type === "blob");
  const plan = planImport(blobs);

  if (plan.paths.length === 0) {
    rows.push({
      name: repo.full_name,
      lang: repo.language ?? "-",
      status: `no source (${plan.skipped.length} non-code files)`,
    });
    continue;
  }

  // Read the planned files, capped so a large repo does not take forever.
  const toRead = plan.paths;
  const files = [];
  for (const path of toRead) {
    const f = await (
      await fetch(
        `https://api.github.com/repos/${repo.full_name}/contents/${path}?ref=HEAD`,
        { headers: gh },
      )
    ).json();
    if (!f.content) continue;
    files.push({
      path,
      content: Buffer.from(f.content, "base64").toString("utf8"),
      language: path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : "text",
    });
  }

  const entry = findEntry(files) ?? findEntryFallback(files);
  if (!entry) {
    rows.push({
      name: repo.full_name,
      lang: repo.language ?? "-",
      status: `no entry point (${files.length} files read)`,
    });
    continue;
  }

  const result = await compilePreview(files);
  const notes = result.error ? result.error.split("\n").length : 0;
  const first = (result.error ?? "").split("\n").join(" | ").slice(0, 220) ?? "";

  rows.push({
    name: repo.full_name,
    lang: repo.language ?? "-",
    status: result.ok
      ? `ok  ${result.included.length} bundled, ${notes} note(s) :: ${first}`
      : `COMPILE FAILED - ${first.slice(0, 70)}`,
  });
}

for (const row of rows) {
  const flag = row.status.startsWith("COMPILE") || row.status.startsWith("no entry")
    ? "!!"
    : row.status.startsWith("ok")
      ? "  "
      : "--";
  console.log(`${flag} ${row.name.padEnd(42)} ${String(row.lang).padEnd(12)} ${row.status}`);
}

const good = rows.filter((r) => r.status.startsWith("ok")).length;
const noEntry = rows.filter((r) => r.status.startsWith("no entry")).length;
const failed = rows.filter((r) => r.status.startsWith("COMPILE")).length;
const other = rows.length - good - noEntry - failed;
console.log(
  `\n${good} render, ${noEntry} no entry point, ${failed} compile failure, ${other} no source / unreadable`,
);