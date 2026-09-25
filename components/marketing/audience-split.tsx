import { PageShell } from "@/components/layout/page-shell";
import { LENSES } from "@/lib/marketing/audiences";

export function AudienceSplit() {
  return (
    <PageShell
      width="wide"
      id="audiences"
      className="gap-0 py-16 sm:py-24"
    >
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 className="font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
          One product. Two ways of working.
        </h2>
        <p className="leading-relaxed text-muted-foreground text-balance">
          Architect 2.0 is not a simplified mode and a &ldquo;pro&rdquo; tier.
          It is the same project, the same agents and the same data, read
          differently. Switching between the two is one control, available
          everywhere, and neither side is a dead end.
        </p>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {LENSES.map((lens) => (
          <article
            key={lens.id}
            className="flex flex-col gap-6 rounded-2xl border border-border p-6"
          >
            <header className="flex flex-col gap-2.5">
              <span
                className={
                  lens.id === "developer"
                    ? "inline-flex w-fit items-center gap-1.5 rounded-4xl border border-volt/50 bg-volt-muted px-2.5 py-1 text-xs font-medium text-volt-ink"
                    : "inline-flex w-fit items-center gap-1.5 rounded-4xl border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
                }
              >
                {lens.label}
              </span>
              <h3 className="font-heading text-lg font-medium tracking-tight text-balance">
                {lens.headline}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {lens.body}
              </p>
            </header>

            <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
              <List title="The flow" items={lens.flow} numbered />
              <List title="What you get that the other side does not" items={lens.gets} />
            </div>

            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                What they need from the product:{" "}
              </span>
              {lens.needs}
            </p>

            <div className="flex flex-col gap-2.5 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">
                Also in here
              </p>
              <ul className="flex flex-col gap-2">
                {lens.adjacent.map(({ icon: Icon, who, how }) => (
                  <li key={who} className="flex items-start gap-2.5">
                    <Icon
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">{who}.</span>{" "}
                      {how}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </PageShell>
  );
}

/**
 * One list, two looks: a numbered step list (for the flow) and a bullet list
 * (for the benefits). Numbering is the only structural difference, so the two
 * columns in every lens card stay visually identical.
 */
function List({
  title,
  items,
  numbered = false,
}: {
  title: string;
  items: string[];
  numbered?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-xs font-medium">{title}</p>
      <ol className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li
            key={item}
            className="flex items-start gap-2.5 text-xs text-muted-foreground"
          >
            {numbered ? (
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border font-mono text-micro">
                {index + 1}
              </span>
            ) : (
              <span
                className="mt-1.5 size-1 shrink-0 rounded-full bg-volt"
                aria-hidden
              />
            )}
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
