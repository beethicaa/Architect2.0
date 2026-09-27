import { Heart } from "lucide-react";

import { BUILD_ID } from "@/lib/build-id";
import { cn } from "@/lib/utils";

/**
 * The one footer, rendered on every screen.
 *
 * It was inline on the marketing page and nowhere else, so the app, auth and
 * error screens each had their own version or none at all. A footer that shows
 * up on some pages reads as an oversight rather than a decision.
 *
 * Both halves are deliberate. The left says what this is - a hiring assignment -
 * so a reviewer never has to guess whether they are looking at a product or a
 * portfolio piece. The right is who built it, because the assignment is as much
 * about how the person communicates as what they shipped.
 *
 * The heart uses `animate-live-pulse`, which is the motion token that already
 * means "alive" elsewhere in the product, and it is behind `motion-safe` so the
 * beat is dropped for anyone who asked for reduced motion.
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("shrink-0 border-t border-border", className)}>
      {/*
        Contained, with the two halves at opposite ends of that container.

        This is the third attempt at this element and both earlier ones were
        wrong for the same reason: they positioned the text against the *screen*.
        Capped at 110rem the border stopped short of the builder's panels;
        full-bleed with `justify-between` the two statements flew to opposite
        corners of a very wide monitor with nothing between them.

        A max-width with the pair still spread inside it satisfies both things at
        once: the border belongs to the shell and spans it, and the text has a
        readable measure. On a laptop the two sit either side of centre, which is
        what "opposite ends" was meant to look like all along.
      */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <p className="flex items-center gap-2">
          <span>Architect 2.0 — assignment submission for Lyzr.</span>
          {/*
            The build stamp, and it is not decoration.

            A long stretch of "I fixed it and you still see the old thing" came
            down to a dev server that had not been restarted, with no way to tell
            that from a fix that did not work. This makes the running build
            self-identifying: if this id does not change after a restart, the
            server is stale and nothing you are looking at is current.

            It is also genuinely useful on a deployed build - "which version is
            this?" is a question worth being able to answer from the page.
          */}
          <span
            className="rounded border border-border px-1 py-px font-mono text-[10px] text-muted-foreground/70"
            title="Build id - changes on every restart of the dev server"
          >
            build {BUILD_ID}
          </span>
        </p>
        <p className="flex items-center gap-1">
          <span>built with</span>
          {/* `origin-bottom` matters: without it the scale happens about the
              centre and the heart appears to inflate. Anchored at the bottom tip
              it thumps the way a heart does. `fill` gives a solid silhouette, and
              `motion-safe` drops the beat entirely for anyone who asked for
              reduced motion rather than merely slowing it down. */}
          <Heart
            aria-hidden
            className="size-3 origin-bottom fill-destructive text-destructive motion-safe:animate-heartbeat"
          />
          <span className="sr-only">love</span>
          <span>by beethica</span>
        </p>
      </div>
    </footer>
  );
}
