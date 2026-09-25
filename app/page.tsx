import { AgentTeam } from "@/components/marketing/agent-team";
import { AudienceSplit } from "@/components/marketing/audience-split";
import { Closing } from "@/components/marketing/closing";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SiteNav } from "@/components/marketing/site-nav";
import { TimeMachine } from "@/components/marketing/time-machine";

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
export default function Home() {
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

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Architect 2.0 — a hiring assignment.</p>
        <p>
          Auth and projects are real (Supabase). Agent runs, code generation,
          previews and deploys are simulated, and every screen says so.
        </p>
      </div>
    </footer>
  );
}

