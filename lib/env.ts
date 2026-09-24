/**
 * Environment access for Architect 2.0.
 *
 * Why this module exists
 * ----------------------
 * Only ONE slice of Architect 2.0 talks to a real backend: auth + project
 * persistence (Supabase). Agent runs, code generation, GitHub sync and deploys
 * are mocked flows. Because of that the app must be able to boot *before* any
 * credentials exist — so nothing here throws at import time.
 *
 * Callers either check `isSupabaseConfigured`, or call `requireSupabaseEnv()`
 * and get a readable setup error instead of "Cannot read properties of
 * undefined (reading 'supabase')".
 *
 * Key naming: Supabase renamed the browser-safe key from "anon" to
 * "publishable". We accept either variable name so new and older dashboards
 * both work.
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
