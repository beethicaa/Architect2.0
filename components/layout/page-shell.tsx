import { cn } from "@/lib/utils";

/**
 * The one page container.
 *
 * The consistency pass found the real drift risk: every screen had re-typed its
 * own `max-w-* px-4 sm:px-6 py-*` combination, so the dashboard, the builder and
 * a future settings page could each land on a different gutter. This component
 * makes that impossible — a screen chooses a `width`, never a set of paddings.
 *
 *   narrow  — a single column of reading text (default for forms)
 *   default — the app content column (dashboard, settings)
 *   wide    — the marketing column
 *   full    — the builder, which fills the viewport
 */
const WIDTH = {
  narrow: "max-w-2xl",
  default: "max-w-6xl",
  wide: "max-w-6xl",
  full: "max-w-none",
} as const;

export function PageShell({
  children,
  width = "default",
  id,
  className,
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
  /** Anchor id, so a section can be linked from the marketing nav. */
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "mx-auto flex w-full flex-1 flex-col gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-10",
        WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The one section wrapper: a heading with an optional action on the right, and
 * a consistent gap to its body. Used by the dashboard and the project list so
 * every "group of things" on a screen has the same internal rhythm.
 */
export function PageSection({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  /** Optional right-aligned meta, e.g. "4 projects". */
  count?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-sm font-medium">{title}</h2>
        {count ? <span className="text-xs text-muted-foreground">{count}</span> : null}
        {action}
      </div>
      {children}
    </section>
  );
}
