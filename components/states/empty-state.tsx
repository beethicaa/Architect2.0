import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one empty state.
 *
 * Rule from docs/design-system.md: an empty state *teaches*. So it takes a
 * concrete example of what goes here, not "You have no projects yet", and the
 * primary action is always present.
 */
export function EmptyState({
  icon: Icon,
  title,
  /** A real example, shown as a hint — this is the teaching part. */
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5 rounded-xl border border-dashed px-6 py-14 text-center",
        className,
      )}
    >
      <span
        className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/40"
        aria-hidden
      >
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="font-heading text-base font-medium text-balance">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground text-balance">
          {hint}
        </p>
      </div>
      {action}
    </div>
  );
}
