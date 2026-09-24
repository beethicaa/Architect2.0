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

  // IMPORTANT: do not add logic between createServerClient() and getClaims() —
  // it can cause the refreshed session to be dropped.
  await supabase.auth.getClaims();

  return response;
}
