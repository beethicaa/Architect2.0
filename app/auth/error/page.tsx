import { authCallbackErrorMessage } from "@/lib/auth-error";
import { isSupabaseConfigured, SUPABASE_SETUP_HINT } from "@/lib/env";
import { ErrorState } from "@/components/states/error-state";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import Link from "next/link";

export const metadata = { title: "Sign-in problem" };

/**
 * Where a failed OAuth handshake lands. A dedicated page (rather than a
 * redirect with a query string) so the person gets one sentence and one way
 * out, instead of a sign-in form with a mystery message on it.
 */
export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth/error">) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : null;
  const description = typeof params.description === "string" ? params.description : null;

  // A specific failure always wins over the generic setup hint: if the person
  // cancelled at Google's consent screen, telling them to configure Supabase
  // would be actively misleading. The setup hint is only shown when there is no
  // error code to explain (i.e. they arrived here from the app, not Google).
  //
  // `no_code` is treated as "nothing is known" rather than as a failure. Someone
  // who follows an old bookmark, or lands here after a successful sign-in that
  // already finished, should be offered the sign-in page - not told their
  // provider refused them for a reason we cannot see.
  const hasErrorCode = Boolean(
    (code && code !== "no_code" && code !== "unknown") || description,
  );
  const message =
    hasErrorCode || isSupabaseConfigured
      ? authCallbackErrorMessage(code, description)
      : SUPABASE_SETUP_HINT;

  return (
    <main className="flex min-h-dvh flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-volt" aria-hidden />
          Architect 2.0
        </Link>
        <ThemeToggle />
      </header>

      <div className="flex flex-1 items-center justify-center py-16">
        <ErrorState
          title="Sign-in did not finish"
          message={message}
          actionHref="/sign-in"
          actionLabel="Back to sign in"
          className="w-full max-w-md"
        />
      </div>

      {/* The same footer as every other screen. This page is reached by a failed
          redirect, so it is the one place a user is most likely to land having
          never seen the product - and the footer is what tells them whose it is. */}
      <SiteFooter />
    </main>
  );
}
