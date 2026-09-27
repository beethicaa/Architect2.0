/**
 * `npm run env:check` - the first thing to run when something is not working.
 *
 * Six questions, in order:
 *   1. Is .env.local there, and does it have the Supabase pair?
 *   2. Does Supabase actually answer with that URL and key?
 *   3. Is ANTHROPIC_API_KEY set? (Without it the product refuses to fake a build.)
 *   4. Do every "use server" module's exports follow the async-only rule?
 *   5. Does every catch that can see a redirect() re-throw it first?
 *   6. Do the agent's tools and the preview compiler actually work?
 *
 * 4-6 exist because each of those bugs shipped once and none were caught by
 * `npm run build`. See docs/real-vs-dummy.md.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { compilePreview, findEntry } from "../lib/agent/preview.ts";
import { TOOL_DEFINITIONS, validatePath } from "../lib/agent/tools.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

const out = [];
let failed = false;

function ok(msg) {
  out.push(`  [ok]   ${msg}`);
}
function bad(msg) {
  out.push(`  [FAIL] ${msg}`);
  failed = true;
}
function hint(msg) {
  out.push(`         -> ${msg}`);
}

/*
 * A malformed value in .env.local, caught before it can break anything.
 *
 * `NEXT_PUBLIC_SITE_URL==http://localhost:3000` - one stray `=` - sat in that file
 * for hours. The value became `=http://localhost:3000`, so every OAuth redirect
 * URI was malformed and sign-in silently failed while `tsc`, `eslint`,
 * `next build` and `env:check` all reported success. None of them can see the
 * contents of a dotenv file, which is why this parses it the way Next does.
 */
/*
 * Exactly one import planner.
 *
 * There were two `planImport` functions for most of this session: the original in
 * `codebase.ts` (40 files / 220KB) and the rewritten one in `import-plan.ts`
 * (400 files / 2MB, ranked by role). The import action imported the *old* one, so
 * every fix to the ranking and the budget changed a function nothing called, and the
 * symptom stayed exactly "kept 9 of 81 files" through five rounds of confident, wrong
 * diagnosis. A duplicated entry point with a stable name is invisible to the type
 * checker and to review, so it is checked here.
 */
{
  const defs = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && /export function planImport\b/.test(readFileSync(full, "utf8"))) {
        defs.push(full.slice(full.indexOf("lib") + 4).replace(/\\/g, "/"));
      }
    }
  };
  walk(join(root, "lib"));
  if (defs.length === 1) {
    ok(`one import planner decides which files are kept (${defs[0]})`);
  } else {
    bad(`planImport is defined in ${defs.length} modules: ${defs.join(", ")} - delete the stale one`);
  }
}

{
  const envFile = join(root, ".env.local");
  const problems = [];
  if (existsSync(envFile)) {
    const raw = readFileSync(envFile, "utf8");
    raw.split(/\r?\n/).forEach((line, index) => {
      const text = line.trim();
      if (!text || text.startsWith("#")) return;
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(text);
      if (!match) {
        problems.push(`line ${index + 1} is not KEY=VALUE`);
        return;
      }
      const [, key, value] = match;
      if (value.startsWith("=")) {
        problems.push(`line ${index + 1}: ${key} has a doubled "=" so its value is "${value}"`);
      }
      if (key.endsWith("URL") && value && !/^https?:\/\//.test(value)) {
        problems.push(`line ${index + 1}: ${key} is not a URL ("${value}")`);
      }
    });
  }
  if (problems.length > 0) {
    for (const problem of problems) bad("env: " + problem);
  } else {
    ok('.env.local is well formed - no doubled "=" and every *_URL is a URL');
  }
}

function head(msg) {
  out.push("", msg);
}
function section(msg) {
  out.push("", msg);
}

out.push("", "Architect 2.0 - environment check", "=".repeat(44));

/* -- 1. the file exists ---------------------------------------------------- */

if (!existsSync(envPath)) {
  bad(".env.local is missing");
  hint("Copy .env.local.example to .env.local, then add your keys.");
} else {
  ok(".env.local found");
}

/* -- 2. parse it ----------------------------------------------------------- */

const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

/* -- 3. supabase ---------------------------------------------------------- */

head("Supabase (auth + database)");

const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const key =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

if (!url) {
  bad("NEXT_PUBLIC_SUPABASE_URL is empty");
  hint("Dashboard -> Project Settings -> API -> Project URL");
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url)) {
  bad("NEXT_PUBLIC_SUPABASE_URL does not look like a Supabase URL: " + url);
  hint("Expected https://xxxxxxxx.supabase.co, with no trailing slash");
} else {
  ok("NEXT_PUBLIC_SUPABASE_URL = " + url);
}

if (!key) {
  bad("SUPABASE key is empty");
  hint("Project Settings -> API Keys -> publishable (or anon public). NOT service_role.");
} else if (key.startsWith("sb_secret") || /service_role/i.test(key)) {
  bad("That looks like a SECRET key, which must never reach the browser");
  hint("Use the publishable / anon public key instead.");
} else {
  ok(
    "SUPABASE key = " + key.slice(0, 12) + "..." + key.slice(-4) + " (" + key.length + " chars)",
  );
}

/* -- 4. connectivity ------------------------------------------------------ */

section("Connectivity");

if (url && key) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.ok) ok("Supabase responded - the URL and key are valid");
    else bad(`Supabase answered ${response.status} - check the key`);
  } catch (error) {
    bad("Could not reach Supabase: " + (error instanceof Error ? error.message : error));
  }
} else {
  hint("Skipped: no URL or key to test with.");
}

/* -- 5. the database schema ---------------------------------------------- */

head("Database schema");
hint("Run supabase/migrations/0001_core_schema.sql, then 0002_project_files.sql.");
hint("Without them, auth works but the agent has nowhere to write files.");

/* -- 6. the agent --------------------------------------------------------- */

section("The agent (Groq)");

const groqKey = env.GROQ_API_KEY || "";
const model = env.GROQ_MODEL || "openai/gpt-oss-120b";

if (!groqKey) {
  bad("GROQ_API_KEY is not set");
  hint("Create a key at https://console.groq.com/keys and put it in .env.local.");
  hint("Architect will not pretend to build your app without it - by design.");
} else if (groqKey.startsWith("gsk_")) {
  ok("GROQ_API_KEY is set (" + groqKey.length + " chars)");
  ok("model = " + model);

  // Prove the key works, rather than only proving it has the right prefix. A
  // revoked or mistyped key is otherwise discovered as a confusing 401 halfway
  // through a build.
  try {
    const base = env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${groqKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (response.ok) {
      const body = await response.json();
      const ids = (body.data ?? []).map((m) => m.id);
      ok(`Groq responded - ${ids.length} models available`);
      if (!ids.includes(model)) {
        hint(`The configured model "${model}" is not in the list above.`);
        hint(`Available: ${ids.slice(0, 6).join(", ")}`);
      } else {
        ok(`"${model}" is available`);
      }
    } else {
      bad(`Groq answered ${response.status} - the key was rejected`);
    }
  } catch (error) {
    bad("Could not reach Groq: " + (error instanceof Error ? error.message : error));
  }
} else {
  bad("GROQ_API_KEY does not look like a Groq key (expected gsk_...)");
}

/* -- 6b. client components must not read server-only env ---------------- */

section("Server-only env in client components");

/**
 * `process.env.GROQ_API_KEY` is server-only: Next inlines just the
 * `NEXT_PUBLIC_*` names into the browser bundle, so a client component asking
 * for anything else always gets undefined.
 *
 * That shipped as "the builder refuses to run with a valid key already in
 * `.env.local`", and it typechecked and built cleanly. The capability now comes
 * down as a prop from a Server Component, and this check stops it coming back.
 */
const clientLeaks = [];

function checkClientEnv(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      checkClientEnv(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;

    const source = readFileSync(full, "utf8");
    if (!/^\s*["']use client["']/m.test(source)) continue;
    if (!/from\s+["']@\/lib\/env["']/.test(source)) continue;

    // lib/env.ts also exports pure helpers (getSiteUrl, the hint strings) that
    // are safe in the browser. Only a configured-flag import is a real leak,
    // because those are the ones computed from server-only variables.
    const imported = /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/env["']/.exec(source);
    const names = imported ? imported[1] : "";
    for (const flag of ["isGroqConfigured", "isGitHubConfigured", "isVercelConfigured"]) {
      if (new RegExp(`\\b${flag}\\b`).test(names)) clientLeaks.push(`${full}: ${flag}`);
    }
  }
}

for (const dir of [join(root, "components"), join(root, "hooks")]) {
  checkClientEnv(dir);
}

if (clientLeaks.length === 0) {
  ok("no client component reads a server-only configuration flag");
} else {
  bad("A client component reads a server-only env flag");
  for (const leak of clientLeaks) {
    hint(leak + " - pass it down as a prop from a Server Component instead.");
  }
}

/* -- 7. server action exports -------------------------------------------- */

section("Server Action modules");

/**
 * A `"use server"` module may only export async functions. Exporting a plain
 * constant invalidates the whole module, and every action in it then fails at
 * runtime with a 500 and an empty stack - which is exactly what shipped once.
 */
const offenders = [];

function checkActionFile(file) {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use server["']/m.test(source)) return;

  const pattern = /export\s+(?:async\s+)?(const|let|function|class)\s+(\w+)/g;
  let match = pattern.exec(source);
  while (match) {
    if (match[1] === "function" || match[1] === "class") {
      if (!new RegExp(`export\\s+async\\s+function\\s+${match[2]}\\b`).test(source)) {
        offenders.push(`${file}: ${match[2]} is not async`);
      }
    } else {
      offenders.push(`${file}: ${match[2]} is a ${match[1]}, not an async function`);
    }
    match = pattern.exec(source);
  }
}

function walkActions(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkActions(full);
    else if (entry.name.endsWith(".ts")) checkActionFile(full);
  }
}

walkActions(join(root, "lib", "actions"));

if (offenders.length === 0) {
  ok('every "use server" module exports only async functions');
} else {
  bad('A "use server" module exports a non-async value');
  for (const name of offenders) {
    hint(name + " - move the constant to a normal module and import it.");
  }
}

/* -- 8. redirect inside try/catch ----------------------------------------- */

section("redirect() inside try/catch");

/**
 * `redirect()` throws. A `catch` that swallows it turns a successful sign-in
 * into "could not reach Supabase", which is what shipped once and sent the user
 * hunting for a key that was already correct.
 */
const swallowing = [];

function checkRedirect(file) {
  const source = readFileSync(file, "utf8");
  const blocks = source.match(/try\s*\{[\s\S]*?\n\s*\}\s*catch[\s\S]*?\n\s*\}/g) ?? [];
  for (const block of blocks) {
    const hasRedirect = /\bredirect\(/.test(block.slice(0, block.indexOf("catch")));
    const catchPart = block.slice(block.indexOf("catch"));
    if (hasRedirect && !/rethrowNavigation\(/.test(catchPart)) swallowing.push(file);
  }
}

function findSwallowing(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findSwallowing(full);
    else if (entry.name.endsWith(".ts")) checkRedirect(full);
  }
}

findSwallowing(join(root, "lib", "actions"));

if (swallowing.length === 0) {
  ok("every catch that can see a redirect() re-throws it first");
} else {
  bad("A catch block may be swallowing redirect()");
  for (const name of swallowing) {
    hint(name + ": call rethrowNavigation(error) first in the catch");
  }
}


/* -- 9. the agent's tools ------------------------------------------------- */

section("Agent tools");

// Groq uses the OpenAI function shape: the name lives at `.function.name`.
const names = TOOL_DEFINITIONS.map((tool) => tool.function.name);
const required = ["list_files", "read_file", "write_file", "delete_file", "finish"];
const missing = required.filter((name) => !names.includes(name));

if (missing.length === 0) {
  ok(`all ${required.length} tools defined (${names.join(", ")})`);
} else {
  bad("The agent is missing tools: " + missing.join(", "));
  hint("Without finish, the loop has no exit and always runs to the cap.");
}

const escapes = [
  "../../.env",
  "/etc/passwd",
  "secrets/key.txt",
  "node_modules/evil.js",
];
const allowed = [
  "app/page.tsx",
  "lib/types/domain.ts",
  "supabase/migrations/0002_x.sql",
];
const wrongPaths = [
  ...escapes.filter((path) => validatePath(path) === null),
  ...allowed.filter((path) => validatePath(path) !== null),
];

if (wrongPaths.length === 0) {
  ok("path validation rejects traversal and allows the project tree");
} else {
  bad("Path validation is wrong for: " + wrongPaths.join(", "));
  hint("Every path the model sends goes through validatePath() before it is stored.");
}

/* -- 10. the preview compiler --------------------------------------------- */

section("Preview compiler");

try {
  // A file written the way the system prompt tells the model to write one.
  const sample = [
    {
      path: "app/page.tsx",
      content:
        '"use client";\nimport { useState } from "react";\n' +
        "export default function Page() {\n" +
        "  const [n, setN] = useState(0);\n" +
        '  return <main className="p-8"><h1 className="text-2xl">Hello</h1>' +
        "<button onClick={() => setN(n + 1)}>{n}</button></main>;\n}",
      language: "tsx",
      prevLines: 0,
      version: 1,
    },
  ];

  if (findEntry(sample) === null) bad("findEntry did not locate app/page.tsx");

  const result = await compilePreview(sample);

  if (!result.ok) {
    bad("A valid app failed to compile: " + (result.error ?? "unknown"));
  } else if (result.html.includes("<script src=")) {
    bad("The preview loads React from a script tag");
    hint("It must be bundled in - a CDN would fail offline and look like a broken app.");
  } else if (!result.html.includes("createRoot")) {
    bad("The compiled bundle does not mount itself");
    hint("Without a createRoot call the iframe renders an empty #root: a blank preview.");
  } else {
    ok("compiles TSX, bundles React, and emits a self-contained document");
  }

  /* The check that actually matters, and the one whose absence cost the most.
   *
   * Every <script> body is parsed with the real JavaScript engine. Two separate
   * blank-preview bugs got through type checking, lint and a successful build
   * because both produced a *valid* HTML document containing *invalid* JavaScript:
   *
   *   1. React's own bundle contains the literal `</script>`, which closed the
   *      script element early and truncated the bundle.
   *   2. A "\n" written inside a template literal became a real newline inside a
   *      JS string literal, so the error-reporting block was a syntax error - and
   *      the preview went blank with the one thing that would have explained it
   *      also broken.
   *
   * Neither is visible to `tsc`, to eslint, or to a build. Only parsing the emitted
   * script catches them, which is why it is asserted rather than eyeballed.
   */
  const scriptBodies = [...result.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  );
  const syntaxErrors = [];
  for (const [index, body] of scriptBodies.entries()) {
    try {
      new vm.Script(body);
    } catch (error) {
      syntaxErrors.push(`block ${index}: ${error.message}`);
    }
  }

  if (syntaxErrors.length === 0) {
    ok(`all ${scriptBodies.length} script blocks in the preview parse as JavaScript`);
  } else {
    bad("The preview document contains invalid JavaScript: " + syntaxErrors.join("; "));
    hint(
      "A malformed script means a blank preview with no message. Note that \\n inside a " +
        "template literal becomes a real newline - write \\\\n.",
    );
  }

  // A multi-file app must compile. This is the check that matters most: the
  // compiler originally only ever received the entry file, so every relative
  // import failed with "Could not resolve" and *no app split into components
  // could ever preview* - while the agent was being told to split files, and the
  // type checker, the linter and the build were all perfectly happy.
  const multi = await compilePreview([
    {
      path: "app/page.tsx",
      language: "tsx",
      prevLines: 0,
      version: 1,
      content:
        'import { useState } from "react";\n' +
        'import SubjectList from "./components/SubjectList";\n' +
        'import { load } from "../lib/storage";\n' +
        "export default function Page() {\n" +
        "  const [n, setN] = useState(0);\n" +
        '  return <div><SubjectList />{load()}{n}</div>;\n' +
        "}",
    },
    {
      path: "app/components/SubjectList.tsx",
      language: "tsx",
      prevLines: 0,
      version: 1,
      content: "export default function SubjectList() { return <ul><li>Physics</li></ul>; }",
    },
    {
      path: "lib/storage.ts",
      language: "ts",
      prevLines: 0,
      version: 1,
      content: "export const load = () => null;",
    },
  ]);

  if (!multi.ok) {
    bad("A multi-file app failed to compile: " + (multi.error ?? "unknown"));
    hint(
      "Relative imports are resolved from the database, not the filesystem. If this " +
        "fails, the project-files plugin is not interceptoring them.",
    );
  } else if (multi.included.length !== 3) {
    bad(
      `The import graph found ${multi.included.length} of 3 files: ` +
        multi.included.join(", "),
    );
    hint("collectImports() walks the entry's relative imports; all three must be found.");
  } else {
    ok("resolves relative imports across app/ and lib/ (multi-file apps compile)");
  }

  // The reporter is the thing that makes a future blank preview debuggable, so
  // its presence is asserted rather than assumed.
  if (result.html.includes("architect-preview")) {
    ok("preview errors are mirrored to the parent window");
  } else {
    bad("The preview does not report errors to the parent");
    hint("Without it, a crash inside the iframe is invisible outside its own console.");
  }

  // Broken code must fail loudly. A blank preview is the worst outcome there is.
  const broken = await compilePreview([
    { ...sample[0], content: "export default function Page() { return <div>" },
  ]);
  if (broken.ok) {
    bad("Unbalanced JSX compiled successfully");
    hint("A silent pass here means the user sees a blank preview and no reason why.");
  } else {
    ok("a syntax error is reported with a real message");
  }
} catch (error) {
  bad("could not run the preview checks");
  hint(String(error));
}

/* -- guards added after the product was built -------------------------------- */

// Each of these exists because the thing it checks was broken in a way that
// `tsc`, `eslint` and `next build` all reported as fine.
{
  // `checkpoints_one_head_idx` is a partial unique index on (project_id) where
  // is_head. That makes the order load-bearing: inserting a new head while an
  // old one exists is a 23505, so every checkpoint after the first was rejected
  // and a project showed one entry no matter how many builds it had.
  const cp = readFileSync(join(root, "lib/pipeline/checkpoints.ts"), "utf8");
  const demote = cp.search(/is_head: false/);
  const insert = cp.search(/\.insert\(\{/);
  if (demote === -1 || insert === -1 || demote > insert) {
    bad("history: a new head is inserted before the old one is demoted, so every checkpoint after the first fails");
  }

  // Every write must leave a trail, including ones that do not come from the
  // agent loop (repair, import, settings).
  const ws = readFileSync(join(root, "lib/pipeline/workspace.ts"), "utf8");
  if (!/createCheckpoint/.test(ws)) {
    bad("history: file writes record no checkpoint, so changes outside the agent loop leave no trail");
  }

  // Per-change checkpoints, newest-first, one-way undo.
  const run = readFileSync(join(root, "lib/pipeline/run.ts"), "utf8");
  if ((run.match(/createCheckpoint\(\{/g) ?? []).length < 2) {
    bad("history: the pipeline writes one checkpoint per run, not one per change");
  }
  if (!/error: "not-older"/.test(cp)) {
    bad("history: undo is not one-way");
  }
}

// A single global scroll rule breaks one screen to fix the other: the builder
// needs no outer scroll, the dashboard needs one.
{
  const shellPath = join(root, "components/layout/workspace-shell.tsx");
  const shell = existsSync(shellPath) ? readFileSync(shellPath, "utf8") : "";
  if (!/isWorkspace \? "overflow-hidden" : "overflow-y-auto"/.test(shell)) {
    bad("scroll: the scroll container is not decided per route, so either the builder or the dashboard will be wrong");
  }
  const layout = readFileSync(join(root, "app/(app)/layout.tsx"), "utf8");
  if (shell && !/<WorkspaceShell>[\s\S]*OnboardingGate[\s\S]*<\/WorkspaceShell>/.test(layout)) {
    bad("scroll: the onboarding gate sits outside the scroll container");
  }
}

// The lens has to change the screens, not just the toggle.
{
  const lensFiles = [
    "app/(app)/dashboard/page.tsx",
    "app/(app)/profile/page.tsx",
    "app/(app)/projects/settings/page.tsx",
  ];
  const missing = lensFiles.filter(
    (file) => !/isDeveloper/.test(readFileSync(join(root, file), "utf8")),
  );
  if (missing.length > 0) {
    bad("lens: these screens never read the lens, so they look the same in both modes: " + missing.join(", "));
  }
  const run = readFileSync(join(root, "lib/pipeline/run.ts"), "utf8");
  if (!/if \(!isDeveloper\) return \{\};/.test(run)) {
    bad("lens: per-agent model pins are not gated on the lens in the pipeline");
  }
}

// The footer is defined once and rendered on every full screen.
{
  const footer = readFileSync(join(root, "components/layout/site-footer.tsx"), "utf8");
  const screens = [
    "app/(auth)/layout.tsx",
    "app/(app)/layout.tsx",
    "app/auth/error/page.tsx",
    "app/page.tsx",
  ];
  const withoutFooter = screens.filter(
    (file) => !readFileSync(join(root, file), "utf8").includes("<SiteFooter"),
  );
  if (withoutFooter.length > 0) {
    bad("footer: no footer on " + withoutFooter.join(", "));
  }
  if ((footer.match(/function SiteFooter/g) ?? []).length > 1) {
    bad("footer: defined more than once");
  }
}

/*
 * Google sign-in has to start in the browser.
 *
 * It was a Server Action: `<form action={signInWithGoogle}>` calling
 * `signInWithOAuth`. PKCE keeps its `code_verifier` in a cookie the *server* has
 * to set, and a Server Action that immediately calls `redirect()` drops that
 * Set-Cookie often enough that the callback arrived with no verifier and failed
 * with "Sign-in could not be completed". Google had authenticated the user; the
 * exchange could not finish. The browser client writes that cookie itself, which
 * is why the handshake belongs there.
 */
{
  const form = readFileSync(join(root, "components/auth/auth-form.tsx"), "utf8");
  // Comments stripped: the note above quotes the old form so a future reader
  // knows what changed, and matching it would flag correct code. This has now
  // bitten three separate checks, which is why it is a helper rather than a
  // one-off.
  const formCode = form.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
  if (/<form action=\{signInWithGoogle\}/.test(formCode)) {
    bad("auth: Google sign-in is a Server Action; the PKCE verifier it sets is lost on the redirect, so the exchange fails");
  }
  if (!/createClient\(\)[\s\S]{0,200}signInWithOAuth/.test(formCode)) {
    bad("auth: Google sign-in does not start from the browser client");
  }
  if (!/window\.location\.origin/.test(formCode)) {
    bad("auth: the OAuth redirect is not built from the address the user is actually on");
  }
}

/*
 * The GitHub callback must return to the page the connect started on.
 *
 * It used to always go to the settings page, because the OAuth `state` carried
 * no destination - so connecting from the dashboard threw you across the app.
 * The state now carries a signed return path, which is what makes the callback
 * able to put you back. These assertions cover the two halves: the path is
 * carried and used, and it cannot be forged into an off-site redirect.
 */
{
  const state = readFileSync(join(root, "lib/github/state.ts"), "utf8");
  const callback = readFileSync(join(root, "app/api/github/callback/route.ts"), "utf8");
  const connect = readFileSync(join(root, "app/api/github/connect/route.ts"), "utf8");

  if (!/signState\(userId: string, returnTo/.test(state)) {
    bad("github: the OAuth state carries no return path, so the callback cannot go back to where the user started");
  }
  if (!/startsWith\("\/\/"\)/.test(state)) {
    bad("github: the return path is not checked for a protocol-relative //host redirect");
  }
  if (!/verdict\.ok/.test(callback) || !/backTo\("connected", stateCookie\)/.test(callback)) {
    bad("github: the callback does not route back using the verified return path");
  }
  if (!/signState\(claims\.sub, returnTo\)/.test(connect)) {
    bad("github: the connect route does not record where the user started");
  }
}

/*
 * A link on a page that is meant to scroll, not navigate.
 *
 * The empty state's button used `href="start-a-project"` - a bare relative href,
 * which on `/dashboard` resolved to `/start-a-project`. That is not a route, so
 * clicking "Start from a description" produced a 404 for something that was only
 * ever meant to be a scroll on the same page.
 */
{
  const dash = readFileSync(join(root, "app/(app)/dashboard/page.tsx"), "utf8");
  // Strip comments first. The comment explaining this very bug quotes the old
  // `href={newProjectId}`, so matching the raw file flags correct code - the same
  // trap as matching `overflow-y-auto` in a comment about not using it.
  const dashCode = dash
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
  const bare = /href=\{?"?[a-zA-Z][\w-]*\}?"?/.exec(dashCode);
  if (bare && !bare[0].includes("#")) {
    bad(`dashboard: <a href=${bare[0]}> is a bare relative link and will 404; a scroll target needs a leading "#"`);
  }
  // Both deep-link targets have to exist, or the fragment scrolls nowhere.
  const panel = readFileSync(join(root, "components/dashboard/new-project-panel.tsx"), "utf8");
  for (const target of ["describe-it", "import-repo"]) {
    if (!dash.includes(target)) bad(`dashboard: the empty state never links to #${target}`);
    const owner =
      target === "describe-it" ? panel : readFileSync(join(root, "components/github/repo-picker.tsx"), "utf8");
    if (!owner.includes(target)) bad(`the #${target} target has no element carrying that id`);
  }
}

/*
 * The sign-in bug that cost the most time to find.
 *
 * `cookies().getAll()` returns only `{ name, value }`. Forwarding those onto a
 * redirect response with `response.cookies.set(name, value)` drops every option,
 * and Next then defaults `path` to the route being served - which scoped the
 * session cookie to `/auth/callback`. The browser never sent it to `/dashboard`,
 * the layout redirected to sign-in, and it looked like sign-in simply did not
 * stick. Both Google and email were affected, because both finish here.
 *
 * It is easy to reintroduce because it compiles, typechecks and looks correct.
 */
{
  const callback = readFileSync(join(root, "app/auth/callback/route.ts"), "utf8");
  const setCall = /response\.cookies\.set\(\s*cookie\.name,\s*cookie\.value([^)]*)\)/.exec(callback);
  if (setCall && !/path:\s*"\/"/.test(setCall[1])) {
    bad("auth: the callback forwards session cookies without `path: \"/\"`, so the session is scoped to /auth/callback and sign-in appears not to stick");
  }
  if (setCall && !/httpOnly/.test(setCall[1])) {
    bad("auth: the callback forwards session cookies without httpOnly");
  }
}

/* -- verdict -------------------------------------------------------------- */

out.push("", "=".repeat(44));
if (failed) {
  out.push("", "NOT READY - fix the items above, then run `npm run env:check` again.", "");
} else {
  out.push("", "READY - restart the dev server (`npm run dev`) and sign in at /sign-in.", "");
}

console.log(out.join("\n"));
process.exit(failed ? 1 : 0);

