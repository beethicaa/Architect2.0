import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The hero.
 *
 * The headline deliberately names *both* doors in one sentence instead of
 * splitting into two value props. Architect 2.0's argument is that it is one
 * product, and a hero that says "for beginners" would immediately hand the
 * developer visitor a reason to leave. The two audiences are separated one
 * screen later, by the "who it's for" section — where someone can actually
 * read.
 *
 * The subhead does the real work: it names the differentiator (you can see what
 * the agents are doing, and undo them) rather than the category ("build apps
 * with AI"), because "AI app builder" is not a differentiator in 2026.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* One soft volt wash behind the fold. It is the only decorative use of
          the accent in the whole marketing page, which is what stops the accent
          from becoming wallpaper. */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-volt-muted opacity-50 blur-3xl"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-7 px-4 py-20 text-center sm:px-6 sm:py-28">
        <span className="inline-flex items-center gap-1.5 rounded-4xl border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3 text-volt-ink" aria-hidden />
          Now serving both builders and developers
        </span>

        <h1 className="font-heading text-4xl font-medium tracking-tight text-balance sm:text-5xl sm:leading-[1.05]">
          Describe it in a sentence,
          <br className="hidden sm:block" /> or bring your repository.
        </h1>

        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg">
          A team of agents builds the app, shows you exactly what each one did,
          and saves every step so you can change your mind. Non-technical builders
          never touch code. Developers never lose it.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Button asChild size="lg">
            <Link href="/sign-up">
              Start building
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/sign-in">See an existing project</Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Free to try — No card — Bring your own model keys later
        </p>
      </div>
    </section>
  );
}
