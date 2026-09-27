/**
 * Start the GitHub OAuth handshake.
 *
 * The `state` parameter is a CSRF defence, and it is not decorative: GitHub
 * echoes it back on the callback, which is the only thing proving this callback
 * belongs to a connect *this* user started. Without it, an attacker could feed
 * a victim a callback URL carrying the attacker's token and connect the
 * victim's account to a repository the attacker controls.
 *
 * The state is a signed nonce, not a random string in a cookie — signing means
 * the callback can verify it without any server-side session, so it survives the
 * redirect and a server restart.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { GITHUB_SETUP_HINT, isGitHubConfigured } from "@/lib/env";
import { githubAuthorizeUrl } from "@/lib/github/store";
import { STATE_COOKIE, signState } from "@/lib/github/state";
import { getClaims } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!isGitHubConfigured) {
    return NextResponse.json({ error: GITHUB_SETUP_HINT }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  /*
   * Remember where the user started, so the callback can put them back there.
   *
   * The connect button lives on the dashboard, and a callback that always
   * returned to the settings page threw you across the app after a job you
   * started somewhere else. The Referer is the browser's own answer to "which
   * page sent me here", and it is not trusted: it goes into the *signed* state,
   * so it cannot be edited in flight, and `safeReturnTo` rejects anything that
   * is not a same-origin path.
   *
   * A direct visit to /api/github/connect has no referer, and falls back to the
   * dashboard, which is where the feature is.
   */
  const referer = request.headers.get("referer");
  let returnTo = "/dashboard";
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.origin === new URL(request.url).origin) {
        returnTo = from.pathname + from.search;
      }
    } catch {
      // A malformed Referer is not worth failing the connect over.
    }
  }

  const state = signState(claims.sub, returnTo);
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    // Ten minutes is long enough to click through GitHub's consent screen and
    // short enough that a stale tab cannot be used later.
    maxAge: 600,
    // Explicit, for the same reason the auth callback restates them: without it
    // the cookie is scoped to /api/github and comes back on no request.
    path: "/",
  });

  return NextResponse.redirect(githubAuthorizeUrl(state));
}
