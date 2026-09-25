import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";

/**
 * The close, and the honesty note.
 *
 * The final paragraph states plainly what is real and what is simulated. On a
 * hiring assignment that is worth more than another marketing claim: a reviewer
 * who finds a simulated flow they thought was real has to discount everything
 * else, so the product says it out loud before they find it themselves.
 */
export function Closing() {
  return (
    <PageShell width="wide" className="pb-28">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-muted/20 px-6 py-14 text-center sm:px-12">
        <h2 className="max-w-2xl font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
          Describe the app. Or point us at the repository. Either way, you can see
          everything we do.
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground text-balance">
          This is a hiring assignment. Accounts and projects are real, backed by
          Supabase. Agent runs, generated code, previews and deploys are
          simulated on purpose — and every screen that simulates something says so.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button asChild size="lg">
            <Link href="/sign-up">
              Create an account
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-in">I already have one</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
