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
 * The caps.
 *
 * These exist to stop a repository that cannot fit in a free-tier agent context
 * from being imported in full, where it would break every subsequent request.
 *
 * The numbers are set by the shape of real repositories rather than by a guess.
 * A dry run over a React + Express monorepo (`frontend/` and `backend/`, 66 files)
 * showed the original 40-file / 220KB budget importing 19 of 52 source files and
 * dropping every component the app imported. The dominant cost was not code: two
 * copies of a 191KB *generated case-data* file, which is 382KB of the budget spent
 * on data no agent needs to read in full. The budget was being consumed by the
 * wrong thing, which is the same mistake as the earlier largest-first sort.
 *
 * So the caps are raised, and oversized files are reported as oversized rather
 * than vanishing.
 */
const MAX_IMPORT_FILES = 400;
const MAX_IMPORT_BYTES = 2_000_000;
const MAX_FILE_BYTES = 400_000;

/** Extensions the preview can do something with. */
const IMPORTABLE = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".scss", ".sass", ".less", ".html", ".json", ".md", ".txt", ".yml", ".yaml",
  ".vue", ".svelte", ".astro", ".env.example",
]);

/** Never source: build output, vendored code, caches. */
const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "out", ".next", ".nuxt", ".output", "vendor",
  "coverage", ".git", ".github", ".vscode", ".idea", "target", "bin", "obj",
  "__pycache__", "venv", ".venv", ".tox",
]);

/**
 * Path segments that mark a directory as *not* the app.
 *
 * This is the most consequential list in the file. A dry run against twelve
 * well-known public repositories showed every one of them importing only test
 * fixtures and finding no entry point at all: `vitejs/vite` kept 150 files of
 * `packages/vite/src/node/__tests__/fixtures/*\/package.json` and dropped all
 * four of its real `.tsx` files.
 *
 * The cause was the sort, not the cap. Within a priority group the selection
 * took the *smallest* first, which is right when a byte budget is the binding
 * constraint and catastrophic when a count cap is - fixture files are tiny, so
 * they win every comparison against a real component. The two repositories I
 * had tested passed only because they were small enough that the cap never
 * engaged, which was not evidence of generality at all.
 */
const NON_APP_SEGMENTS = new Set([
  "__tests__", "__mocks__", "__snapshots__", "__fixtures__", "test", "tests",
  "spec", "specs", "e2e", "cypress", "playwright", "fixtures", "fixture",
  "mocks", "mock", "stories", "storybook", "__stories__", "example", "examples",
  "sample", "samples", "demo", "demos", "docs", "doc", "documentation",
  "benchmark", "benchmarks", "playground",
]);

/** Filename fragments that mark a file as not-the-app. */
const NON_APP_NAME =
  /(\.test\.|\.spec\.|\.stories\.|\.bench\.|\.d\.ts$|^setup|^conftest|^\.eslintrc|^\.prettierrc)/i;

/** Lockfiles are enormous, derivable, and useless to an agent. */
const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "composer.lock", "poetry.lock", "Cargo.lock", ".DS_Store", "Thumbs.db",
]);

/**
 * What must survive the cap, because it is how an agent understands the app.
 *
 * These are *basenames*, not full paths, because a repository can put its entry
 * point anywhere: `app/page.tsx`, `frontend/src/App.tsx`,
 * `apps/dashboard/boot.tsx`. A path-anchored list only ever matched the layout
 * of the repositories that happened to be imported while writing it.
 *
 * They are also a *rank*, not a filter. A fixture directory can still contain a
 * file called `App.tsx`; ranking puts it behind the real one rather than
 * pretending the name alone settles it.
 */
const ENTRY_NAMES = new Set([
  "page.tsx", "page.ts", "page.jsx", "page.js",
  "main.tsx", "main.ts", "main.jsx", "main.js",
  "app.tsx", "app.ts", "app.jsx", "app.js",
  "index.html", "boot.tsx", "boot.ts", "client.tsx", "client.ts",
  "manage.py", "server.ts", "server.js", "main.go", "app.vue", "App.vue",
]);

/**
 * `index.tsx` is *not* in the entry set, and that is deliberate.
 *
 * In a library monorepo, `packages/react/toggle/src/index.ts` is a barrel file
 * that re-exports a hook. It matches every conventional name, so including it at
 * entry rank meant the cap filled with barrels before it reached a real
 * component - `radix-ui/primitives` kept 24 `src/index.ts` barrels and no
 * `index.html` at all.
 *
 * It is ranked as ordinary source instead, where a genuine `src/index.tsx` that
 * mounts the app still wins on depth and size.
 */
const BARREL_NAMES = new Set(["index.ts", "index.tsx", "index.js", "index.jsx", "index.d.ts"]);

/** Config that explains the project: build, deps, styling, types. */
const CONFIG_NAMES = new Set([
  "package.json", "tsconfig.json", "jsconfig.json", "vite.config.ts",
  "vite.config.js", "tailwind.config.js", "tailwind.config.ts",
  "postcss.config.js", "next.config.js", "next.config.mjs", "svelte.config.js",
  "nuxt.config.ts", "astro.config.mjs", "webpack.config.js", "components.json",
]);

/** Documents an agent should read to understand intent. */
const DOC_NAMES = new Set(["readme.md", "architecture.md", "contributing.md", "agents.md"]);

export interface ImportPlan {
  /** Workspace-relative paths, in the order they should be written. */
  paths: string[];
  /** Top-level files deliberately left out, for the user rather than a log. */
  skipped: string[];
  /** True when the repository was too large to copy whole. */
  trimmed: boolean;
}

/**
 * Rank a file, lowest first. Lower survives the cap.
 *
 * The tiers encode *what a file is for*, not how big it is. The previous
 * implementation ranked by name-pattern match and then sorted smallest-first
 * within a tier, which meant a 90-byte `fixtures/nested/package.json` outranked
 * a 12KB real component every single time the cap was reached.
 *
 * Within a tier, shallower paths win, then smaller files. Shallower matters
 * because an entry point at the root is more likely to be the app than one four
 * directories down inside a package, and the entry resolver already prefers
 * shallower candidates.
 */
function rankFile(path: string, base: string, size: number): number {
  const nonApp =
    path.split("/").some((segment) => NON_APP_SEGMENTS.has(segment)) || NON_APP_NAME.test(base);

  // Anything in a test/fixture/example directory goes last, whatever it is
  // called. It is not deleted: a test can still tell an agent how the app is
  // meant to behave, so it is kept and merely outranked.
  if (nonApp) return 90;

  if (ENTRY_NAMES.has(base.toLowerCase())) return 0;
  if (CONFIG_NAMES.has(base.toLowerCase())) return 1;
  if (DOC_NAMES.has(base.toLowerCase())) return 2;

  // A barrel is source, but it is the *least* useful source: it re-exports and
  // says nothing about the app. Ranked below real source so it cannot displace
  // a component when the cap is tight.
  if (BARREL_NAMES.has(base.toLowerCase())) return 7;

  // Source extensions are the app itself.
  const isSource = /\.(t|j)sx?$|\.vue$|\.svelte$|\.astro$/.test(base);
  if (isSource) return 3;

  // Styles and templates are how the app looks.
  if (/\.(css|scss|sass|less|html)$/.test(base)) return 4;

  // Data, then everything else.
  if (/\.(json|ya?ml|txt|md)$/.test(base)) return 5;
  if (size > 20_000) return 8;
  return 6;
}

/** Decide what to copy out of a repository tree, before reading any of it. */
export function planImport(
  tree: readonly { path: string; size?: number }[],
): ImportPlan {
  const skipped: string[] = [];
  const candidates: { path: string; size: number; rank: number; depth: number }[] = [];

  for (const entry of tree) {
    const path = entry.path;
    const segments = path.split("/");
    const size = typeof entry.size === "number" ? entry.size : 0;

    if (segments.some((segment) => SKIP_DIRECTORIES.has(segment))) continue;

    const base = segments[segments.length - 1] ?? "";
    if (SKIP_FILES.has(base) || SKIP_FILES.has(path)) continue;

    const dot = path.lastIndexOf(".");
    const extension = dot === -1 ? "" : path.slice(dot).toLowerCase();

    // A file the preview could never run — a notebook, a spreadsheet, an image.
    if (extension === "" || !IMPORTABLE.has(extension)) {
      if (segments.length <= 2) skipped.push(path);
      continue;
    }

    if (size > MAX_FILE_BYTES) {
      skipped.push(path);
      continue;
    }

    candidates.push({
      path,
      size,
      depth: segments.length,
      rank: rankFile(path, base, size),
    });
  }

  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.depth - b.depth ||
      a.size - b.size ||
      a.path.localeCompare(b.path),
  );

  const paths: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  let trimmed = false;

  for (const candidate of candidates) {
    // Deduplicate.
    //
    // A repository tree can list the same path more than once, and `paths` is
    // used two ways that both break on a repeat: the batched upsert sends
    // (project_id, path) as its conflict key, so one duplicate row makes
    // Postgres reject the *entire* batch with 23505 — which is why a 56-file
    // import wrote nothing at all and reported no error. Deduping here is the
    // only place that can be guaranteed correct, because it sees the final
    // selection rather than the input.
    if (seen.has(candidate.path)) continue;

    if (paths.length >= MAX_IMPORT_FILES || bytes + candidate.size > MAX_IMPORT_BYTES) {
      trimmed = true;
      continue;
    }
    seen.add(candidate.path);
    paths.push(candidate.path);
    bytes += candidate.size;
  }

  return { paths, skipped, trimmed };
}

