"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import {
  VIEW_MODE_COOKIE,
  useViewMode,
} from "@/lib/view-mode";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types/domain";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The lens toggle — the single control that makes 2.0's thesis visible.
 *
 * It is a segmented control rather than a switch because both states are
 * first-class, and it is always visible (not buried in settings) because the
 * whole product is about the *other* audience being one click away. A
 * non-technical user can peek at the architecture; a developer can drop back to
 * plain language without leaving the project.
 *
 * The current mode is written to a cookie so a Server Component can render the
 * right default on the next request without a flash of the wrong lens.
 */
const MODES: { value: ViewMode; hint: string }[] = [
  { value: "simple", hint: "Plain language — code one click away" },
  { value: "developer", hint: "Agents, models, tokens and files" },
];

export function ViewModeToggle({
  className,
  size = "default",
}: {
  className?: string;
  size?: "sm" | "default";
}) {
  const { viewMode, setViewMode } = useViewMode();
  const router = useRouter();
  const pathname = usePathname();
  const isFirstRender = React.useRef(true);

  // Persist the choice where the server can read it. `replaceState` is used
  // instead of `router.refresh()` because a full re-render would interrupt a
  // running build animation for no benefit.
  React.useEffect(() => {
    document.cookie = `${VIEW_MODE_COOKIE}=${viewMode}; path=/; max-age=31536000; samesite=lax`;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Re-render server-rendered lens-dependent copy (e.g. the build header).
    void router.replace(pathname, { scroll: false });
  }, [viewMode, router, pathname]);

  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5",
        className,
      )}
    >
      {MODES.map((mode) => {
        const active = viewMode === mode.value;
        return (
          <Tooltip key={mode.value}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size={size === "sm" ? "xs" : "sm"}
                variant="ghost"
                aria-pressed={active}
                onClick={() => setViewMode(mode.value)}
                className={cn(
                  "rounded-full px-3 text-xs font-medium",
                  // Volt marks the *current selection* — the one thing on screen
                  // that is "live" in the sense of "this is you right now".
                  active &&
                    "bg-volt text-volt-foreground hover:bg-volt/90 hover:text-volt-foreground",
                )}
              >
                {mode.value === "simple" ? "Simple" : "Developer"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{mode.hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
