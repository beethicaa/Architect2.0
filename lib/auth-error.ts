/**
 * Supabase auth errors — something a person can act on.
 *
 * The raw messages are developer-facing (`AuthApiError`, `Email not confirmed`,
 * `User already registered`). This module is the single place that decides what
 * a user is told, so the wording stays consistent across sign-in, sign-up and the
 * OAuth callback error page.
 */

/**
 * Shown when the auth call itself could not complete - Supabase unreachable, a
 * firewall, or a project URL that does not resolve.
 *
 * This lives here rather than in `lib/actions/auth.ts` because a `"use server"`
 * file may only export async functions; exporting a string constant from one is
 * a build error. It is also the right home: this module already owns the
 * question of "what do we tell a person when auth fails, and why".
 *
 * It is deliberately distinct from a wrong-password message, because the fix is
 * completely different. Nobody should be told their password is incorrect when
 * the request never left the building.
 */
export const AUTH_UNREACHABLE =
  "We could not reach Supabase. Check your internet connection and that NEXT_PUBLIC_SUPABASE_URL is correct, then try again.";

/**
 * Shown when Supabase credentials are missing entirely. Deliberately a copy of
 * `lib/env.ts`'s hint so the wording is identical wherever it surfaces.
 */
export const SUPABASE_HINT =
  "Supabase is not configured yet. Copy .env.local.example to .env.local, set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.";

const MESSAGES: { match: RegExp; say: string }[] = [
  {
    match: /invalid login credentials/i,
    say: "That email and password do not match an account.",
  },
  {
    match: /email not confirmed/i,
    say: "Confirm your email address first — check your inbox for the link.",
  },
  {
    match: /user already registered|already been registered/i,
    say: "There is already an account with that email. Sign in instead.",
  },
  {
    match: /password should be at least|weak password/i,
    say: "Use a longer password — at least 8 characters.",
  },
  {
    match: /rate limit|too many requests|security purposes/i,
    say: "Too many attempts. Wait a minute and try again.",
  },
  {
    match: /email address .* invalid|unable to validate email/i,
    say: "That does not look like a valid email address.",
  },
  {
    match: /provider is not enabled|provider not enabled/i,
    say: "Google sign-in is not switched on for this project yet.",
  },
];

/**
 * The OAuth callback's `error_description` / `error` query params.
 *
 * `code` is a value *we* chose when redirecting (e.g. `provider_unreachable`),
 * or Supabase/Google's own code. The distinction matters: our codes deserve a
 * specific, actionable sentence, theirs are best matched by pattern.
 */
export function authCallbackErrorMessage(
  code: string | null,
  description: string | null,
): string {
  if (!code && !description) {
    return "Something interrupted sign-in. Please try again.";
  }

  if (code === "access_denied") {
    return "You cancelled Google sign-in before it finished.";
  }
  if (code === "server_error") {
    return "Google sign-in failed on their side. Try again in a moment.";
  }
  if (code === "provider_unreachable") {
    return "We could not reach Supabase to start Google sign-in. Check your connection and that NEXT_PUBLIC_SUPABASE_URL is correct.";
  }
  if (code === "supabase_unconfigured") {
    return SUPABASE_HINT;
  }
  if (!code) return authErrorMessage(description ?? "");
  return `Sign-in could not be completed (${code.replace(/_/g, " ")}).`;
}

export function authErrorMessage(raw: string): string {
  if (!raw) return "Something went wrong. Please try again.";
  for (const { match, say } of MESSAGES) {
    if (match.test(raw)) return say;
  }
  // Unrecognised errors are logged by the caller; the user gets a safe message
  // rather than a raw library string.
  return "We could not complete that. Please try again.";
}
