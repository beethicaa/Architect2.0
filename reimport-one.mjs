/*
 * Re-import one repository into one project, by explicit id.
 *
 * Why this exists, and why it is safe now.
 *
 * Every previous attempt to repair an import used a PostgREST filter like
 * `repo_full_name.eq.<repo>` to find the project. **That filter matches rows
 * where the column is NULL**, so it twice selected a project that had nothing to
 * do with the repository and wrote the wrong code into it. This script takes the
 * project id as an argument and reads the whole table, filtering in memory, so
 * that class of accident cannot happen here.
 *
 * It writes the same rows the product's own import writes, through the same
 * batched upsert, and it never deletes: a file the repository no longer has will
 * linger rather than an interrupted copy leaving an empty project.
 *
 * Usage:  node --experimental-strip-types reimport-one.mjs <projectId> <owner/repo>
 */
import { readFileSync } from "node:fs";

const [projectId, repo] = process.argv.slice(2);
if (!projectId || !repo) {
  console.log("usage: node --experimental-strip-types reimport-one.mjs <projectId> <owner/repo>");
  process.exit(1);
}

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const REST = env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/";
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
  "Content-Type": "application/json",
};

// Read the whole table, filter here. Never `.eq()` a nullable column.
const projects = await (await fetch(REST + "projects?select=id,name,repo_full_name", { headers: H })).json();
const project = projects.find((p) => p.id === projectId);
if (!project) {
  console.log("no project with id " + projectId + " — nothing to do");
  process.exit(1);
}
console.log("target: " + project.name + "  (" + project.id + ")  repo=" + project.repo_full_name);
if (project.repo_full_name !== repo) {
  console.log("STOPPING: that project is bound to " + project.repo_full_name + ", not " + repo);
  process.exit(1);
}

const connection = (
  await (await fetch(REST + "github_connections?select=access_token,login&limit=1", { headers: H })).json()
)[0];
if (!connection) {
  console.log("no stored GitHub connection");
  process.exit(1);
}
const gh = {
  Authorization: "Bearer " + connection.access_token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const { planImport } = await import("./lib/github/import-plan.ts");

const tree = await (
  await fetch(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { headers: gh })
).json();
if (!tree.tree) {
  console.log("could not read the tree");
  process.exit(1);
}

const plan = planImport(tree.tree);
console.log("plan: " + plan.paths.length + " files\n");

// Read, with a small pace so a burst does not trip the secondary limit.
const fetched = [];
const failures = [];
for (const path of plan.paths) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=HEAD`,
    { headers: gh },
  );
  if (!response.ok) {
    failures.push(path + " (" + response.status + ")");
    continue;
  }
  const body = await response.json();
  fetched.push({ path, content: Buffer.from(body.content, "base64").toString("utf8") });
  if (fetched.length % 8 === 0) await new Promise((r) => setTimeout(r, 200));
}
console.log("read " + fetched.length + "  failed " + failures.length);

// One batched upsert, mirroring writeManyFilesToProject.
const before = await (
  await fetch(REST + "project_files?select=path&project_id.eq." + projectId, { headers: H })
).json();
const prior = new Map(before.map((r) => [r.path, r]));

const rows = fetched.map((f) => {
  const existed = prior.has(f.path);
  return {
    project_id: projectId,
    path: f.path,
    content: f.content,
    language: f.path.endsWith(".tsx") ? "tsx" : f.path.endsWith(".ts") ? "ts" : "text",
    prev_lines: 0,
    version: existed ? 2 : 1,
  };
});

const response = await fetch(REST + "project_files?on_conflict=project_id,path", {
  method: "POST",
  // PostgREST only performs an upsert when this header is present. Without it a
  // POST that collides with an existing row is a plain 409, which is why
  // re-importing into a project that already had files failed wholesale.
  headers: { ...H, Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(rows),
});
if (!response.ok) {
  console.log("write failed: " + response.status + "  " + (await response.text()).slice(0, 200));
  process.exit(1);
}

const after = await (
  await fetch(REST + "project_files?select=path&project_id.eq." + projectId, { headers: H })
).json();
console.log("workspace now holds " + after.length + " files");

const has = (p) => after.some((f) => f.path === p);
console.log("  frontend/src/App.tsx  " + (has("frontend/src/App.tsx") ? "present" : "MISSING"));
console.log("  frontend/index.html   " + (has("frontend/index.html") ? "present" : "MISSING"));