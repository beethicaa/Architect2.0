/**
 * GitHub token storage — server-side only.
 *
 * This module is the *only* place that reads `github_connections.access_token`,
 * and it requires the service-role key. That is not defensive coding, it is the
 * point:
 *
 *   The table has **no RLS select policy**, deliberately. RLS protects rows, not
 *   columns — a policy that admitted the row would admit the token with it. So
 *   every read goes through the service-role client here, and this module
 *   returns only `login` and `scopes` to its callers. A client component can
 *   therefore never receive a token, because there is no query it could make to
 *   get one.
 *
 * The alternative — a select policy plus "be careful not to select the token" —
 * is one `.select("*")` away from leaking every user's GitHub credentials.
 */

import {
  GITHUB_SETUP_HINT,
  getServiceRoleKey,
  isGitHubConfigured,
} from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";

/** What the UI is allowed to know. Note the absence of a token field. */
export interface GitHubAccount {
  login: string;
  avatarUrl: string | null;
  scopes: string[];
}

/** The token, for server-side API calls only. Never return this to a client. */
export interface GitHubCredentials {
  login: string;
  token: string;
}

async function serviceClient() {
  const key = getServiceRoleKey();
  if (!key) return null;
  // Deliberately constructed here rather than reusing the request-bound client:
  // the service-role client must not carry the user's cookies, or it would act
  // as them and quietly bypass the RLS this design depends on.
  return createClient({ serviceKey: key });
}

export async function requireGitHubAccount(): Promise<GitHubAccount | null> {
  if (!isGitHubConfigured) return null;
  const client = await serviceClient();
  if (!client) return null;

  const claims = await getClaims();
  if (!claims) return null;

  const { data } = await client
    .from("github_connections")
    .select("login, avatar_url, scopes")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!data) return null;
  return {
    login: data.login,
    avatarUrl: data.avatar_url ?? null,
    scopes: (data.scopes ?? []) as string[],
  };
}

export async function requireGitHubCredentials(): Promise<GitHubCredentials | null> {
  if (!isGitHubConfigured) return null;
  const client = await serviceClient();
  if (!client) return null;

  const claims = await getClaims();
  if (!claims) return null;

  const { data } = await client
    .from("github_connections")
    .select("login, access_token")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!data) return null;
  return { login: data.login, token: data.access_token };
}

export async function saveGitHubCredentials(input: {
  login: string;
  avatarUrl: string | null;
  token: string;
  scopes: string[];
}) {
  const client = await serviceClient();
  if (!client) return { error: GITHUB_SETUP_HINT };

  const claims = await getClaims();
  if (!claims) return { error: "Please sign in again." };

  // Upsert on user_id: reconnecting replaces the row rather than accumulating
  // rows, so a user who reconnects never has a stale token behind.
  const { error } = await client.from("github_connections").upsert(
    {
      user_id: claims.sub,
      login: input.login,
      avatar_url: input.avatarUrl,
      access_token: input.token,
      scopes: input.scopes,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("[architect] saveGitHubCredentials failed:", error.message);
    return { error: "We could not save your GitHub connection. Try again." };
  }
  return { error: null };
}

export async function disconnectGitHub() {
  const client = await serviceClient();
  if (!client) return { error: GITHUB_SETUP_HINT };

  const claims = await getClaims();
  if (!claims) return { error: "Please sign in again." };

  const { error } = await client
    .from("github_connections")
    .delete()
    .eq("user_id", claims.sub);

  if (error) return { error: "We could not disconnect you. Try again." };
  return { error: null };
}

/** One request against the GitHub REST API, with a readable failure. */
const MAX_ATTEMPTS = 5;

/**
 * GitHub's secondary rate limit answers 403, the same status a genuine
 * permissions failure uses. The two are told apart by the message, so a real
 * permission problem is not retried five times for nothing.
 */
function isThrottled(status: number, message: string | null): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const text = (message ?? "").toLowerCase();
  return (
    text.includes("secondary rate limit") ||
    text.includes("abuse detection") ||
    text.includes("rate limit")
  );
}

/** Read the body without consuming it, so the normal path can still parse JSON. */
async function peekBody(response: Response): Promise<string | null> {
  try {
    return (await response.clone().text()).slice(0, 300);
  } catch {
    return null;
  }
}

export async function githubFetch<T>(
  credentials: GitHubCredentials,
  path: string,
  init?: RequestInit,
  attempt = 0,
): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${credentials.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Architect-2.0",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    // A 401 is the single most common real failure here: an OAuth token can be
    // revoked from GitHub's side at any time, and it must prompt a reconnect
    // rather than showing an empty repo list.
    if (response.status === 401) {
      return {
        data: null,
        status: 401,
        error: "Your GitHub connection has expired. Disconnect and connect again.",
      };
    }

    // Throttling, retried rather than failed.
    //
    // GitHub applies a *secondary* rate limit to bursts, independent of the
    // documented hourly quota, and importing a repository is inherently a burst:
    // one tree request followed by one request per file. A 56-file repository
    // reliably tripped it, reads started failing, and the import reported success
    // having copied only the nine smallest files — because the loop skipped
    // whatever it could not read and still counted what it had.
    //
    // So throttled responses are retried with a growing pause, and the pause
    // respects `Retry-After` when GitHub sends one. A 403 is treated as
    // throttling only when the body says so, because a genuine permissions
    // failure also returns 403 and retrying that just wastes the user's time.
    if (response.status === 429 || isThrottled(response.status, await peekBody(response))) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 700 * Math.pow(2, attempt);

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 8000)));

        // `attempt + 1` is load-bearing. Without it the counter never moves, so
        // `attempt < MAX_ATTEMPTS` is always true and a throttled request retries
        // forever — or, when the caller supplied the attempt, the backoff never
        // grows. Either way the import stalls rather than recovering.
        return githubFetch<T>(credentials, path, init, attempt + 1);
      }
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      return {
        data: null,
        status: response.status,
        error: body?.message ?? `GitHub returned ${response.status}. Try again.`,
      };
    }

    return { data: (await response.json()) as T, error: null, status: response.status };
  } catch (caught) {
    console.error("[architect] githubFetch failed:", caught);
    return {
      data: null,
      status: 0,
      error: "We could not reach GitHub. Check your connection and try again.",
    };


  }
}

/** Scopes requested at connect time. */
export const GITHUB_SCOPES = ["repo", "read:user"];

/**
 * The app's own origin, for OAuth redirects.
 *
 * Read from env rather than a request header, so the value GitHub was sent and
 * the value the callback verifies against are computed the same way. Trusting a
 * `Host` header here would let a forged request point the OAuth dance at an
 * attacker's domain.
 */
export function githubBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function githubAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: (process.env.GITHUB_CLIENT_ID ?? "").trim(),
    redirect_uri: `${githubBaseUrl()}/api/github/callback`,
    scope: GITHUB_SCOPES.join(" "),
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}