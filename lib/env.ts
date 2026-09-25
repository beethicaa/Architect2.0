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

/* ------------------------------------------------------------------ GitHub */

const githubClientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
const githubClientSecret = (process.env.GITHUB_CLIENT_SECRET ?? "").trim();

export const isGitHubConfigured =
  githubClientId.length > 0 && githubClientSecret.length > 0;

export const GITHUB_SETUP_HINT =
  "GitHub is not configured. Create an OAuth app at https://github.com/settings/developers, then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local.";

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
