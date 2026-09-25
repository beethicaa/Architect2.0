/**
 * Re-throw Next.js control-flow errors that must never be caught.
 *
 * `redirect()`, `notFound()` and `permanentRedirect()` do not return - they
 * THROW a tagged error that the framework catches at the boundary. A `try/catch`
 * around a Server Action that wraps one of them will therefore swallow the
 * navigation and treat a successful sign-in as a failure.
 *
 * That is not hypothetical: it shipped as a bug where every Google sign-in
 * reported "we could not reach Supabase" and every password sign-in reported
 * the same, because the redirect to /dashboard was caught and reported as a
 * network error. The user saw a connection problem; the truth was a successful
 * login being thrown away.
 *
 * This lives in its own module because `lib/actions/*` is a `"use server"` file
 * and may only export async functions.
 *
 * @returns true when the error was a framework navigation error (already handled).
 */
export function isNavigationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}

/**
 * Guard for a `catch` block: call this first, before doing anything else.
 *
 * ```ts
 * } catch (error) {
 *   if (isNavigationError(error)) throw error; // let Next handle it
 *   return { error: "something a person can read" };
 * }
 * ```
 */
export function rethrowNavigation(error: unknown): void {
  if (isNavigationError(error)) throw error;
}
