
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";


const exec = promisify(execFile);

const cssCache = new Map<string, string>();

/**
 * The CSS handed to the Tailwind CLI.
 *
 * The `@source` line is the part that matters, and its absence is why generated
 * apps rendered with browser defaults while looking, from every other angle,
 * correct.
 *
 * Without it, Tailwind v4's automatic detection scans from the project it
 * considers the source root - which, for a CSS file in a temp directory, resolves
 * to *this* app rather than the generated one. The generated code was never
 * scanned. The stylesheet still came out 75KB and full of real utilities, because
 * this app's own source uses `flex` and `p-4` too, so the CSS looked entirely
 * healthy: standard classes worked and arbitrary values silently did not.
 *
 * That combination - layout correct, every colour missing - is the signature of
 * this bug, and it is why it survived so long. Pointing `@source` at the
 * materialised project directory is what makes Tailwind read the generated files.
 */
function tailwindInput(sourceDir: string): string {
  const entry = path.join(process.cwd(), "node_modules", "tailwindcss", "index.css");
  return (
    `@import "${entry.replace(/\\/g, "/")}";\n` +
    `@source "${sourceDir.replace(/\\/g, "/")}";\n`
  );
}


async function compileCss(files: FileRecord[]): Promise<string> {
  const sources = files.filter((file) =>
    /\.(tsx|ts|jsx|js|html)$/.test(file.path),
  );

  const fingerprint = createHash("sha1")
    // The temp root is not part of the identity of the CSS; only the file
    // contents are, so an unrelated per-run directory does not invalidate it.
    .update(tailwindInput(tmpdir()))
    .update(sources.map((f) => `${f.path}:${f.content}`).join("\n"))
    .digest("hex");

  const cached = cssCache.get(fingerprint);
  if (cached) return cached;

  if (sources.length === 0) {
    // Nothing to scan - emit a base so the document is not unstyled nonsense.
    return "*,*::before,*::after{box-sizing:border-box}body{margin:0}";
  }

  // A unique directory per invocation.
  //
  // This used to be `architect-css-${fingerprint}`. That made two concurrent
  // requests for the same project share one directory and one `out.css`, and the
  // `rm` in the `finally` block deleted it out from under whichever build was
  // still running. The result was a stylesheet that was randomly missing
  // utilities - most often the arbitrary colour values - so a generated app
  // rendered with browser defaults while the code on screen was perfectly fine.
  // It never reproduced in a single-call test, which is exactly what a race does.
  //
  // The fingerprint still keys the cache; it just no longer names a shared path
  // that a second request can pull out from under the first.
  const dir = path.join(tmpdir(), `architect-css-${fingerprint.slice(0, 8)}-${randomUUID()}`);
  const input = path.join(dir, "in.css");
  const output = path.join(dir, "out.css");

  try {
    await mkdir(dir, { recursive: true });
    // The CLI scans a directory, so the generated tree is materialised verbatim.
    for (const file of sources) {
      const target = path.join(dir, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    await writeFile(input, tailwindInput(dir), "utf8");

    await exec(
      process.execPath,
      [
        path.join("node_modules", "@tailwindcss", "cli", "dist", "index.mjs"),
        "-i", input,
        "-o", output,
        "--minify",
      ],
      { cwd: process.cwd(), timeout: 60_000 },
    );

    const css = await readFile(output, "utf8");
    cssCache.set(fingerprint, css);
    return css;
  } catch (error) {
    // A CSS failure must not take the app down with it. Fall back to a base
    // reset so the preview still runs, just unstyled.
    console.error("[architect] preview Tailwind build failed:", error);
    return "*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif}";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

import { build, type BuildResult, type Plugin } from "esbuild";
import { validateSource } from "@/lib/pipeline/validate";
import { existsSync } from "node:fs";

import type { FileRecord } from "@/lib/agent/tools";

const ALWAYS_REAL = new Set([
  "react",
  "react-dom",
  "scheduler",
  "react-is",
  "use-sync-external-store",
]);

/** The package name for a specifier, including any scope. */
function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function canResolve(specifier: string): boolean {
  const name = packageName(specifier);
  if (ALWAYS_REAL.has(name)) return true;
  return existsSync(path.join(process.cwd(), "node_modules", name, "package.json"));
}

/**
 * Rewrite bundler-specific environment access to a plain global.
 *
 * Every Vite project reads its config as `import.meta.env.VITE_*`, and that is
 * the most common line in a modern React codebase. It cannot survive here: the
 * preview bundles to IIFE, where `import.meta` is not available, so esbuild left
 * the expression empty. An app that wrote the sensible
 * `import.meta.env.VITE_API_URL || "/api"` silently lost its fallback and
 * fetched `undefined`.
 *
 * Substituting the object for a global the document defines handles every
 * variable name at once, which defining them individually cannot do — the names
 * live in the project's `.env` files, which the preview never reads. An empty
 * object is the correct value: it is what a build with no environment variables
 * produces, and it lets the app's own `||` and `??` defaults do their job.
 *
 * `process.env` is handled separately by esbuild's `define`, which already works.
 */
function rewriteBundlerEnv(source: string): string {
  return source.replace(/\bimport\s*\.\s*meta\s*\.\s*env\b/g, "globalThis.__architect_env");
}

/**
 * The entry file, discovered by reading what the project *says* about itself.
 *
 * There was a hardcoded list of candidate paths here — `app/page.tsx`, then
 * `client/src/App.tsx`, then `frontend/src/main.tsx`, and so on, growing every
 * time a repository failed. That is the wrong shape of solution entirely: it is a
 * guess about layout, it never terminates, and it fails on exactly the repos it
 * was not extended for yet. It is also why a project with 9 real source files
 * reported that none of them was a screen.
 *
 * The fix is not a longer list. It is to read the declaration the project already
 * contains. A Vite, CRA, Parcel or plain-HTML project has an `index.html` whose
 * `<script type="module" src="...">` names its entry *exactly* — no inference
 * required. A monorepo with `frontend/` and `backend/` has one per workspace, and
 * picking the one that declares a UI is a decision the project makes, not one I
 * make. `package.json` gives a second, independent signal via its `main` field.
 *
 * Order of authority, strongest first:
 *
 *   1. `index.html` and its script src. Explicit, and correct for most of the web.
 *   2. `package.json` `main`, when it names a renderable module.
 *   3. A generated project's `app/page.*`, so our own output behaves as before.
 *   4. A conventional name, as a last resort, preferring a *component* over a
 *      mount script — a Vite `main.tsx` calls `createRoot(...).render(<App/>)` and
 *      exports nothing, so it can never be the thing the preview mounts.
 *
 * Every step is a fact read from the repository, which is the property the
 * previous list lacked.
 */
function readDeclaredEntries(files: FileRecord[]): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const declared: string[] = [];

  // 1. index.html, wherever the project keeps it.
  for (const [path, file] of byPath) {
    if (!/(^|\/)index\.html?$/i.test(path)) continue;

    for (const match of file.content.matchAll(
      /<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    )) {
      const src = match[1].split("?")[0].split("#")[0];
      if (!src || /^(https?:)?\/\//.test(src)) continue;

      // "/src/main.tsx" is relative to the HTML file's own directory.
      const baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const relative = src.startsWith("/") ? src.slice(1) : src;
      const resolved = normaliseSegments(`${baseDir}/${relative}`);

      // The declared entry is often a mount script; the component it mounts is
      // what can actually be rendered, so keep looking one level down.
      declared.push(resolved);
      for (const follow of importsOf(byPath.get(resolved))) declared.push(follow);
    }
  }

  // 2. package.json's declared entry.
  for (const [path, file] of byPath) {
    if (!/(^|\/)package\.json$/i.test(path)) continue;
    const baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (const field of [/"browser"\s*:\s*"([^"]+)"/, /"main"\s*:\s*"([^"]+)"/]) {
      const match = field.exec(file.content);
      if (!match) continue;
      const target = match[1];
      if (target.includes("*") || !/\.(tsx?|jsx?|html)$/i.test(target)) continue;
      declared.push(normaliseSegments(`${baseDir}/${target}`));
    }
  }

  return declared;
}

/** Resolve `.` and `..` in a path built by concatenation. */
function normaliseSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/** The modules a file imports, resolved to project paths where possible. */
function importsOf(file: FileRecord | undefined): string[] {
  if (!file) return [];
  const out: string[] = [];
  for (const match of file.content.matchAll(
    /from\s*["'](\.[^"']+)["']|import\s*["'](\.[^"']+)["']/g,
  )) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    const base = normaliseSegments(
      `${file.path.slice(0, file.path.lastIndexOf("/") + 1)}${specifier}`,
    );
    for (const suffix of ["", ".tsx", ".jsx", ".ts", ".js"]) out.push(base + suffix);
  }
  return out;
}

/**
 * The conventional names, used only when the project declares nothing.
 *
 * `App` is ahead of `main` for the reason above: a Vite `main.tsx` is a mount
 * script with no export, so it can never be mounted directly.
 */
const ENTRY_FALLBACKS = [
  "app/page.tsx",
  "app/page.jsx",
  "app/page.ts",
  "app/page.js",
  "src/App.tsx",
  "src/App.jsx",
  "client/src/App.tsx",
  "client/src/App.jsx",
  "apps/web/src/App.tsx",
  "frontend/src/App.tsx",
  "frontend/src/main.tsx",
  "web/src/App.tsx",
  "src/main.tsx",
  "client/src/main.tsx",
  "client/src/index.tsx",
  "client/src/index.jsx",
  "src/index.tsx",
  "src/index.jsx",
  "src/App.js",
  "client/app/page.tsx",
  "client/pages/index.tsx",
  "web/src/main.tsx",
  "packages/app/src/main.tsx",
  "index.html",
  "public/index.html",
  "client/index.html",
  "frontend/index.html",
  "web/index.html",
];

/**
 * Loaders for frameworks the preview previously could not mount.
 *
 * The bundler handled TSX, JS and JSON, and mapped everything else to text. That
 * was fine for React and meant a Vue or Svelte repository imported cleanly and
 * then previewed as nothing — no error, no app, which is the worst combination.
 * The user has to be told *why*, and the file has to be compiled.
 *
 * esbuild has no loader for a single-file component, because an SFC is not
 * JavaScript: it is a template, a script and a style block that the framework's
 * own compiler turns into one. So each is compiled here to a module esbuild can
 * consume, which keeps the bundler ignorant of the framework.
 *
 *   .vue     -> @vue/compiler-sfc, script + template merged into one component
 *   .svelte  -> svelte/compiler, generating a component from the whole file
 *   *.module.css -> esbuild's own `local-css` loader, which is CSS Modules
 *
 * Pure functions, no esbuild import, so `npm run env:check` can exercise them.
 */

export type CompiledModule = { code: string } | { error: string };

let vue: typeof import("@vue/compiler-sfc") | null = null;
let svelte: typeof import("svelte/compiler") | null = null;

/**
 * The compilers are loaded on first use, not at module load.
 *
 * A preview of a React project has no business paying for the Vue compiler, and a
 * static import would make every build resolve both packages.
 */
async function loadCompilers() {
  if (!vue) vue = await import("@vue/compiler-sfc");
  if (!svelte) svelte = await import("svelte/compiler");
}

/** Whether a file needs the framework compilers at all. */
export function needsFrameworkCompiler(path: string): boolean {
  return path.endsWith(".vue") || path.endsWith(".svelte");
}

/** True for a CSS Modules file, which must not be treated as a side-effect import. */
export function isCssModule(path: string): boolean {
  return /\.module\.\w+$/i.test(path);
}

/** True for any stylesheet the bundler should pass through untouched. */
export function isStylesheet(path: string): boolean {
  return /\.(css|scss|sass|less|styl)$/i.test(path);
}

/**
 * Compile a Vue single-file component into a plain component module.
 *
 * The output is the runtime-`h` form of the render function plus the component's
 * own script, so the preview does not need the Vue runtime — only React is
 * bundled. That is a real trade: a Vue app previewed here is a faithful
 * *rendering* of its templates, but Vue-specific runtime behaviour (reactive
 * watchers, `provide`/`inject`, the composition API's lifecycle) is not what runs.
 * Vue's template compiler already emits a `h()` call tree, which renders
 * correctly under React for the ordinary case of static markup plus click
 * handlers.
 */
export async function compileVue(path: string, content: string): Promise<CompiledModule> {
  try {
    await loadCompilers();
    const sfc = vue!;
    const { descriptor, errors } = sfc.parse(content, { filename: path });

    if (errors.length > 0) {
      return { error: errors[0].message ?? "the Vue component could not be parsed" };
    }

    const template = descriptor.template?.content?.trim();
    const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? "";

    if (!template && !script.trim()) {
      return { error: `${path} is an empty Vue component` };
    }

    // No template: the script's default export *is* the component.
    if (!template) {
      return { code: `${script}\nexport default script.default ?? script;` };
    }

    const compiled = sfc.compileTemplate({
      source: template,
      filename: path,
      id: "architect",
      // Emit `h(...)` calls, which is what makes the output renderable without
      // the Vue runtime.
      compilerOptions: { mode: "function" },
    });

    if (compiled.errors.length > 0) {
      const first = compiled.errors[0];
      const message = typeof first === "string" ? first : (first as { message?: string }).message;
      return { error: message ?? "the Vue template could not be compiled" };
    }

    // A CSS import inside the SFC is a side effect; keep it so the stylesheet is
    // still included in the bundle.
    const styles = descriptor.styles
      .map((style, i) => `import ${JSON.stringify(path + "?vue&type=style&index=" + i + "&lang.css")};`)
      .join("\n");

    // `export default { ... }` from the script, with the render function merged
    // in. A script that already exports something keeps its exports; only a
    // missing default is added.
    const hasDefault = /export\s+default\s/.test(script);
    const body = hasDefault ? script : `${script}\nexport default {};`;

    return {
      code: [
        body,
        styles,
        `import { h } from "react";`,
        `const __render = ${compiled.code.replace(/var (render|ssrRender) = /, "const $1 = ")};`,
        `const __options = typeof __render === "function" ? { render: __render } : __render;`,
        `const __component = (typeof __options === "function" ? __options : __options.setup ? __options : {});`,
        // Assign the render fn onto whatever object was exported, so a component
        // with its own setup still renders.
        `const __base = (${/export\s+default\s*(\w+)/.test(script) ? "$1" : "{}"});`,
        `__base.render = __render;`,
        `export default __base;`,
      ].join("\n"),
    };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

/** Compile a Svelte component into a plain component module. */
export async function compileSvelte(path: string, content: string): Promise<CompiledModule> {
  try {
    await loadCompilers();
    const compiled = svelte!.compile(content, {
      filename: path,
      generate: "client",
      dev: false,
    });

    const code = compiled.js?.code;
    if (!code) {
      return { error: "the Svelte component produced no output" };
    }

    // Svelte 5 emits `$.render` / `$.mount` against its own runtime. The preview
    // has no Svelte runtime, so the compiled module is surfaced as-is and esbuild
    // will report a genuine missing-import error naming `svelte/internal` —
    // which is honest, where pretending the component works is not.
    return { code };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

function loaderForPath(path: string): "tsx" | "ts" | "jsx" | "js" | "json" | "local-css" | "text" {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return "jsx";
  }
  if (path.endsWith(".json")) return "json";
  return "text";
}

/** True when a file can actually be mounted. */
function isMountable(path: string, content: string): boolean {
  if (/\.html?$/i.test(path)) return true;
  return /export\s+default\s/.test(content);
}
export function findEntry(files: FileRecord[]): FileRecord | null {
  const byPath = new Map(files.map((file) => [file.path, file]));

  // 0. Our own generated layout, first and unconditionally.
  //
  // A project built from a prompt is ours, and it must behave exactly as it
  // always has. Leaving this below the declaration step meant a generated app
  // that also happened to contain a stray index.html resolved to the stray file.
  for (const path of ["app/page.tsx", "app/page.jsx", "app/page.ts", "app/page.js"]) {
    const file = byPath.get(path);
    if (file && isMountable(file.path, file.content)) return file;
  }

  // 1 and 2: what the project declares about itself. This is the part that
  // generalises; a path list never would.
  for (const path of readDeclaredEntries(files)) {
    const file = byPath.get(path);
    if (file && isMountable(file.path, file.content)) return file;
  }

  // 3: conventional names, last.
  for (const path of ENTRY_FALLBACKS) {
    const file = byPath.get(path);
    if (!file) continue;
    if (!isMountable(file.path, file.content)) continue;

    // A static index.html is only worth serving when the script it loads is
    // actually in the workspace. Serving one whose entry was never imported gives
    // a blank page and no explanation, which is strictly worse than saying the
    // entry is missing — and that is exactly the truncated-import case.
    //
    // The whole workspace is passed in, not just this file: resolving the script
    // src to a project path is a pure string operation, but confirming the module
    // exists needs every file.
    if (/(^|\/)index\.html?$/i.test(file.path)) {
      const declared = readDeclaredEntries(files).filter((c) => byPath.has(c));
      const declaresSomething = /<script[^>]*\bsrc\s*=/i.test(file.content);
      if (declaresSomething && declared.length === 0) continue;
    }

    return file;
  }

  return null;
}

/**
 * A last resort when the project declares nothing usable: a file whose name says
 * it is an entry, that can actually be mounted.
 *
 * Only `main`/`index`/`App`/`app`/`page` modules qualify, because rendering an
 * arbitrary module is how you get a blank screen. Returns the shallowest such file
 * so the choice is predictable, and prefers a component over a mount script.
 */
export function findEntryFallback(files: FileRecord[]): FileRecord | null {
  const candidates = files.filter(
    (file) =>
      /(?:^|\/)(?:main|index|app|page|App|Page)\.[jt]sx?$/i.test(file.path) &&
      isMountable(file.path, file.content),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.sort(
      (a, b) =>
        a.path.split("/").length - b.path.split("/").length ||
        a.path.localeCompare(b.path),
    )[0] ?? null
  );
}


function resolveRelative(fromPath: string, specifier: string): string {
  const parts = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

const ALIAS_PREFIXES = ["@/", "@app/"];

/** `@/lib/storage` -> `lib/storage`. The alias root is the project root. */
function resolveAlias(specifier: string): string {
  for (const prefix of ALIAS_PREFIXES) {
    if (specifier.startsWith(prefix)) return specifier.slice(prefix.length);
  }
  return specifier;
}

/** The probe order the bundler and the import checker must agree on. */
const EXTENSION_CANDIDATES = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"];

function firstExisting(base: string, has: (candidate: string) => boolean): string | null {
  for (const suffix of EXTENSION_CANDIDATES) {
    const candidate = base + suffix;
    if (has(candidate)) return candidate;
  }
  return null;
}

/**
 * The path an extensionless specifier resolves to for a file-style import.
 *
 * `../GameLayout` -> `client/src/components/GameLayout.tsx`. This exists so every
 * place that has to compare a *specifier* against a *resolved path* uses the same
 * two-step as the bundler, instead of comparing an extensionless string to a
 * resolved one and quietly reporting a mismatch.
 */
function probeExtension(base: string): string {
  return base + ".tsx";
}

/** The path for a directory-style import, e.g. `./Hub` -> `Hub/index.tsx`. */
function probeIndex(base: string): string {
  return base + "/index.tsx";
}


function collectImports(
  entry: FileRecord,
  all: FileRecord[],
): { included: FileRecord[]; missing: string[] } {
  const byPath = new Map(all.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const included: FileRecord[] = [];
  const missing = new Set<string>();

  // The same probe order the esbuild resolver uses, so the two agree on what
  // "missing" means. Two lists would drift, and the compiler would report a file
  // as missing that it had just resolved.
  const probe = (target: string): FileRecord | undefined =>
    byPath.get(target) ??
    byPath.get(`${target}.tsx`) ??
    byPath.get(`${target}.ts`) ??
    byPath.get(`${target}/index.tsx`) ??
    byPath.get(`${target}/index.ts`);

  const visit = (file: FileRecord) => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    included.push(file);

    // A deliberately simple import scan. A real bundler would parse, but this
    // only has to find the project files the model referenced. A miss is
    // recorded, not dropped: an unwritten file must not blank a preview that is
    // otherwise fine, and the caller needs the name to show the user which one it
    // is.
    //
    // The pattern accepts `@/...` as well as `./...`. Matching only the relative
    // form meant an aliased import was invisible here, so the file was never
    // added to the bundle - the component resolved to an empty module and React
    // failed with "element type is invalid" instead of a message naming a file.
    // Matches a relative specifier, the `@/` alias, AND a bare project path.
    //
    // The bare form is not optional. Models write `from "lib/storage"` as often
    // as they write a relative path, treating the project root as a package root.
    // This pattern used to match only `./x` and `@/x`, so a bare import was
    // invisible here and the file was never added to the bundle. The symptom was
    // `seedDataIfEmpty is not a function` for a function that was sitting in
    // lib/storage.ts the whole time, and a white preview with every other file
    // compiling cleanly.
    //
    // The same gap existed in the import *checker* and was fixed there first,
    // which is why the code said the imports were fine while the running bundle
    // disagreed. Two code paths, one fixed. The prefixes are narrow enough that a
    // real package name never matches.
    const pattern =
      /(?:import|export)[\s\S]*?from\s*["'](@\/[^"']+|\.[^"']+|app\/[^"']+|lib\/[^"']+|components\/[^"']+|src\/[^"']+|pages\/[^"']+)["']/g;
    let match = pattern.exec(file.content);
    while (match) {
      const base = match[1].startsWith(".")
        ? resolveRelative(file.path, match[1])
        : resolveAlias(match[1]);
      const found = probe(base);
      if (found) visit(found);
      else missing.add(base);
      match = pattern.exec(file.content);
    }
  };

  visit(entry);
  return { included, missing: [...missing].sort() };
}

export interface CompileResult {
  ok: boolean;
  html: string;
  /** Set when the user's own code failed - shown verbatim, never hidden. */
  error: string | null;
  /** Files that made it into the bundle, for the "3 files running" caption. */
  included: string[];
  missing: string[];
  /**
   * A hash of exactly the file contents that produced this bundle.
   *
   * The panel puts this in the iframe's URL, so a document is only ever reused
   * when the files behind it are byte-for-byte identical.
   *
   * This exists because of a specific, repeated failure. A user saw
   * `seedDataIfEmpty is not a function` while the Code tab plainly showed
   * `export function seedDataIfEmpty()` sitting in `lib/storage.ts`, and a direct
   * read of the database confirmed both. The source was right and the running
   * bundle was wrong: the URL carried a client-side counter that resets on
   * reload, so a browser could hold a document that no longer matched the
   * project, with no way to tell which of the two was stale.
   *
   * Content-addressed URLs make that state unrepresentable - different files
   * mean a different URL, so a stale document cannot be served.
   */
  fingerprint: string;
}

function missingExportNames(target: string, files: FileRecord[]): string[] {
  const names = new Set<string>();
  const pattern = /(?:import|export)\s+([\s\S]*?)\s+from\s*["'](\.[^"']+)["']/g;
  const identifier = /^[A-Za-z_$][\w$]*$/;

  // The candidate probe, identical to the one the bundler uses.
  //
  // This comparison used to be `resolveRelative(...) === target`, which compared an
  // extensionless path against a resolved one. Every import written as
  // `from '../GameLayout'` therefore failed to match, so the module was generated
  // as a stub with *no exports at all* — and esbuild then correctly reported
  // "No matching export ... for import LoadingState" for a file that exports
  // LoadingState, ErrorState, Stamp, RubricRow and JudgmentScore. Five errors,
  // all of them fiction, produced by comparing the wrong two strings.
  const matchesTarget = (fromPath: string, specifier: string): boolean => {
    const base = resolveRelative(fromPath, specifier);
    return (
      base === target ||
      probeExtension(base) === target ||
      probeIndex(base) === target
    );
  };

  for (const file of files) {
    let match = pattern.exec(file.content);
    while (match) {
      if (matchesTarget(file.path, match[2])) {
        const clause = match[1];

        // A default binding: `import Foo from ...`, `import Foo, { Bar } from ...`.
        if (/^\s*\*?\s*as\s/.test(clause) || /^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause)) {
          names.add("default");
        }

        const braces = clause.match(/\{([\s\S]*?)\}/);
        if (braces) {
          for (const part of braces[1].split(",")) {
            // `B as C` means the *module* exports B; C is only the local name.
            const alias = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)/);
            if (alias && identifier.test(alias[1])) names.add(alias[1]);
          }
        }
      }
      match = pattern.exec(file.content);
    }
  }

  return [...names].sort();
}

function missingModule(target: string, names: string[]): string {
  const exports = names
    .filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name))
    .map((name) => `export const ${name} = Placeholder;`);

  return [
    'import * as React from "react";',
    "function Placeholder() {",
    "  return React.createElement(",
    '    "div",',
    "    {",
    '      "data-architect-missing": "true",',
    "      style: {",
    '        margin: "24px",',
    '        padding: "20px 24px",',
    '        border: "1px dashed #a1a1aa",',
    '        borderRadius: "10px",',
    '        color: "#71717a",',
    '        fontSize: "13px",',
    "        lineHeight: 1.6,",
    '        textAlign: "center",',
    "      },",
    "    },",
    `    ${JSON.stringify("Not written yet: " + target)},`,
    '    React.createElement("div", { style: { marginTop: "6px", opacity: 0.7 } },',
    '      "The rest of the app runs. This section appears once the file is written."',
    "    ),",
    "  );",
    "}",
    "export default Placeholder;",
    ...exports,
  ].join("\n");
}

function brokenModule(target: string, error: string, names: string[]): string {
  const exports = names
    .filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name))
    .map((name) => `export const ${name} = Placeholder;`);

  return [
    'import * as React from "react";',
    "function Placeholder() {",
    "  return React.createElement(",
    '    "div",',
    "    {",
    '      "data-architect-broken": "true",',
    "      style: {",
    '        margin: "24px",',
    '        padding: "16px 20px",',
    '        border: "1px solid #e5484d",',
    '        borderRadius: "10px",',
    '        background: "rgba(229,72,77,0.06)",',
    '        color: "#e5484d",',
    '        fontSize: "13px",',
    "        lineHeight: 1.6,",
    "        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',",
    "      },",
    "    },",
    `    ${JSON.stringify("This section did not compile: " + target)},`,
    '    React.createElement("div", { style: { marginTop: "6px", opacity: 0.85 } },',
    `      ${JSON.stringify(error)}`,
    "    ),",
    '    React.createElement("div", { style: { marginTop: "6px", opacity: 0.7 } },',
    '      "The rest of the app still runs. Ask the team to rewrite this file.",',
    "    ),",
    "  );",
    "}",
    "export default Placeholder;",
    ...exports,
  ].join("\n");
}

export async function compilePreview(
  files: FileRecord[],
): Promise<CompileResult> {
  const entry = findEntry(files) ?? findEntryFallback(files);

  if (!entry) {
    // Say which of the two situations this is, because the old single message
    // was wrong in both. A project with no files genuinely has no screen yet; a
    // project with nineteen imported files has a screen we failed to locate, and
    // telling that user "the agent has not written the first screen" sends them
    // looking in the chat for a build that never happened.
    const empty = files.length === 0;

    return {
      ok: false,
      html: "",
      error: empty
        ? "No app/page.tsx yet. The agent has not written the first screen."
        : `This project has ${files.length} file${files.length === 1 ? "" : "s"}, but none of them is a screen the preview can mount. ` +
          `A previewable entry is a file like main.tsx, App.tsx, index.html or page.tsx that exports a component by default. ` +
          `Tell the team which file starts this app, or ask them to add one.`,
      included: [],
      missing: [],
      fingerprint: "",
    };
  }

  const { included, missing } = collectImports(entry, files);
  const entrySource = included.find((file) => file.path === entry.path);
  if (!entrySource) {
    return {
      ok: false,
      html: "",
      error: "The entry file vanished mid-build.",
      included: included.map((f) => f.path),
      missing,
      fingerprint: "",
    };
  }

  // Mounting a module with no default export throws "Element type is invalid"
  // deep inside React, with nothing in the stack to explain it. Checking here
  // turns that into a sentence the user can act on.
  if (!isMountable(entry.path, entrySource.content)) {
    return {
      ok: false,
      html: "",
      error: `${entry.path} does not export a component, so there is nothing to show. A screen needs a default export, for example: export default function App() { ... }`,
      included: included.map((f) => f.path),
      missing,
      fingerprint: "",
    };
  }

  const paths = included.map((file) => file.path);
  // Mutable, and seeded from the text scan: the esbuild resolver sees imports
  // the scan cannot (side-effect imports have no `from` clause), so the result
  // has to be what the bundler actually refused to find, not just what a regex
  // spotted first.
  const missingPaths = new Set(missing);
  // Files that exist but do not parse. Collected during the build so the caller
  // can flag them, because a build that SUCCEEDS with placeholders is exactly
  // the case a user needs to be told about.
  const brokenPaths: { path: string; error: string }[] = [];

  // Files that compiled but will not look right in the preview, because they
  // style themselves with `style={{}}` rather than with utility classes. Counted
  // rather than listed: fourteen identical paragraphs is not information, and it
  // pushed the user's own interface off the screen.
  const warnedPaths: string[] = [];
  // Every file the entry graph pulls in, keyed by path. This is the source of
  // truth for module resolution - these are rows in Postgres, not files on disk.
  const byPath = new Map(included.map((file) => [file.path, file]));
  // Virtual namespace for a project file. esbuild has no filesystem to look in,
  // so paths are tagged with this and mapped back to a record on load.
  const NAMESPACE = "arch-file";
  // Virtual namespace for an import the app references but that nobody wrote.
  // Kept separate so a stub can never be mistaken for a real project file.
  const MISSING_NAMESPACE = "arch-missing";
  let result: BuildResult;

  const shim = [
    'import * as React from "react";',
    'import * as ReactDOMClient from "react-dom/client";',
    'import App from "@architect/entry";',
    "",
    "const box = () => document.getElementById(\"__architect_error\");",
    "const fail = (message) => {",
    "  const el = box();",
    "  if (el) { el.style.display = \"block\"; el.textContent = message; }",
    "};",
    "",
    // Wrapped, because a failure here is otherwise completely invisible: the
    // iframe is blank and the console message belongs to the sandboxed document,
    // not to the page the developer is looking at.
    "try {",
    '  if (typeof App === "function") {',
    '    ReactDOMClient.createRoot(document.getElementById("root")).render(',
    "      React.createElement(App),",
    "    );",
    "  } else {",
    '    fail("app/page.tsx did not export a component. It needs a default export, for example: export default function Page() { ... }");',
    "  }",
    "} catch (error) {",
    "  fail(\"The app failed to start: \" + ((error && error.stack) || error));",
    "}",
  ].join("\n");

  const projectPlugin: Plugin = {
    name: "architect-project-files",
    setup(api) {
      // Any relative import coming out of a project file is ours to resolve.
      api.onResolve({ filter: /^\.{1,2}\// }, (args) => {
        // `args.importer` is the resolved path of the importing file, and for a
        // file served through onLoad it carries NO namespace prefix: tracing
        // esbuild shows the entry's relative imports arriving as
        // `importer: "app/page.tsx"`, not `arch-file:app/page.tsx`.
        //
        // So the test is "is this one of our files", not "is this in our
        // namespace". The latter looks equivalent and is not: it rejected every
        // relative import, so no app split into components could ever preview.
        const importerPath = args.importer;
        if (!byPath.has(importerPath)) return null;
        const base = resolveRelative(importerPath, args.path);
        const found = firstExisting(base, (candidate) => byPath.has(candidate));

        if (!found) {
          // Stubbed rather than left unresolved. Returning null handed the path
          // back to the real filesystem, where the model's file does not exist,
          // and esbuild then failed the *entire* build with "Could not resolve" -
          // one unwritten file blanked a preview that was otherwise fine, for an
          // app that had simply not finished yet. A visible placeholder keeps the
          // rest of the screen running and names what is absent.
          missingPaths.add(base);
          return { path: base, namespace: MISSING_NAMESPACE };
        }
        // esbuild prepends the namespace itself, so `path` must be the bare project path.
        return { path: found, namespace: NAMESPACE };
      });

      // The `@/` alias, resolved from the project root. Registered as its own
      // rule rather than folded into the relative one because the two produce
      // different base paths: `./x` is relative to the importer, `@/x` is
      // absolute from the root.
      api.onResolve({ filter: /^@\// }, (args) => {
        if (!byPath.has(args.importer)) return null;
        const base = resolveAlias(args.path);
        const found = firstExisting(base, (candidate) => byPath.has(candidate));
        if (!found) {
          missingPaths.add(base);
          return { path: base, namespace: MISSING_NAMESPACE };
        }
        return { path: found, namespace: NAMESPACE };
      });

      // `resolveDir` is mandatory, not an optimisation: a file in a custom
      // namespace has no directory of its own, so esbuild will not search for
      // `react` on its behalf and the stub itself fails to build with
      // "Could not resolve react" - which would take down the very preview the
      // stub exists to keep alive.
      api.onLoad({ filter: /.*/, namespace: MISSING_NAMESPACE }, (args) => ({
        contents: missingModule(args.path, missingExportNames(args.path, included)),
        loader: "js",
        resolveDir: process.cwd(),
      }));

      api.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
        // `args.path` is the bare project path: esbuild tracks the namespace
        // separately, so it must not be stripped here (and must not have been
        // added by the resolver either). One convention, used everywhere.
        const file = byPath.get(args.path);
        if (!file) return { contents: "", loader: "tsx" };

        if (args.path !== entry.path) {
          // `warn`, not the default `reject`.
          //
          // The default is right for code the model just wrote: an inline style
          // there means the agent skipped the design system, and refusing the
          // file sends it back. It is wrong for a preview of an imported
          // repository. Fourteen components of that repository use `style={{}}`,
          // and rejecting them swapped every one for a stub — the user lost their
          // entire screen to a rule written for code nobody has written yet, and
          // saw fourteen copies of the same paragraph instead of their app.
          //
          // The user's own code is not the agent's to refuse. It compiles, it
          // runs, and the only consequence is that some styling will not carry
          // into the preview, which is a note rather than a failure.
          const check = await validateSource(args.path, file.content, {
            inlineStyles: "warn",
          });

          if (!check.valid) {
            brokenPaths.push({ path: args.path, error: check.error });
            return {
              contents: brokenModule(
                args.path,
                check.error,
                missingExportNames(args.path, included),
              ),
              loader: "js",
              resolveDir: process.cwd(),
            };
          }

          // Collected, not emitted per file. Fourteen identical lines is noise
          // that buries the one thing worth reading.
          if (check.warning) warnedPaths.push(args.path);
        }

        // A single-file component is not JavaScript, so it is compiled to a
        // module the bundler can consume. This is done here rather than in an
        // esbuild plugin deliberately: a plugin's onLoad does not fire for this
        // project namespace, and a silent no-op for a compatibility shim is the
        // worst possible outcome.
        // esbuild types `args.path` as a PlatformPath, so the project path is
        // read from the namespace, which is the bare project-relative path that
        // every other function in this file expects.
        const projectPath = args.path;

        if (projectPath.endsWith(".vue") || projectPath.endsWith(".svelte")) {
          const compiled = projectPath.endsWith(".vue")
            ? await compileVue(projectPath, file.content)
            : await compileSvelte(projectPath, file.content);

          if ("error" in compiled) {
            brokenPaths.push({ path: projectPath, error: compiled.error });
            return {
              contents: brokenModule(
                projectPath,
                compiled.error,
                missingExportNames(projectPath, included),
              ),
              loader: "js",
              resolveDir: process.cwd(),
            };
          }

          return { contents: compiled.code, loader: "js", resolveDir: process.cwd() };
        }

        return {
          // `rewriteBundlerEnv` is applied here rather than through a plugin,
          // because the plugin's onLoad never fires for this project namespace and
          // a silent no-op is the worst possible outcome for a compatibility shim.
          contents: rewriteBundlerEnv(file.content),

          // The loader has to follow the extension, not default to TSX.
          //
          // A `.json` file loaded as TSX is parsed as JavaScript, so a top-level
          // array becomes a bare expression with no default export — and
          // `import cases from "./data.json"` then resolves to `undefined` and
          // throws "cases.default.filter is not a function" at runtime. That is a
          // data file, not broken code, and it took the whole screen down.
          loader: loaderForPath(args.path),

          resolveDir: process.cwd(),
        };
      });
    },
  };

  try {
    result = await build({
      stdin: {
        contents: shim,
        resolveDir: process.cwd(),
        loader: "tsx",
        sourcefile: "__architect_entry.tsx",
      },
      bundle: true,
      write: false,
      // esbuild refuses to import CSS into JavaScript without an output path,
      // because it has to name the emitted stylesheet. With `write: false`
      // nothing is actually written — the path only has to exist for that name to
      // be computable. Without it a CSS Modules import fails with "Cannot import
      // ... into a JavaScript file without an output path configured", which a
      // plain side-effect `import "./x.css"` never triggers, so the difference
      // only shows up on exactly the projects that use CSS Modules.
      outdir: path.join(os.tmpdir(), "architect-preview"),
      format: "iife",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      define: {
        // The generated app has no build-time env. These stand in for the Next
        // constants the model will reflexively reach for.
        "process.env.NODE_ENV": '"production"',
      },
      plugins: [
        projectPlugin,
        {
          name: "architect-entry",
          setup(api) {
            // The shim imports the entry through a well-known specifier, which is
            // mapped onto the same virtual namespace every other project file
            // uses - so the entry and its imports go through exactly one loader.
            api.onResolve({ filter: /^@architect\/entry$/ }, () => ({
              path: entry.path,
              namespace: NAMESPACE,
            }));
          },
        },
        {
          name: "architect-externals",
          setup(api) {
            api.onResolve({ filter: /.*/ }, (args) => {
              // Relative specifiers belong to the project-files plugin, which runs
              // first. Returning null here is what used to send them to the real
              // filesystem, where the model's components do not exist.
              if (args.path.startsWith(".") || args.path.startsWith("/")) {
                return null;
              }

              // Anything genuinely installable is bundled for real.
              //
              // This test replaces an earlier hardcoded react/react-dom check, and
              // the difference is not cosmetic. React DOM calls `require("scheduler")`
              // to queue work; the hardcoded list did not include it, so it fell
              // through to the empty-module stub below. React then scheduled every
              // render onto a function that did nothing: the root container was
              // created, no exception was thrown, and the preview stayed blank.
              // In the browser and in tests, identically. It was indistinguishable
              // from "the agent produced an empty app".
              if (canResolve(args.path)) return null;

              // A bare specifier that happens to name a project file.
              //
              // Models write `from "lib/storage"` as readily as `from "./storage"`,
              // treating the project's own folder as a package root. Classified as
              // an unknown dependency it became an empty module, so every import
              // from it arrived as `undefined` and React reported an invalid
              // element type. The test is deliberately "is there a file at this
              // path" - a real package name will not collide, and when it somehow
              // does, resolving to the project's own file is the safer reading
              // anyway.
              if (byPath.has(args.importer)) {
                const base = args.path.replace(/^\.\//, "");
                const found = firstExisting(base, (candidate) => byPath.has(candidate));
                if (found) return { path: found, namespace: NAMESPACE };
              }

              // Anything else bare (an icon library, a date picker) resolves to an
              // empty module. Failing the whole preview on one missing package
              // would hide far more than it protects, and the system prompt tells
              // the model to avoid them.
              return { path: args.path, namespace: "arch-empty" };
            });

            api.onLoad({ filter: /.*/, namespace: "arch-empty" }, () => ({
              contents:
                "module.exports = new Proxy(function(){}, { get:(t,p)=> p === '__esModule' ? false : function(){} });",
              loader: "js",
            }));
          },
        },
      ],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The generated code did not compile.";
    return {
      ok: false,
      html: "",
      error: message,
      included: paths,
      missing: [...missingPaths].sort(),
      fingerprint: "",
    };
  }

  const code = result.outputFiles?.[0]?.text ?? "";
  const css = await compileCss(files);

  const broken = brokenPaths.sort((a, b) => a.path.localeCompare(b.path));
  const notes: string[] = [];
  if (missingPaths.size > 0) {
    notes.push(
      `${missingPaths.size} section${missingPaths.size === 1 ? "" : "s"} not written yet: ${[...missingPaths].sort().join(", ")}`,
    );
  }

  // One line, with the count, and the paths only if there are few enough to read.
  if (warnedPaths.length > 0) {
    const names = [...warnedPaths].sort();
    const list = names.length <= 4 ? `: ${names.join(", ")}` : "";
    notes.push(
      `${names.length} file${names.length === 1 ? " uses" : "s use"} inline styles (style={{...}}), which the preview cannot compile into CSS. ` +
        `The code runs; some styling will not show${list}. Ask the team to convert them to utility classes if you want it to match.`,
    );
  }

  for (const item of broken) {
    notes.push(`${item.path} did not compile — ${item.error}`);
  }

  return {
    ok: true,
    html: wrap(code, css, paths),
    error: notes.length > 0 ? notes.join("\n") : null,
    fingerprint: createHash("sha1")
      .update(included.map((file) => `${file.path}:${file.content}`).join("\n"))
      .digest("hex")
      .slice(0, 12),
    included: paths,
    missing: [...missingPaths].sort(),
  };
}


/** Escape a string for safe embedding in a <script> block. */
function safeJson(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function escapeForScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

function wrap(code: string, css: string, included: string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${css}</style>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  #__architect_error {
    display: none; margin: 16px; padding: 14px 16px; border-radius: 10px;
    border: 1px solid #e5484d33; background: #e5484d0f; color: #e5484d;
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  #__architect_error b { display: block; margin-bottom: 6px; font-size: 13px; }
</style>
</head>
<body>
<div id="root"></div>
<div id="__architect_error"></div>
<script>
/*
 * Environment shims, applied before the app's own code runs.
 */

// The target of the import.meta.env rewrite the bundler performs. Defined here
// as an empty object because a preview has no .env file: this is exactly what a
// production build with no variables injected produces, and it means a Vite app's
// "import.meta.env.VITE_API_URL || '/api'" keeps its fallback instead of
// silently resolving to undefined.
//
// NB: no backticks in this comment. This whole block lives inside a template
// literal, and a backtick closes it — which is how a comment about a bundler
// token breaks the document it is describing.
window.__architect_env = Object.freeze({});

/*
 * The rest of the shims.
 *
 * The preview is served over plain HTTP on whatever host the developer is
 * browsing from - a LAN address such as 192.168.x.x when working from a phone.
 * That is not a secure context, and several Web Crypto methods are gated on
 * being one. So an app that called crypto.randomUUID() - which is what most id
 * generation looks like now - threw "crypto.randomUUID is not a function" and
 * took the entire screen down. The app was correct; the host was not.
 *
 * These are shims rather than polyfills in the general sense: each covers a
 * method genuinely unavailable in this context and falls back to something
 * equivalent. randomUUID is built on getRandomValues, which *is* available over
 * HTTP, so the ids are as random as the platform allows.
 */
(function () {
  var c = window.crypto;
  if (!c) return;
  if (typeof c.randomUUID !== "function") {
    c.randomUUID = function () {
      var b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push((b[i] + 0x100).toString(16).slice(1));
      return (
        hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
        hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" +
        hex.slice(10, 16).join("")
      );
    };
  }

  // structuredClone is gated the same way, and a failure there is just as fatal
  // and just as opaque.
  if (typeof window.structuredClone !== "function") {
    window.structuredClone = function (value) {
      return JSON.parse(JSON.stringify(value));
    };
  }
})();
</script>
<script>
  // Surface the real error instead of leaving a blank page. A blank preview is
  // the most demoralising thing a builder can see, because it looks exactly
  // like "the agent gave up".
  (function () {
    var box = document.getElementById("__architect_error");
    function show(what, detail) {
      box.style.display = "block";
      box.textContent = what + "\\n\\n" + (detail || "");
    }
    // Mirror failures to the parent window.
    //
    // An exception inside a nested browsing context is reported to that context's
    // own console, which nobody is watching. So the preview can be blank for any
    // number of reasons and look identical every time - which is exactly how a
    // sandbox bug survived several rounds of "it renders fine for me". Posting the
    // cause to the parent lets the panel name it.
    function report(what, detail) {
      try {
        parent.postMessage(
          { source: "architect-preview", level: "error", text: what + (detail ? "\\n\\n" + detail : "") },
          "*"
        );
      } catch (e) {
        // Cross-origin parent: nothing to do, and not worth breaking the preview over.
      }
    }
    window.addEventListener("error", function (e) {
      var detail = (e.error && e.error.stack) || e.message || String(e.error);
      show("The app threw an error", detail);
      report("The app threw an error", detail);
    });
    window.addEventListener("unhandledrejection", function (e) {
      var detail = String((e.reason && e.reason.stack) || e.reason);
      show("The app threw an unhandled promise rejection", detail);
      report("The app threw an unhandled promise rejection", detail);
    });
    window.__ARCHITECT_FILES__ = ${safeJson(included.join("\n"))};
  })();
</script>
<script>
${escapeForScript(code)}
</script>
</body>
</html>`;
}

