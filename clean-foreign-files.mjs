/*
 * Remove repository files that were written into the wrong project.
 *
 * A dev script filtered projects with `repo_full_name.eq.<repo>`, and PostgREST
 * matches NULL rows against that filter — so it selected a *prompt* project and
 * wrote another repository's source into it, after clearing what was there. The
 * files to remove are therefore exactly the ones whose paths belong to a
 * different repository, and nothing else.
 *
 * Safety, in order:
 *   1. The project list is read whole and filtered in memory, never with a
 *      PostgREST `eq` filter on a nullable column. That filter is the bug.
 *   2. Nothing is deleted unless every file in the project is accounted for as
 *      either a foreign-repository path or a project the user is told about.
 *   3. Deletes go by primary key, one at a time, because a filtered DELETE
 *      reports success while matching nothing.
 *   4. The result is verified by re-reading.
 *
 * Usage:  node --experimental-strip-types clean-foreign-files.mjs <projectId>
 */
import { readFileSync } from "node:fs";

const projectId = process.argv[2];
if (!projectId) {
  console.log("usage: node --experimental-strip-types clean-foreign-files.mjs <projectId>");
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

// Read the whole table and filter here. A `.eq()` on a nullable column is the
// exact mistake that caused this.
const all = await (await fetch(REST + "projects?select=id,name,origin,repo_full_name", { headers: H })).json();
const project = all.find((p) => p.id === projectId);
if (!project) {
  console.log("no such project: " + projectId);
  process.exit(1);
}

const rows = await (
  await fetch(REST + "project_files?select=id,path,content&project_id.eq." + projectId, { headers: H })
).json();

console.log(project.name + "  (" + projectId + ")  origin=" + project.origin);
console.log("  " + rows.length + " files\n");

// Identifying a foreign file by path alone is not enough, and the first version
// of this check stopped on three stragglers: two `package.json` and a
// `render.yaml`, all sitting at the repository root where a workspace-prefix
// pattern cannot see them. Both manifests are `framework-ai`, and render.yaml is
// a deployment config — all of them another repository's.
//
// So a root-level file is foreign when its content belongs to a different
// project: a manifest whose `name` is not this project's, or any file that a
// repository import would have written. A prompt-built project has no
// `render.yaml` and no `framework-ai` manifest, so nothing of its own is at risk.
const FOREIGN_ROOTS = /^(client|frontend|backend|apps|packages|web|server)\//;

function looksForeign(row) {
  if (FOREIGN_ROOTS.test(row.path)) return true;
  if (/^package\.json$/.test(row.path)) {
    try {
      return JSON.parse(row.content).name !== "architect-prompt";
    } catch {
      return true;
    }
  }
  // Deploy and workspace config only ever comes from a repository.
  return /^(render\.yaml|vercel\.json|netlify\.toml|docker-compose\.ya?ml)$/.test(row.path);
}

const foreign = rows.filter(looksForeign);
const local = rows.filter((r) => !looksForeign(r));

console.log("  foreign (another repo's source): " + foreign.length);
console.log("  local (this project's own):     " + local.length);
if (local.length > 0) {
  console.log("\n  NOT deleting these, they look like they belong here:");
  for (const r of local.slice(0, 10)) console.log("    " + r.path);
  console.log("\n  stopping: this project has files of its own.");
  process.exit(1);
}

let removed = 0;
for (const row of foreign) {
  const response = await fetch(REST + "project_files?id=eq." + row.id, {
    method: "DELETE",
    headers: H,
  });
  if (response.ok) removed += 1;
  else console.log("  failed " + row.path + ": " + response.status);
}

const after = await (
  await fetch(REST + "project_files?select=id&project_id.eq." + projectId, { headers: H })
).json();

console.log("\n  removed " + removed + " of " + foreign.length);
console.log("  files remaining: " + after.length);