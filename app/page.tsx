import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { AgentTeam } from "@/components/marketing/agent-team";
import { AudienceSplit } from "@/components/marketing/audience-split";
import { Closing } from "@/components/marketing/closing";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SiteNav } from "@/components/marketing/site-nav";
import { TimeMachine } from "@/components/marketing/time-machine";
import { isSupabaseConfigured } from "@/lib/env";
import { getClaims } from "@/lib/supabase/server";

/**
 * The landing page.
 *
 * Section order is a deliberate argument, not a list of features:
 *   1. Hero — one sentence that names both doors, so neither audience leaves.
 *   2. Who it's for — the two lenses separated, with the real users named.
 *   3. How it works — the flow, which is where the promise gets concrete.
 *   4. The agent team — the signature feature, argued rather than asserted.
 *   5. Time Machine — the objection answer ("what if it breaks something?").
 *   6. Close — CTA, plus the honesty note about what is real.
 */
export default async function Home({
  searchParams,
}: PageProps<"/">) {
  /*
   * A signed-in visitor lands on the dashboard, not the marketing page.
   *
   * Two reasons, and the second is the bug that prompted it. Supabase's browser
   * client handles a `?code=` on whatever page it lands on, so after a Google
   * sign-in the root URL was left reading `/?code=8c119a1c-...` - a one-time
   * credential sitting in the address bar, in the history, and in any screenshot
   * taken of the app. Redirecting to the dashboard removes the parameter and is
   * where someone who just signed in actually wants to be.
   *
   * Read server-side, so the check does not flash the marketing page first.
   *
   * `?home=1` is the escape hatch, and it is not a workaround - it is the
   * difference between *arriving* at the root URL and *asking* for this page.
   * Everyone who is already inside the product clicks the wordmark to get back to
   * the front door, and being silently shunted to /dashboard meant the logo on
   * every screen did not do what it said it did. The credential problem is
   * unaffected: it only ever occurs on a fresh sign-in, which arrives as a bare
   * `?code=` with no `home` parameter.
   */
  const params = await searchParams;

  if (isSupabaseConfigured) {
    const claims = await getClaims();
    if (claims && params.home !== "1") redirect("/dashboard");
  }

  // A `?code=` with no session means the exchange failed. Strip it rather than
  // leaving a dead credential in the URL.
  if (typeof params.code === "string") {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav />
      <main className="flex flex-1 flex-col">
        <Hero />
        <AudienceSplit />
        <HowItWorks />
        <AgentTeam />
        <TimeMachine />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

