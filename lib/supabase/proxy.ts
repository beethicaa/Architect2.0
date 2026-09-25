import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured, requireSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Keeps the Supabase session alive on every request.
 *
 * Next.js Server Components cannot write cookies, so a request-scoped "proxy"
 * (Next.js 16 renamed middleware -> proxy) re-issues the rotated auth cookies.
 * Without this, a signed-in user would silently become signed-out after the
 * access token expires.
 *
 * Route protection lives in the route groups themselves (layouts call
 * `getClaims()` and redirect) rather than here — that keeps the proxy cheap and
 * avoids an auth redirect on every static asset request.
 */
export async function updateSession(request: NextRequest) {
  // Architect 2.0 boots without credentials (most flows are mocked), so a
  // missing key must not take the whole app down.
  if (!isSupabaseConfigured) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[architect] Supabase env vars missing — auth session refresh is disabled.",
      );
    }
    return NextResponse.next({ request });
  }

  const { url, key } = requireSupabaseEnv();

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: do not add logic between createServerClient() and getClaims() -
  // it can cause the refreshed session to be dropped.
  //
  // This block is wrapped because it is the one place where an *outbound network
  // call* happens on every request. If Supabase is unreachable (offline, DNS, a
  // firewall, or a typo in the project URL) the failure must not propagate: an
  // unhandled throw here turns every page AND every Server Action into a 500,
  // including sign-in and sign-up - the exact flows a person needs in order to
  // fix their own connection.
  //
  // A stale-but-valid session is a far better outcome than a 500. If the refresh
  // fails we serve the request unauthenticated; the Server Components that need
  // a user redirect to /sign-in, and the auth action reports a readable message.
  try {
    await supabase.auth.getClaims();
  } catch (error) {
    console.error(
      "[architect] Session refresh could not reach Supabase; serving unauthenticated.",
      error instanceof Error ? error.message : error,
    );
  }

  return response;
}
