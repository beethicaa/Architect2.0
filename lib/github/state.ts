/**
 * OAuth `state` signing.
 *
 * A route handler may only export HTTP methods and framework config, so the
 * cookie name and the sign/verify pair live here rather than being exported
 * from `connect/route.ts` — Next rejects any other named export from a route
 * with a build error that gives no hint about the cause.
 *
 * The state is signed rather than merely random. It is what proves a callback
 * belongs to a connect *this* user started, and signing means the callback can
 * verify it without any server-side session, so it survives both the redirect
 * and a server restart.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Where the nonce is mirrored, so the two must match. */
export const STATE_COOKIE = "architect-github-state";

const MAX_AGE_SECONDS = 600;

function secret(): string {
  // Falls back to a per-process value if the app secret is absent, which means
  // a restart invalidates in-flight connects. That is the correct failure: the
  // user retries, rather than a stale state being accepted.
  return (
    process.env.APP_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "architect-development-only"
  );
}

/**
 * `nonce.issuedAt.returnTo.signature`, carrying the issue time so it can expire
 * and the page the user started from so they land back on it.
 *
 * The return path is inside the signed payload, which is what makes it safe to
 * trust: it cannot be edited in the browser without invalidating the signature.
 * It is still validated on the way out (same-origin, no `//`), because signing
 * proves where it came from, not that it is a good destination.
 */
export function signState(userId: string, returnTo = "/"): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encoded = Buffer.from(safeReturnTo(returnTo)).toString("base64url");
  const payload = `${userId}.${issuedAt}.${encoded}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * The decoded parts of a state, before verification.
 *
 * Returned unverified on purpose: `verifyState` needs them to recompute the
 * signature, and a caller must check `ok` before using `userId` or `returnTo`.
 */
export function readState(state: string): {
  userId: string;
  issuedAt: number;
  returnTo: string;
} | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [id, issuedAt, encoded] = parts;
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) return null;
  return {
    userId: id,
    issuedAt: issued,
    returnTo: decodeReturnTo(encoded),
  };
}

/**
 * A same-origin path, or "/".
 *
 * Rejects absolute URLs and protocol-relative `//host`, which would turn the
 * callback into an open redirect. The sign-off that this is also inside a signed
 * payload is the belt to this braces.
 */
function safeReturnTo(value: string): string {
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

function decodeReturnTo(encoded: string): string {
  try {
    return safeReturnTo(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return "/";
  }
}

/**
 * Verify a returned state and return where to send the user next.
 *
 * Returns null for anything that does not check out: a tampered signature, an
 * expired state, a malformed value, or one issued for a different user. The
 * comparison is constant-time so the signature cannot be recovered by timing.
 *
 * The return path comes back *with* the verdict, not separately, so a caller
 * cannot accidentally use it before checking `ok`.
 */
export function verifyState(
  state: string,
  userId: string,
): { ok: true; returnTo: string } | { ok: false } {
  const decoded = readState(state);
  if (!decoded) return { ok: false };
  const { userId: id, issuedAt, returnTo } = decoded;

  if (Math.floor(Date.now() / 1000) - issuedAt > MAX_AGE_SECONDS) return { ok: false };

  const expected = createHmac("sha256", secret())
    .update(`${id}.${issuedAt}.${Buffer.from(returnTo).toString("base64url")}`)
    .digest("base64url");

  // The signature is the last dot-separated part; the payload is everything
  // before it. Re-encoding rather than re-splitting means an attacker cannot
  // smuggle a different `returnTo` past the check by crafting the encoding.
  const signature = state.slice(state.lastIndexOf(".") + 1);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };

  // The id must match too, so a state minted for one account cannot be replayed
  // against another even with a valid signature.
  if (!timingSafeEqual(a, b) || id !== userId) return { ok: false };

  return { ok: true, returnTo };
}
