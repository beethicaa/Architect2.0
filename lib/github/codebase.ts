/**
 * Which files to copy into the workspace when a repository is imported.
 *
 * This is a separate module with no imports, for two reasons.
 *
 * The first is that it is the logic worth asserting. Importing a repository used
 * to create a project with **zero files** and then ask a model to "continue
 * working inside" it; with an empty workspace the only coherent thing a model can
 * do is build something unrelated, which is how a Kaggle Black Friday sales
 * repository came back as a travel planner. A pure function is the only version of
 * that rule that can be checked by `npm run env:check` without a network call.
 *
 * The second is that inlining it into `codebase.ts` would drag the GitHub client,
 * and through it `next/headers` and the Supabase server client, into anything
 * that merely wants to test the file selection.
 *
 * Two constraints:
 *
 *   1. Bound the work. A free-tier build cannot ingest a large repository, and a
 *      partially copied repo is worse than a small honest one, so we cap by file
 *      count *and* total bytes, and report when we trim.
 *   2. Skip what the preview could never run. It bundles React and compiles TSX;
 *      a notebook or a 40MB data file would be dead weight in the workspace and
 *      would make every later agent request more expensive.
 */

/**
 * The import planner moved to `import-plan.ts`.
 *
 * It used to live here, and for most of this session two copies existed: this one
 * (40 files / 220KB, sorted largest-first) and the rewrite beside it (400 files /
 * 2MB, ranked by role). The import action imported *this* one, so every fix to the
 * ranking and the budget changed a function nothing called and the symptom stayed
 * exactly "kept 9 of 81 files" through five rounds of wrong diagnosis.
 *
 * Re-exported so an existing `from "@/lib/github/codebase"` import keeps working
 * and there is only ever one implementation to reason about.
 */
export { planImport } from "@/lib/github/import-plan";
export type { ImportPlan } from "@/lib/github/import-plan";


/**
 * Static analysis of an imported repository.
 *
 * The brief is specific: "real static analysis: file tree, key entry points,
 * detected framework/stack", summarised for the user before any generation
 * happens. So this is computed from the actual file tree and the actual manifest
 * contents — not guessed from GitHub's `language` field, which is derived from a
 * byte heuristic and is frequently wrong.
 *
 * It runs before the agents do, so the Planner and Researcher start from facts
 * about the codebase rather than from a blank slate.
 */

import { readFile, readTree, type RepoTree } from "@/lib/github/client";
import type { GitHubCredentials } from "@/lib/github/store";

export interface DetectedStack {
  framework: string;
  evidence: string[];
}

export interface CodebaseMap {
  framework: string;
  /** Plain language, for Simple mode. */
  summary: string;
  /** Technical, for Developer mode. */
  detail: string;
  fileCount: number;
  entryPoints: string[];
  directories: string[];
  dependencies: string[];
  /** True when GitHub truncated the tree — the picture is partial. */
  truncated: boolean;
  warnings: string[];
}

const MANIFESTS: { path: string; ecosystem: string }[] = [
  { path: "package.json", ecosystem: "node" },
  { path: "requirements.txt", ecosystem: "python" },
  { path: "pyproject.toml", ecosystem: "python" },
  { path: "go.mod", ecosystem: "go" },
  { path: "Cargo.toml", ecosystem: "rust" },
  { path: "Gemfile", ecosystem: "ruby" },
  { path: "composer.json", ecosystem: "php" },
  { path: "pubspec.yaml", ecosystem: "flutter" },
];

/** Files worth reading to answer "what is this app". */
const ENTRY_CANDIDATES = [
  /^app\/page\.[jt]sx?$/,
  /^pages\/index\.[jt]sx?$/,
  /^src\/main\.[jt]sx?$/,
  /^src\/index\.[jt]sx?$/,
  /^src\/App\.[jt]sx?$/,
  /^main\.[jt]sx?$/,
  /^index\.[jt]sx?$/,
  /^cmd\/[^/]+\/main\.go$/,
  /^src\/main\.py$/,
  /^manage\.py$/,
  /^server\.[jt]s$/,
  /^index\.html$/,
];

/** Directories that are noise in a summary. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "coverage",
  ".git",
  "__pycache__",
]);

export async function mapCodebase(
  credentials: GitHubCredentials,
  repo: string,
  branch: string,
): Promise<{ map: CodebaseMap | null; error: string | null }> {
  const { tree, truncated, error } = await readTree(credentials, repo, branch);
  if (error) return { map: null, error };

  const blobs = tree.filter((entry) => entry.type === "blob");
  const warnings: string[] = [];

  if (truncated) {
    // Said out loud rather than swallowed: a partial picture presented as a
    // complete one is a lie, and the user is about to be shown this summary.
    warnings.push(
      "This repository is large, so GitHub returned only part of its file tree. The summary below is partial.",
    );
  }

  const paths = blobs.map((entry) => entry.path);
  const entryPoints = paths
    .filter((path) => ENTRY_CANDIDATES.some((pattern) => pattern.test(path)))
    .slice(0, 8);
  const directories = topLevelDirectories(blobs);

  const manifest = MANIFESTS.find((entry) => paths.includes(entry.path));

  let dependencies: string[] = [];
  let detected = detectFromLayout(paths, manifest?.ecosystem);

  if (!detected && manifest) {
    // Reading the manifest is what makes detection real. A repo with a
    // `requirements.txt` and no recognisable framework is common, and naming it
    // wrong would poison every agent that reads this.
    const read = await readFile(credentials, repo, manifest.path, branch);
    if (read.content) {
      dependencies = parseDependencies(read.content, manifest.ecosystem);
      detected = detectFromDependencies(dependencies);
    }
  }

  const stack: DetectedStack = detected ?? {
    framework: manifest?.ecosystem === "node" ? "Node.js" : (manifest?.ecosystem ?? "Unknown"),
    evidence: manifest ? [`found ${manifest.path}`] : [],
  };

  const screens = paths.filter((path) => /(^|\/)page\.[jt]sx?$/.test(path)).length;

  const summary =
    `This is a ${stack.framework} app with about ${blobs.length} files` +
    (screens > 0
      ? ` and ${screens} screen${screens === 1 ? "" : "s"}${entryPoints.length > 0 ? `, starting at ${entryPoints[0]}` : ""}`
      : "") +
    "." +
    (directories.length > 0 ? ` The main parts are ${directories.slice(0, 3).join(", ")}.` : "");

  const detail = [
    `Detected: ${stack.framework}`,
    stack.evidence.length > 0 ? `Evidence: ${stack.evidence.join("; ")}` : null,
    `Files: ${blobs.length}`,
    `Entry points: ${entryPoints.length > 0 ? entryPoints.join(", ") : "none recognised"}`,
    `Top-level directories: ${directories.join(", ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    map: {
      framework: stack.framework,
      summary,
      detail,
      fileCount: blobs.length,
      entryPoints,
      directories,
      dependencies: dependencies.slice(0, 25),
      truncated,
      warnings,
    },
    error: null,
  };
}

function topLevelDirectories(blobs: RepoTree[]): string[] {
  const seen = new Set<string>();
  for (const blob of blobs) {
    const slash = blob.path.indexOf("/");
    if (slash > 0) {
      const top = blob.path.slice(0, slash);
      if (!IGNORED_DIRS.has(top)) seen.add(top);
    }
  }
  return [...seen].slice(0, 12);
}

/**
 * Framework detection from file layout.
 *
 * A file path is stronger evidence than a manifest dependency here: a repo can
 * depend on Next without using it (as a build tool, or transitively), but a file
 * at `next.config.js` is the framework's own configuration.
 */
function detectFromLayout(
  paths: string[],
  ecosystem: string | undefined,
): DetectedStack | null {
  const has = (candidate: string) => paths.includes(candidate);

  if (has("next.config.js") || has("next.config.mjs") || paths.some((p) => p.startsWith("app/"))) {
    return { framework: "Next.js", evidence: ["app/ directory or next.config"] };
  }
  if (has("vite.config.ts") || has("vite.config.js")) {
    return { framework: "Vite", evidence: ["vite.config"] };
  }
  if (has("svelte.config.js")) return { framework: "Svelte", evidence: ["svelte.config.js"] };
  if (has("nuxt.config.ts")) return { framework: "Nuxt", evidence: ["nuxt.config.ts"] };
  if (has("angular.json")) return { framework: "Angular", evidence: ["angular.json"] };
  if (has("manage.py")) return { framework: "Django", evidence: ["manage.py"] };
  if (has("Cargo.toml")) return { framework: "Rust", evidence: ["Cargo.toml"] };
  if (has("go.mod")) return { framework: "Go", evidence: ["go.mod"] };
  if (paths.some((p) => p.startsWith("app/") && p.endsWith(".py"))) {
    return { framework: "Flask or FastAPI", evidence: ["python app/ package"] };
  }

  if (ecosystem === "node") return { framework: "Node.js", evidence: ["package.json"] };
  return null;
}

function detectFromDependencies(dependencies: string[]): DetectedStack | null {
  const lower = dependencies.map((dep) => dep.toLowerCase());
  const has = (name: string) =>
    lower.some(
      (dep) => dep === name || dep.startsWith(`${name}-`) || dep.startsWith(`@${name}/`),
    );

  if (has("next")) return { framework: "Next.js", evidence: ["next in the manifest"] };
  if (has("nuxt")) return { framework: "Nuxt", evidence: ["nuxt in the manifest"] };
  if (has("svelte")) return { framework: "Svelte", evidence: ["svelte in the manifest"] };
  if (has("vue")) return { framework: "Vue", evidence: ["vue in the manifest"] };
  if (has("angular")) return { framework: "Angular", evidence: ["angular in the manifest"] };
  if (has("react")) return { framework: "React", evidence: ["react in the manifest"] };
  if (has("express") || has("fastify")) {
    return { framework: "Node server", evidence: ["express or fastify"] };
  }
  if (has("django")) return { framework: "Django", evidence: ["django in requirements"] };
  if (has("flask")) return { framework: "Flask", evidence: ["flask in requirements"] };
  if (has("fastapi")) return { framework: "FastAPI", evidence: ["fastapi in requirements"] };
  return null;
}

/**
 * Best-effort dependency names, per ecosystem. Never throws.
 *
 * The Node branch reads the dependencies block with a regex rather than
 * `JSON.parse`, because a manifest with a trailing comma or a comment should
 * still yield something useful instead of failing inside an analysis step.
 */
function parseDependencies(content: string, ecosystem: string): string[] {
  if (ecosystem === "python") {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && /^[a-zA-Z0-9]/.test(line))
      .map((line) => line.split(/[<>=[\s]/)[0])
      .filter(Boolean);
  }

  const block = /"dependencies"\s*:\s*\{([\s\S]*?)\}/.exec(content);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"\s*:/g)].map((match) => match[1]);
}

