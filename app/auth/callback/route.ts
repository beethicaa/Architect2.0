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
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The raw message is logged for the developer; the person sees a sentence.
    console.error("[architect] OAuth code exchange failed:", error.message);
    return redirectWithError(url, "exchange_failed", null);
  }

  return NextResponse.redirect(new URL(next, url.origin));
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
