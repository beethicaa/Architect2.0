/*
 * Verify that a named project compiles and actually renders.
 *
 * Read-only: it fetches the project's files, compiles them with the product's own
 * compilePreview, executes the resulting document in a DOM, and reports what
 * appeared. It writes nothing, and it resolves the project by reading the list
 * and filtering in memory — a PostgREST `eq` filter on a nullable column matches
 * NULL rows, which is what caused two data incidents.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const target = process.argv[2] ?? "beethicaa/FrameWork";

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

const projects = await (
  await fetch(REST + "projects?select=id,name,origin,repo_full_name", { headers: H })
).json();

const match = projects.find(
  (p) => p.origin === "import" && p.repo_full_name === target,
);
if (!match) {
  console.log("no import project for " + target);
  process.exit(1);
}

const rows = await (
  await fetch(REST + "project_files?select=path,content&project_id.eq." + match.id, {
    headers: H,
  })
).json();
const files = rows.map((f) => ({ path: f.path, content: f.content }));

console.log(match.name + "  (" + match.id.slice(0, 8) + ")");
console.log("  files in the workspace: " + files.length + "\n");

const { compilePreview, findEntry } = await import("./lib/agent/preview.ts");
const entry = findEntry(files);
console.log("  entry: " + (entry ? entry.path : "NOT FOUND"));

const result = await compilePreview(files);
console.log("  compile: ok=" + result.ok + "  bundled=" + result.included.length + "  missing=" + result.missing.length);
if (result.error) {
  console.log("  notes: " + result.error.split("\n")[0].slice(0, 130));
}

if (!result.ok) {
  process.exit(1);
}

const dom = new JSDOM(result.html, {
  runScripts: "dangerously",
  url: "https://preview.test",
  pretendToBeVisual: true,
});
dom.window.fetch = async () => {
  throw new Error("no backend in the preview");
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
await new Promise((r) => setTimeout(r, 2000));

const root = dom.window.document.getElementById("root");
const text = root ? root.textContent.replace(/\s+/g, " ").trim() : "";
console.log("\n  RENDERED");
console.log("    root children: " + (root ? root.childElementCount : "NONE"));
console.log("    stub placeholders: " + dom.window.document.querySelectorAll("[data-architect-missing]").length);
console.log("    text: " + (text.slice(0, 300) || "(empty)"));