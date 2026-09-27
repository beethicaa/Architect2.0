// Fetch the LIVE deployed preview as a real signed-in user, and report what the
// browser would actually receive. This is the test that every previous round was
// missing: everything before was verified against the source, never against the
// deployment.
import fs from "node:fs";

const env = {};
fs.readFileSync(".env.local", "utf8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
});

const SITE = "https://architect-v2-beethica.vercel.app";
const ID = "7a8c16ef-0046-4b65-b1ed-fca16809edb0";

// 1. Sign in through the app's OWN sign-in route, so the cookie is exactly what
//    the browser gets - same name, same encoding, same attributes.
const jar = [];
const signIn = await fetch(`${SITE}/auth/callback`, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code: "invalid-probe" }),
});
console.log("callback status (expected 4xx/5xx, proves the route exists):", signIn.status);
for (const c of signIn.headers.getSetCookie?.() ?? []) jar.push(c.split(";")[0]);
console.log("cookies set by callback:", jar.length);

// 2. Use the Supabase SDK to get a genuine session, then shape it the way
//    @supabase/ssr writes it, so the proxy accepts it.
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await sb.auth.signInWithPassword({
  email: "probe@test.local",
  password: "Probe12345!",
});
if (error) {
  console.log("sign-in failed:", error.message);
  process.exit(1);
}
console.log("signed in as:", data.user.email);

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const session = {
  access_token: data.session.access_token,
  token_type: data.session.token_type,
  expires_in: data.session.expires_in,
  expires_at: data.session.expires_at,
  refresh_token: data.session.refresh_token,
  user: data.user,
};
// @supabase/ssr writes the session cookie as "base64-<base64 of the JSON>".
// Without that prefix the proxy cannot parse it, and every route 401s - which is
// what happened on the first attempt at this probe.
const encoded = Buffer.from(JSON.stringify(session), "utf8").toString("base64");
const cookieValue = `base64-${encoded}`;
console.log("cookie name :", cookieName);
console.log("cookie value:", cookieValue.slice(0, 24) + "...");

// ---------------------------------------------------------------------------
// 4. Reproduce the route server-side, with RLS actually in force.
//
// The live route calls listFiles() on a client built from the *session* cookie.
// That is the one thing never tested: every earlier check read project_files
// with the service-role key, which BYPASSES row-level security. If the policy
// does not grant this user their own rows, the route reads nothing and answers
// "No app/page.tsx yet" for a project that has 61 files - the symptom reported.
// ---------------------------------------------------------------------------
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const { createServerClient } = await import("@supabase/ssr");
const jarMap = new Map([[cookieName, cookieValue]]);
const scoped = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: {
    getAll: () => [...jarMap].map(([name, value]) => ({ name, value })),
    setAll: () => undefined,
  },
});

const { listFiles } = await import("./lib/agent/tools.ts");
const rows = await listFiles(scoped, ID);
console.log("");
console.log("=== listFiles() through an RLS-scoped session ===");
console.log("files returned:", Array.isArray(rows) ? rows.length : rows);
if (Array.isArray(rows) && rows.length) {
  console.log("first 5:", rows.slice(0, 5).map((f) => f.path).join(", "));
}

// Compare against the service-role read of the same project.
const svc = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/project_files?select=path&project_id=eq.${ID}`,
  { headers: admin },
).then((r) => r.json());
console.log("service-role read:", Array.isArray(svc) ? svc.length : JSON.stringify(svc));

// And what the project row itself says about its owner.
const proj = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/projects?select=id,name,owner_id&id=eq.${ID}`,
  { headers: admin },
).then((r) => r.json());
console.log("");
console.log("project owner_id :", Array.isArray(proj) ? proj[0]?.owner_id : "n/a");
console.log("probe user id    :", data.user.id);
// ---------------------------------------------------------------------------
// 5. The decisive question: does the OWNER's own uid satisfy the policy?
//
// Everything so far ran as a probe user that does not own the project, so RLS
// correctly returned nothing and the live route said "No app/page.tsx yet". That
// is the same answer a genuine owner would get IF auth.uid() inside the policy
// does not match projects.owner_id. The two are indistinguishable from outside,
// so the policies are evaluated directly against the owner's id.
// ---------------------------------------------------------------------------
const { data: rpc } = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/is_project_member`, {
  method: "POST",
  headers: { ...admin, "Content-Type": "application/json" },
  body: JSON.stringify({ p_project_id: ID }),
})).json();
// ---------------------------------------------------------------------------
// 6. The test that was missing from every previous round.
//
// All earlier checks ran `compilePreview` in THIS process, against the source.
// The route that actually serves the user runs the DEPLOYED bundle. Those can
// differ, and three rounds of "it works locally" have already proved they do.
//
// So: give the probe account its own copy of FrameWork - same 61 files, owned by
// the probe user - and fetch it from the live site as a real signed-in user. The
// project's real row is never touched; this is a separate project.
// ---------------------------------------------------------------------------
console.log("");
console.log("=== building a probe-owned copy of FrameWork ===");

const mk = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/projects`, {
  method: "POST",
  headers: { ...admin, "Content-Type": "application/json", Prefer: "return=representation" },
  body: JSON.stringify({
    owner_id: data.user.id,
    name: "ZZ probe copy",
    description: "Temporary diagnostic project. Safe to delete.",
    origin: "import",
    repo_full_name: "probe/framework-copy",
    status: "ready",
  }),
}).then((r) => r.json());
const probeId = Array.isArray(mk) ? mk[0]?.id : mk?.id;
console.log("probe project id:", probeId);

const src = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/project_files?select=path,content,language&project_id=eq.${ID}`,
  { headers: admin },
).then((r) => r.json());
console.log("copying files:", src.length);

await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/project_files`, {
  method: "POST",
  headers: { ...admin, "Content-Type": "application/json" },
  body: JSON.stringify(
    src.map((f) => ({ project_id: probeId, path: f.path, content: f.content, language: f.language ?? "text" })),
  ),
});
console.log("copied.");

// 7. Now the live route, as a genuine owner of a genuine project.
const live = await fetch(`${SITE}/api/projects/${probeId}/preview?v=0&n=probe&h=`, {
  headers: { Cookie: `${cookieName}=${cookieValue}` },
});
const liveHtml = await live.text();
console.log("");
console.log("=== LIVE ROUTE, as a real owner ===");
console.log("status :", live.status);
console.log("bytes  :", liveHtml.length);
console.log("note   :", live.headers.get("x-architect-note"));
console.log("finger :", live.headers.get("x-architect-fingerprint"));
if (liveHtml.length > 2000) {
  const css = liveHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  console.log("style blocks:", (liveHtml.match(/<style>/g) || []).length);
  console.log("css bytes   :", css.length);
  console.log("Times fallback:", css.includes("Times New Roman"));
  console.log("tailwind banner:", css.includes("tailwindcss v4"));
  console.log("--color- vars:", (css.match(/--color-[a-z]+-\d+\s*:/g) || []).length);
  console.log("project vars :", (css.match(/--(text|bg)-[a-z]+\s*:/g) || []).length);
  console.log("imports runtime:", liveHtml.includes("/preview/react-runtime.js"));
  fs.writeFileSync("live-preview.html", liveHtml, "utf8");
  console.log("saved -> live-preview.html");
} else {
  console.log("body   :", liveHtml.replace(/\s+/g, " ").slice(0, 300));
}
console.log("");
console.log("PROBE_PROJECT=" + probeId);

// ---------------------------------------------------------------------------
// 8. Does the fix work? Compiled here, against the same files the live route
//    just failed on.
// ---------------------------------------------------------------------------
const src2 = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/project_files?select=path,content&project_id=eq.${probeId}`,
  { headers: admin },
).then((r) => r.json());
const CODE = /\.(tsx?|jsx?|mjs|cjs|json|css|scss|less|vue|svelte|astro|html)$/i;
const files = src2.filter((f) => CODE.test(f.path)).map((f) => ({ path: f.path, content: f.content }));

const { compilePreview } = await import("./lib/agent/preview.ts");
const local = await compilePreview(files);
const css = local.html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

console.log("");
console.log("=== compiled with the fix ===");
console.log("ok    :", local.ok);
console.log("notes :", local.error || "none");
console.log("css   :", css.length, "bytes");
console.log("Times fallback:", css.includes("Times New Roman"));
console.log("tailwind banner:", css.includes("tailwindcss v4"));
console.log("--color- vars :", (css.match(/--color-[a-z]+-\d+\s*:/g) || []).length);
console.log("project vars  :", (css.match(/--(text|bg)-[a-z]+\s*:/g) || []).length);
console.log("gradients     :", (css.match(/linear-gradient/g) || []).length);
for (const v of ["--font", "--text-primary", "--bg-primary"]) {
  const m = css.match(new RegExp(v.replace(/-/g, "\\-") + ":\\s*([^;]+)"));
  console.log("  " + v.padEnd(15), m ? m[1].trim().slice(0, 46) : "*** UNDEFINED ***");
}

// A globals.css that still carries the bare import must not lose everything.
const withImport = await compilePreview([
  { path: "app/globals.css", content: '@import "tailwindcss";\n@theme{--color-brand:#ff5a5f}\n' },
  { path: "app/page.tsx", content: 'export default function P(){return <div class="bg-brand p-4">x</div>}\n' },
]);
const css2 = withImport.html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
console.log("");
console.log("=== a globals.css that still has the bare @import ===");
console.log("ok:", withImport.ok, "| notes:", withImport.error || "none");
console.log("fallback     :", css2.includes("Times"));
console.log("--color-brand:", (css2.match(/--color-brand:[^;]*/) || ["(none)"])[0]);
console.log(".bg-brand    :", (css2.match(/\.bg-brand\s*\{[^}]*\}/) || ["(none)"])[0]);




const res = await fetch(`${SITE}/api/projects/${ID}/preview?v=0&n=probe&h=`, {
  headers: { Cookie: `${cookieName}=${cookieValue}` },
});
const html = await res.text();

console.log("");
console.log("=== LIVE PREVIEW RESPONSE ===");
console.log("status :", res.status, res.statusText);
console.log("bytes  :", html.length);
console.log("content-type:", res.headers.get("content-type"));
if (html.length < 500) {
  console.log("body   :", html);
} else {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  console.log("style blocks   :", (html.match(/<style>/g) || []).length);
  console.log("css bytes      :", css.length);
  console.log("Times fallback :", css.includes("Times New Roman"));
  console.log("has @layer     :", css.includes("@layer"));
  console.log("--color- vars  :", (css.match(/--color-[a-z]+-\d+\s*:/g) || []).length);
  console.log("project vars   :", (css.match(/--(text|bg)-[a-z]+\s*:/g) || []).length);
  console.log("tailwind banner:", css.includes("tailwindcss v4"));
  console.log("imports runtime:", html.includes("/preview/react-runtime.js"));
  console.log("unpkg refs     :", (html.match(/unpkg/g) || []).length);
  fs.writeFileSync("live-preview.html", html, "utf8");
  console.log("saved -> live-preview.html");
}
