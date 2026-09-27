/**
 * Pre-bundle React for the preview.
 *
 * The preview compiler resolves `react`, `react-dom/client` and
 * `react/jsx-runtime` at runtime, and that works on a machine with a
 * `node_modules` next to the code. It does not work on Vercel: a serverless
 * function's runtime filesystem does not contain the React package, so esbuild
 * reported "Could not resolve" for the mount script and for every JSX element in
 * the user's app - files present, nothing rendered, and no error that pointed
 * anywhere near the cause.
 *
 * So React is bundled here instead, at *build* time, when `node_modules` is
 * certainly present, and written into `public/`. That directory is deployed as
 * static files, so the compiled preview can import a real file that exists at
 * runtime in every environment. One build artefact, no runtime resolution.
 *
 * Run from `prebuild`, so it can never be stale.
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "public", "preview", "react-runtime.js");

/**
 * Re-exports exactly the three specifiers the generated code and the mount
 * script import. Nothing else is pulled in deliberately: a barrel that dragged
 * in `react-dom/server` or the test utilities would triple the size of every
 * preview for no benefit.
 */
const ENTRY = `
export * as React from "react";
export * as ReactDOMClient from "react-dom/client";
export * as JsxRuntime from "react/jsx-runtime";
export { default as ReactDefault } from "react";
`;

mkdirSync(dirname(outFile), { recursive: true });

const result = await build({
  stdin: {
    contents: ENTRY,
    resolveDir: root,
    sourcefile: "react-runtime-entry.js",
    loader: "js",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2020",
  // The generated app's own code is compiled in production mode; React has to
  // match, or its development warnings and double-invoked renders leak in.
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
});

const code = result.outputFiles[0].text;
writeFileSync(outFile, code, "utf8");

/*
 * One bundle, three shapes.
 *
 * A generated app imports `react` (default export), `react/jsx-runtime`
 * (named `jsx`/`jsxs`/`Fragment`) and `react-dom/client` (named `createRoot`).
 * Those are different module shapes, so the compiler cannot simply point all
 * three at one file - it is given a real file per specifier instead, each a
 * thin re-export of the single bundle. That keeps the work at build time and
 * leaves nothing to resolve at runtime.
 */
const wrappers = {
  "react.js": `
import { React, ReactDefault } from "./react-runtime.js";
export * from "react-runtime";
export default ReactDefault ?? React.React;
`,
  "jsx-runtime.js": `
import { JsxRuntime } from "./react-runtime.js";
export const Fragment = JsxRuntime.Fragment;
export const jsx = JsxRuntime.jsx;
export const jsxs = JsxRuntime.jsxs;
export const jsxDEV = JsxRuntime.jsxDEV;
export default JsxRuntime;
`,
  "jsx-dev-runtime.js": `
import { JsxRuntime } from "./react-runtime.js";
export const Fragment = JsxRuntime.Fragment;
export const jsxDEV = JsxRuntime.jsxDEV;
export default JsxRuntime;
`,
  "react-dom-client.js": `
import { ReactDOMClient } from "./react-runtime.js";
export const createRoot = ReactDOMClient.createRoot;
export const hydrateRoot = ReactDOMClient.hydrateRoot;
export default ReactDOMClient;
`,
};

for (const [name, source] of Object.entries(wrappers)) {
  writeFileSync(join(dirname(outFile), name), source.trimStart(), "utf8");
}

console.log(
  `react runtime: ${(code.length / 1024).toFixed(0)}KB -> public/preview/ (${Object.keys(wrappers).length + 1} files)`,
);
