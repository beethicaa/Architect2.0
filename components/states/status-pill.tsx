"use client";

import { cn } from "@/lib/utils";
import { useStateLabel } from "@/lib/view-mode";
import type { RunState } from "@/lib/types/domain";

/**
 * The one status pill.
 *
 * Every agent, build and deploy surface in the product renders state through
 * this component, which is what makes the five-state vocabulary stick. The dot
 * colour is lens-independent (status must not change meaning when you flip a
 * lens); only the *word* changes, via `useStateLabel`.
 */

const DOT_CLASS: Record<RunState, string> = {
  queued: "bg-info",
  working: "bg-volt animate-live-pulse",
  done: "bg-success",
  "needs-you": "bg-warning",
  failed: "bg-destructive",
};

const TONE_CLASS: Record<RunState, string> = {
  queued: "text-muted-foreground",
  working: "text-volt-ink",
  done: "text-foreground",
  "needs-you": "text-foreground",
  failed: "text-destructive",
};

export function StatusPill({
  state,
  /** Overrides the lens-derived label (e.g. "live" instead of "done"). */
  label,
  className,
  showDot = true,
}: {
  state: RunState;
  label?: string;
  className?: string;
  showDot?: boolean;
}) {
  const stateLabel = useStateLabel();

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-4xl border border-border bg-background/70 px-2 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[state],
        className,
      )}
    >
      {showDot ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[state])}
          aria-hidden
        />
      ) : null}
      {label ?? stateLabel(state)}
    </span>
  );
}

export { DOT_CLASS as statusDotClass };
