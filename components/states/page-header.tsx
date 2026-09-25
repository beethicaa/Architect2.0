import { cn } from "@/lib/utils";

/**
 * The one page header.
 *
 * Every authenticated screen starts with this so the title, the supporting line
 * and the primary action always sit in the same place with the same rhythm.
 * The design system prefers space to borders, so the header has no rule under
 * it — the whitespace does the separating.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  /** Small label above the title: a project name, a status, a count. */
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? (
          <div className="text-xs text-muted-foreground">{eyebrow}</div>
        ) : null}
        <h1 className="font-heading text-2xl font-medium tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </header>
  );
}
