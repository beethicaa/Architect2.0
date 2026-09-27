"use client";

import { Check, Code2, Sparkles } from "lucide-react";
import * as React from "react";

import { LENS_COPY, useViewMode } from "@/lib/view-mode";
import type { ViewMode } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

/**
 * The lens, as a real choice with a real consequence.
 *
 * The top-bar toggle is a switch; this is the same two options written out, with
 * what each one actually changes. That matters because the brief treats the lens
 * as a soft default rather than an account type - so the copy has to say plainly
 * that neither option is locked in and both build the same apps.
 *
 * Selecting here writes through the same provider the top bar uses, so it
 * persists to `profiles.view_mode` when there is an account, and to the cookie
 * when there is not. There is deliberately no second code path.
 */
export function LensChoice() {
  const { viewMode, setViewMode } = useViewMode();

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Default view">
      <Option
        mode="simple"
        selected={viewMode === "simple"}
        onSelect={setViewMode}
        icon={<Sparkles aria-hidden className="size-4" />}
        title={LENS_COPY.lensName.simple}
        blurb="Plain language for every step, a visual agent team, and a live preview. Code is always one click away."
      />
      <Option
        mode="developer"
        selected={viewMode === "developer"}
        onSelect={setViewMode}
        icon={<Code2 aria-hidden className="size-4" />}
        title={LENS_COPY.lensName.developer}
        blurb="Adds the orchestration graph, per-agent models, file diffs, commit hashes, environment variables and repo state."
      />
      <p className="text-xs text-muted-foreground">
        This changes how much is explained, not what exists. Both views are backed
        by the same build - switch as often as you like, from here or the top bar.
      </p>
    </div>
  );
}

function Option({
  mode,
  selected,
  onSelect,
  icon,
  title,
  blurb,
}: {
  mode: ViewMode;
  selected: boolean;
  onSelect: (mode: ViewMode) => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      role="radio"
      aria-checked={selected}
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
        selected
          ? "border-volt/60 bg-volt/5"
          : "border-border hover:border-volt/40 hover:bg-accent/40",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", selected ? "text-volt" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {selected ? (
            <Check aria-hidden className="size-3.5 text-volt" />
          ) : null}
        </span>
        <span className="text-sm leading-relaxed text-muted-foreground">{blurb}</span>
      </span>
    </button>
  );
}