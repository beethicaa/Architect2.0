import { FlaskConical } from "lucide-react";
import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Honesty affordance: marks a surface whose data is scripted.
 *
 * docs/real-vs-dummy.md requires that mocked flows are *never misleading*. Any
 * screen showing a simulated build, a fake preview or a pretend deploy carries
 * this, so a reviewer (or a real user) is never misled about what works today.
 * Auth and project data — the real slice — never carry it.
 */
export function SimulatedBadge({
  className,
  /** What is simulated, e.g. "This build is scripted." */
  of = "this run",
}: {
  className?: string;
  of?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-5 items-center gap-1.5 rounded-4xl border border-border bg-muted/40 px-2 text-xs font-medium text-muted-foreground",
            className,
          )}
        >
          <FlaskConical className="size-3" aria-hidden />
          Simulated
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {`Agent runs, generated code, previews and deploys in this assignment are scripted. Only auth and projects are real. (${of})`}
      </TooltipContent>
    </Tooltip>
  );
}

/** A quieter, inline variant for dense toolbars. */
export function SimulatedNote({ of }: { of: string }) {
  return (
    <Link
      href="/docs/real-vs-dummy"
      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Simulated data{of ? ` — ${of}` : ""}
    </Link>
  );
}
