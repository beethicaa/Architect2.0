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
        The two statements, pushed to opposite ends of the full width, with a
        gutter from each corner.

        This has been capped and centred twice, and both attempts fought the
        brief: `max-w-110rem` stopped the border short of the builder's panels,
        and `max-w-3xl` put the pair either side of the middle of the screen -
        which is not "opposite corners" however it is described. A footer is read
        as two items belonging to the frame, and the frame is as wide as the
        window. The padding is the only thing keeping them off the edges, which is
        exactly the "a bit of gap from the corner" that is wanted.

        On a narrow screen they stack, because two sentences pinned to opposite
        corners of a phone are two sentences that collide.
      */}
      <div className="flex w-full flex-col gap-1 px-4 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
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
