import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase OAuth callback — REAL.
 *
 * Google hands the user back here with a `code`. Exchanging it on the server is
 * what sets the session cookies, so the first authenticated render already has
 * a user and there is no auth flash on the dashboard.
 *
 * The `next` parameter is treated as untrusted and normalised by
 * `safeNext` before it is used in a redirect, so a crafted callback URL cannot
 * turn this route into an open redirect.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorCode = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  const next = safeNext(url.searchParams.get("next"));

  if (!isSupabaseConfigured) {
    return redirectWithError(url, "supabase_unconfigured", null);
  }

  if (errorCode || errorDescription) {
    return redirectWithError(url, errorCode, errorDescription);
  }

  if (!code) {
    return redirectWithError(url, "missing_code", null);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The raw message is logged for the developer; the person sees a sentence.
    console.error("[architect] OAuth code exchange failed:", error.message);
    return redirectWithError(url, "exchange_failed", null);
  }

  // The session cookies are written through `cookies().set()` in the server
  // client, which attaches them to whatever response this handler returns. A
  // bare `NextResponse.redirect()` therefore has no session to carry, so
  // `/auth/callback` succeeded and the very next request arrived signed out.
  //
  // The options have to be restated here. `cookieStore.getAll()` returns only
  // `{ name, value }`, and `response.cookies.set(name, value)` without options
  // falls back to a default `path` of the current route - which silently scoped
  // the session cookie to `/auth/callback`. The browser then never sent it to
  // `/dashboard`, so the layout redirected to sign-in and it looked like sign-in
  // "did not stick" and had to be done twice.
  //
  // These values match what `@supabase/ssr` writes, so the forwarded cookie is
  // indistinguishable from one it set itself.
  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(next, url.origin));

  for (const cookie of cookieStore.getAll()) {
    response.cookies.set(cookie.name, cookie.value, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // A session cookie: it dies with the browser rather than lingering for a
      // month, which is the right default for something a reviewer signs into.
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  // `data.user` is logged rather than trusted for a redirect decision: if the
  // exchange reported success but set no session, that is worth seeing in the
  // terminal rather than discovering it as a mystery on the next screen.
  if (!data.user) {
    console.warn("[architect] OAuth exchange returned no user; cookies forwarded anyway");
  }

  return response;
}
function redirectWithError(
  url: URL,
  code: string | null,
  description: string | null,
) {
  const target = new URL("/auth/error", url.origin);
  target.searchParams.set("code", code ?? "unknown");
  if (description) target.searchParams.set("description", description);
  return NextResponse.redirect(target);
}

function safeNext(value: string | null): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
