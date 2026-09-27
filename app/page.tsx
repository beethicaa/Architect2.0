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
   * A signed-in visitor never sees the marketing page.
   *
   * Two reasons, and the second is the bug that prompted it. Supabase's browser
   * client handles a `?code=` on whatever page it lands on, so after a Google
   * sign-in the root URL was left reading `/?code=8c119a1c-...` - a one-time
   * credential sitting in the address bar, in the history, and in any screenshot
   * taken of the app. Redirecting to the dashboard removes the parameter and is
   * where someone who just signed in actually wants to be.
   *
   * Read server-side, so the check does not flash the marketing page first.
   */
  if (isSupabaseConfigured) {
    const claims = await getClaims();
    if (claims) redirect("/dashboard");
  }

  // A `?code=` with no session means the exchange failed. Strip it rather than
  // leaving a dead credential in the URL.
  const params = await searchParams;
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

