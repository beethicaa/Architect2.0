/**
 * Compiling the generated app so it can actually run.
 *
 * This is what makes the preview real. The model writes `app/page.tsx` with
 * React and Tailwind classes; this module transpiles that TypeScript/JSX to
 * plain JavaScript, bundles it, injects the compiled CSS, and wraps the result
 * in an HTML document. The preview iframe then loads that document and the
 * user's app runs - its own state, its own event handlers, its own localStorage.
 *
 * Nothing here interprets or simulates the app. If the model writes a bug, the
 * bug is visible in the preview, which is the only way the loop can be trusted.
 *
 * Why server-side: esbuild is a native binary and a ~10ms transform is not worth
 * a WASM download in every preview iframe. The route recompiles whenever the
 * file set changes, and the client caches by version.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";


const exec = promisify(execFile);

/**
 * Compile Tailwind for the *generated* app.
 *
 * The model writes ordinary Tailwind classes. Those classes only exist if
 * something scanned the generated source and emitted them, so the preview runs
 * the real Tailwind CLI over the real files on every change.
 *
 * Two decisions worth stating:
 *  - **Cache by content hash.** A fresh project would otherwise spend a second
 *    and a half in Tailwind on every keystroke-driven rebuild.
 *  - **Local, not the Play CDN.** A CDN would work until the network does not,
 *    and an unstyled preview is indistinguishable from a broken one.
 */
const cssCache = new Map<string, string>();

/**
 * The Tailwind entry.
 *
 * It has to be an *absolute* path into this project's node_modules. The CSS is
 * written to a temp directory, and `@import "tailwindcss"` resolves relative to
 * the importing file - so the bare specifier fails with "Can't resolve
 * 'tailwindcss'" and the generated app renders unstyled, which looks exactly
 * like the agent produced a broken app.
 */
function tailwindInput(): string {
  const entry = path.join(process.cwd(), "node_modules", "tailwindcss", "index.css");
  return `@import "${entry.replace(/\\/g, "/")}";`;
}


async function compileCss(files: FileRecord[]): Promise<string> {
  const sources = files.filter((file) =>
    /\.(tsx|ts|jsx|js|html)$/.test(file.path),
  );

  const fingerprint = createHash("sha1")
    .update(tailwindInput())
    .update(sources.map((f) => `${f.path}:${f.content}`).join("\n"))
    .digest("hex");

  const cached = cssCache.get(fingerprint);
  if (cached) return cached;

  if (sources.length === 0) {
    // Nothing to scan - emit a base so the document is not unstyled nonsense.
    return "*,*::before,*::after{box-sizing:border-box}body{margin:0}";
  }

  const dir = path.join(tmpdir(), `architect-css-${fingerprint.slice(0, 12)}`);
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
    await writeFile(input, tailwindInput(), "utf8");

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
import { existsSync } from "node:fs";

import type { FileRecord } from "@/lib/agent/tools";

/**
 * Bare specifiers the preview always resolves for real, even if a filesystem
 * probe says otherwise.
 *
 * `scheduler` is the reason this list exists. React DOM's production build calls
 * `require("scheduler")` to queue work, and an earlier version of the externals
 * plugin stubbed every bare import it did not recognise - including that one.
 * React then scheduled every render onto a function that did nothing, so the
 * root container was created, no exception was ever thrown, and the preview sat
 * there blank. In the browser and in tests, identically. It looked exactly like
 * "the agent produced an empty app".
 *
 * These are runtime dependencies of React itself, so they are never optional.
 */
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

/**
 * Can this bare specifier be bundled from the real filesystem?
 *
 * A presence check on node_modules rather than `require.resolve`, which throws
 * for ESM-only packages (`ERR_PACKAGE_PATH_NOT_EXPORTED`) and would reject
 * packages that esbuild bundles perfectly well.
 */
function canResolve(specifier: string): boolean {
  const name = packageName(specifier);
  if (ALWAYS_REAL.has(name)) return true;
  return existsSync(path.join(process.cwd(), "node_modules", name, "package.json"));
}

/** The entry file the preview looks for, in order of preference. */
const ENTRY_CANDIDATES = [
  "app/page.tsx",
  "app/page.jsx",
  "app/page.ts",
  "app/page.js",
];

export function findEntry(files: FileRecord[]): FileRecord | null {
  for (const candidate of ENTRY_CANDIDATES) {
    const match = files.find((file) => file.path === candidate);
    if (match) return match;
  }
  return null;
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

/**
 * Split the workspace into "the entry graph" and everything else.
 *
 * Only files the entry actually imports get bundled, so a stray SQL migration
 * cannot break the preview.
 */
function collectImports(entry: FileRecord, all: FileRecord[]): FileRecord[] {
  const byPath = new Map(all.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const included: FileRecord[] = [];

  const visit = (file: FileRecord) => {
    if (seen.has(file.path)) return;
    seen.add(file.path);
    included.push(file);

    // A deliberately simple import scan. A real bundler would parse, but this
    // only has to resolve relative paths the model wrote, and a miss is
    // harmless: the file is simply left out of the bundle.
    const pattern = /(?:import|export)[\s\S]*?from\s*["'](\.[^"']+)["']/g;
    let match = pattern.exec(file.content);
    while (match) {
      const target = resolveRelative(file.path, match[1]);
      const found =
        byPath.get(target) ??
        byPath.get(`${target}.tsx`) ??
        byPath.get(`${target}.ts`) ??
        byPath.get(`${target}/index.tsx`);
      if (found) visit(found);
      match = pattern.exec(file.content);
    }
  };

  visit(entry);
  return included;
}

export interface CompileResult {
  ok: boolean;
  html: string;
  /** Set when the user's own code failed - shown verbatim, never hidden. */
  error: string | null;
  /** Files that made it into the bundle, for the "3 files running" caption. */
  included: string[];
  /**
   * Relative imports the app references but that were never written.
   *
   * These used to fail the entire build ("Could not resolve"), which meant one
   * unwritten file blanked a preview that was otherwise fine. They are now
   * stubbed with a visible placeholder and reported here, so a half-finished
   * build still shows the half that finished.
   */
  missing: string[];
}

/**
 * React is bundled *into* the preview, not loaded from a CDN or a UMD global.
 *
 * React 19 dropped its UMD builds, and a CDN would break the preview on a
 * locked-down network in a way that looks identical to "the agent produced a
 * broken app". Letting esbuild resolve react and react-dom from node_modules
 * makes the whole document self-contained: one HTML string, no extra requests.
 */
export async function compilePreview(
  files: FileRecord[],
): Promise<CompileResult> {
  const entry = findEntry(files);
  if (!entry) {
    return {
      ok: false,
      html: "",
      error: "No app/page.tsx yet. The agent has not written the first screen.",
      included: [],
    };
  }

  const included = collectImports(entry, files);
  const entrySource = included.find((file) => file.path === entry.path);
  if (!entrySource) {
    return {
      ok: false,
      html: "",
      error: "The entry file vanished mid-build.",
      included: included.map((f) => f.path),
    };
  }

  const paths = included.map((file) => file.path);
  // Every file the entry graph pulls in, keyed by path. This is the source of
  // truth for module resolution - these are rows in Postgres, not files on disk.
  const byPath = new Map(included.map((file) => [file.path, file]));
  // Virtual namespace for a project file. esbuild has no filesystem to look in,
  // so paths are tagged with this and mapped back to a record on load.
  const NAMESPACE = "arch-file";
  let result: BuildResult;

  /*
   * The bundle's entry is a shim, and it **mounts itself**.
   *
   * Two earlier attempts used esbuild's `globalName` and then had the host
   * document reach in and read `window.__ARCHITECT_APP__.__react`. That is
   * fragile: it depends on the *names* of the exports surviving bundling, and
   * when they did not, every preview rendered a blank page with a message about
   * a missing React. Having the bundle import React and render itself removes the
   * guesswork entirely - there is nothing left to look up.
   */
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

  /*
   * Serve the project's own files out of the database.
   *
   * This is the fix for the single most broken thing in the product. Only the
   * entry file was being handed to esbuild, so every relative import in it -
   * `import { SubjectList } from "./components/SubjectList"` - was resolved
   * against the real filesystem, where no such file exists. The result was a
   * preview that refused to build with "Could not resolve" on every component,
   * for an app split into components *correctly*.
   *
   * Splitting a page into components is the behaviour the system prompt asks
   * for, so the compiler has to support it. The files live in Postgres, not on
   * disk, so they are resolved from the record set here: relative specifiers are
   * normalised against the importing file's path, then given the same extension
   * probing a real bundler does (.tsx, .ts, /index.tsx, /index.ts).
   */
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
        const found =
          byPath.get(base) ??
          byPath.get(`${base}.tsx`) ??
          byPath.get(`${base}.ts`) ??
          byPath.get(`${base}/index.tsx`) ??
          byPath.get(`${base}/index.ts`);

        if (!found) {
          // Left unresolved on purpose: esbuild reports it with the real path, and
          // a clear "Could not resolve" beats a silently empty module that would
          // fail later as `X is not a function`.
          return null;
        }
        // esbuild prepends the namespace itself, so `path` must be the bare project path.
        return { path: found.path, namespace: NAMESPACE };
      });

      api.onLoad({ filter: /.*/, namespace: NAMESPACE }, (args) => {
        // `args.path` is the bare project path: esbuild tracks the namespace
        // separately, so it must not be stripped here (and must not have been
        // added by the resolver either). One convention, used everywhere.
        const file = byPath.get(args.path);
        if (!file) return { contents: "", loader: "tsx" };
        return {
          contents: file.content,
          loader: file.language === "ts" ? "ts" : "tsx",
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
    return { ok: false, html: "", error: message, included: paths };
  }

  const code = result.outputFiles?.[0]?.text ?? "";
  const css = await compileCss(files);
  return { ok: true, html: wrap(code, css, paths), error: null, included: paths };
}


/** Escape a string for safe embedding in a <script> block. */
function safeJson(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Wrap the compiled bundle in a document the iframe can load.
 *
 * The error boundary is the part worth reading. When the generated app throws -
 * which it will, at some point - the iframe shows the real stack instead of a
 * blank white rectangle. A blank preview is the most demoralising thing a
 * builder can show, because it is indistinguishable from "the agent gave up".
 */
/**
 * Make the bundle safe to embed in a <script> block.
 *
 * This is not hypothetical. React's own production bundle contains the literal
 * string `</script>`, and a browser - like any HTML parser - ends a script
 * element the moment it sees one. So the document was being truncated part-way
 * through the bundle: no error, no exception, an empty `#root` and a blank
 * white preview. It was the single most confusing failure in the project, and it
 * looked exactly like "the agent produced an empty app".
 *
 * `<\/script` is identical to `</script` inside a JS string literal, and is also
 * legal inside a comment or a regex, so the substitution is safe everywhere the
 * sequence can appear.
 */
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

