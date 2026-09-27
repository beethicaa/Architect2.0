import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-side Supabase client: Server Components, Server Actions, Route
 * Handlers. Sessions are stored in cookies so the server can render a signed-in
 * state on first paint (no auth flash).
 *
 * `options.serviceKey` builds a **service-role** client instead. That bypasses
 * RLS, so it is deliberately not the default and the only caller is the GitHub
 * token store — the one place that must read a table which has no select policy
 * precisely so that a browser session can never read it.
 *
 * When a service key is used there is no cookie jar, so the client cannot act
 * as the signed-in user even by accident. The caller has already established
 * identity via `getClaims()`.
 */
export async function createClient(options: { serviceKey?: string } = {}) {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  if (options.serviceKey) {
    return createServerClient<Database>(url, options.serviceKey, {
      cookies: { getAll: () => [], setAll: () => undefined },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Harmless: the token refresh
          // is handled by `proxy.ts` (updateSession) on every request.
        }
      },
    },
  });
}

/**
 * Verified identity for the current request, or null when signed out.
 *
 * Uses `getClaims()` (the Supabase-recommended guard): it validates the JWT
 * locally against the project's JWKS and refreshes the session when the access
 * token is about to expire. `claims.sub` is the user id we store on projects.
 */
export async function getClaims() {
  // Wrapped, and deliberately the ONLY place this happens.
  //
  // `getClaims()` performs an outbound request to Supabase's JWKS endpoint. In
  // normal use it returns `{ data, error }`, but a transport-level failure
  // (offline, DNS failure, a firewall, or a wrong project URL) can surface as a
  // throw instead of an error object.
  //
  // That matters more than it looks: this function is called by the auth pages,
  // by the app layout, and by the Server Component re-render that Next performs
  // *after* every Server Action. So a single unhandled throw here turned a
  // sign-up POST into a 500 with an empty stack and no log line - the hardest
  // kind of bug to diagnose, because the failure was in a file the error never
  // mentioned.
  //
  // Centralising the guard here means every call site is protected by
  // construction, rather than relying on each caller remembering to wrap.
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    return data?.claims ?? null;
  } catch (error) {
    // Not fatal: the person simply is not signed in as far as this render is
    // concerned. Routes that require a user will redirect to /sign-in, and the
    // auth form will show its own "cannot reach Supabase" message.
    console.error(
      "[architect] getClaims could not reach Supabase; treating as signed out.",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
