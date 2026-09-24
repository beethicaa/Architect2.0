import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-side Supabase client: Server Components, Server Actions, Route
 * Handlers. Sessions are stored in cookies so the server can render a signed-in
 * state on first paint (no auth flash).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

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
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) return null;
  return data?.claims ?? null;
}
