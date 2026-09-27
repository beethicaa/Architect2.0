/**
 * The GitHub OAuth callback.
 *
 * Exchanges the code for a token, reads who the user is, and stores the token
 * server-side. The token is never returned to the browser, not even once — the
 * response is a redirect to a page, and the page then asks a server route for
 * what it is allowed to know.
 *
 * The `state` is verified before the code is exchanged. That ordering matters:
 * an unverified state means the callback could belong to someone else's connect
 * attempt, and exchanging first would have already spent the code and stored a
 * token the user did not ask for.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { GITHUB_SETUP_HINT, isGitHubConfigured } from "@/lib/env";
import { STATE_COOKIE, readState, verifyState } from "@/lib/github/state";
import { githubBaseUrl, saveGitHubCredentials } from "@/lib/github/store";
import { getClaims } from "@/lib/supabase/server";

interface TokenResponse {
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface UserResponse {
  login: string;
  avatar_url: string | null;
}

/**
 * Where the callback returns to.
 *
 * `/projects/settings` is the real route. The path is odd - settings about a
 * workspace should not sit under `/projects` - but the shell was declared final
 * and changing it is a separate decision. What is not optional is matching it:
 * this used to redirect to `/settings`, which does not exist, so a *successful*
 * GitHub connection landed the user on a 404 and looked exactly like a failed
 * OAuth flow.
 */
const SETTINGS_PATH = "/projects/settings";

/**
 * The page the user came from, read from the state cookie.
 *
 * Best-effort, and deliberately not `await cookies()`: `backTo` runs on the early
 * failure paths, and those are synchronous functions inside a handler that is
 * otherwise async. Making them await a cookie read would thread a promise
 * through every failure branch for a cosmetic improvement.
 *
 * It reads the cookie before the state has been verified, so it can only *hope*
 * it is the one we wrote. That is acceptable precisely because the path inside is
 * signed and `safeReturnTo` clamps it to a same-origin path - a forged cookie can
 * at worst send someone to another page of this app, never off it.
 */
function returnDestination(stateCookie: string | undefined): string {
  if (!stateCookie) return SETTINGS_PATH;
  return readState(stateCookie)?.returnTo || SETTINGS_PATH;
}

/**
 * Where the callback returns to.
 *
 * Prefers the path carried in the signed state cookie, so a connect started on
 * the dashboard comes back to the dashboard - including when it *failed*, which
 * is when bouncing someone to a settings page is most disorienting.
 *
 * The cookie is signed, and `safeReturnTo` inside the state module rejects
 * anything that is not a same-origin path, so a hand-edited cookie cannot turn
 * this into an open redirect. A missing or unreadable cookie falls back to the
 * settings page, where a connected account is visible.
 */
function backTo(reason: string, stateCookie?: string) {
  const url = new URL(returnDestination(stateCookie), githubBaseUrl());
  url.searchParams.set("github", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Read once, up front, so every exit below can route back to the page the user
  // started on - including the ones that return before the state is verified.
  const stateCookie = (await cookies()).get(STATE_COOKIE)?.value;

  // The user pressing "Cancel" on GitHub's consent screen is a normal outcome,
  // not a failure, so it gets its own plain message rather than an error code.
  if (oauthError) {
    return backTo("cancelled", stateCookie);
  }

  if (!isGitHubConfigured) {
    return NextResponse.json({ error: GITHUB_SETUP_HINT }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.redirect(new URL("/sign-in", githubBaseUrl()));
  }

  if (!code || !state) {
    return backTo("invalid");
  }

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;

  // Both the signature and the cookie must agree. Either alone is insufficient:
  // the cookie alone could be replayed from another tab, the signature alone
  // could be forged if the secret leaked.
  const verdict = expected === state ? verifyState(state, claims.sub) : { ok: false as const };
  if (!verdict.ok) {
    return backTo("state", stateCookie);
  }

  cookieStore.delete(STATE_COOKIE);

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: (process.env.GITHUB_CLIENT_ID ?? "").trim(),
      client_secret: (process.env.GITHUB_CLIENT_SECRET ?? "").trim(),
      code,
      redirect_uri: `${githubBaseUrl()}/api/github/callback`,
    }),
    cache: "no-store",
  });

  const token = (await tokenResponse.json().catch(() => null)) as TokenResponse | null;
  if (!tokenResponse.ok || !token?.access_token) {
    console.error("[architect] github oauth exchange failed:", token?.error);
    return backTo("exchange", stateCookie);
  }

  // The user endpoint is what tells us whose account this is. Without it the
  // token is stored with no identity, and every later call has to guess.
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Architect-2.0",
    },
    cache: "no-store",
  });

  if (!userResponse.ok) {
    return backTo("profile", stateCookie);
  }

  const user = (await userResponse.json()) as UserResponse;

  const saved = await saveGitHubCredentials({
    login: user.login,
    avatarUrl: user.avatar_url,
    token: token.access_token,
    scopes: (token.scope ?? "").split(",").filter(Boolean),
  });

  if (saved.error) {
    return backTo("save", stateCookie);
  }

  return backTo("connected", stateCookie);
}
