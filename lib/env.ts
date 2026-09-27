/**
 * Environment access for Architect 2.0.
 *
 * Three real backends: Supabase (auth + data), Groq (the agent), and GitHub
 * (optional, for repo sync). The UI must be able to boot *before* any of them
 * exist, so nothing here throws at import time - callers check a `is*Configured`
 * flag, or call a `require*` helper and get a readable setup error instead of
 * "Cannot read properties of undefined".
 *
 * The model provider lives in `lib/agent/provider.ts`; this module only reports
 * whether it is usable, so a client component can decide what to render without
 * importing a vendor SDK.
 *
 * Key naming: Supabase renamed the browser-safe key from "anon" to
 * "publishable". Both are accepted so new and older dashboards work.
 */

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();

const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ""
).trim();

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();

export const supabaseEnv = {
  url: supabaseUrl,
  /** Browser-safe key (publishable / anon). Never a service-role key. */
  key: supabaseKey,
} as const;

/** True when both Supabase values are present. */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseKey.length > 0;

/** Shown in the UI when someone opens a real-auth screen without credentials. */
export const SUPABASE_SETUP_HINT =
  "Supabase is not configured yet. Copy .env.local.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.";

export function requireSupabaseEnv(): { url: string; key: string } {
  if (!isSupabaseConfigured) {
    throw new Error(`[architect] ${SUPABASE_SETUP_HINT}`);
  }
  return { url: supabaseUrl, key: supabaseKey };
}

/* --------------------------------------------------------------- the agent */

/**
 * The Groq key is server-only. It is deliberately NOT prefixed with
 * NEXT_PUBLIC_, because anything NEXT_PUBLIC_ is inlined into the browser
 * bundle - which would publish the key to every visitor.
 */
const groqKey = (process.env.GROQ_API_KEY ?? "").trim();

export const isGroqConfigured = groqKey.length > 0;

export const GROQ_SETUP_HINT =
  "GROQ_API_KEY is not set. Create a key at https://console.groq.com/keys, put it in .env.local, then restart the dev server. Architect will not pretend to build your app without it.";

export function requireGroqEnv(): { apiKey: string } {
  if (!isGroqConfigured) {
    throw new Error(`[architect] ${GROQ_SETUP_HINT}`);
  }
  return { apiKey: groqKey };
}

/* ------------------------------------------------------- admin (destructive) */

/**
 * The service-role key, used for exactly one operation: deleting an account.
 *
 * Server-only and optional. It is never exposed to a client component and is
 * never sent to a browser - the only consumer is the delete-account action,
 * which needs it because removing a row from `auth.users` bypasses row-level
 * security and cannot be done with the publishable key.
 */
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

export const isServiceRoleConfigured = serviceRoleKey.length > 0;

/**
 * The admin key, or `null` when it is not set.
 *
 * Returning `null` rather than throwing lets the caller degrade honestly: the
 * UI can say which key to add instead of showing a crash.
 */
export function getServiceRoleKey(): string | null {
  return serviceRoleKey || null;
}

/* ------------------------------------------------------------------ GitHub */

const githubClientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
const githubClientSecret = (process.env.GITHUB_CLIENT_SECRET ?? "").trim();

export const isGitHubConfigured =
  githubClientId.length > 0 && githubClientSecret.length > 0;

export const GITHUB_SETUP_HINT =
  "GitHub is not configured. Create an OAuth app at https://github.com/settings/developers, then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local.";

/**
 * The exact callback URL this app will ask GitHub for.
 *
 * Kept as one derived value so the UI can show it. GitHub matches the
 * `redirect_uri` character for character, and it is a common, silent failure: a
 * developer browses at `http://192.168.1.4:3000`, the OAuth app was registered
 * with `http://localhost:3000/...`, and GitHub answers with "The redirect_uri
 * is not associated with this application" - a page that gives no hint that the
 * fix is one field in the GitHub settings.
 */
export const githubCallbackUrl = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "")}/api/github/callback`;

/**
 * True when the callback URL will not match the common registration.
 *
 * A LAN or non-local host is the case worth warning about, because the OAuth app
 * is almost always registered with `localhost` and the mismatch only shows up as
 * a GitHub error page. On a real deployment the host is a public domain, which
 * has to be registered too, but a warning there would be noise on every load.
 */
export const githubHostLooksLocal =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(
    (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, ""),
  );

/**
 * What to do about a mismatch, in one sentence, naming the exact URL.
 *
 * Returning a value rather than a boolean is deliberate: the useful thing to show
 * someone is the string their GitHub app needs to contain, not the fact that
 * something is wrong.
 */
export const githubRedirectHint = githubHostLooksLocal
  ? null
  : `GitHub matches the callback URL exactly. Yours must be listed in the OAuth app: ${githubCallbackUrl} — add it under Authorization callback URL, alongside localhost.`;


/* ------------------------------------------------------------------ Vercel */

const vercelToken = (process.env.VERCEL_TOKEN ?? "").trim();
const vercelTeamId = (process.env.VERCEL_TEAM_ID ?? "").trim();

export const isVercelConfigured = vercelToken.length > 0;

export const VERCEL_SETUP_HINT =
  "Vercel is not configured. Create a token at https://vercel.com/account/tokens and set VERCEL_TOKEN (and VERCEL_TEAM_ID for a team) in .env.local.";

export const vercelEnv = { token: vercelToken, teamId: vercelTeamId } as const;

/**
 * Base URL used for OAuth redirects (`/auth/callback`).
 *
 * Server-side this comes from NEXT_PUBLIC_SITE_URL (or Vercel's URL for
 * previews); client-side we prefer the live origin so Google sign-in also works
 * on localhost and preview deployments without extra config.
 */
export function getSiteUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  if (siteUrl) return siteUrl;
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
