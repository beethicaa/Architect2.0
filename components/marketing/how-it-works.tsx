import { Eye, MessageSquare, Rocket, type LucideIcon } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";

/**
 * How it works - the shared flow, shown once for both audiences.
 *
 * Note what is deliberately *absent*: there is no "simple flow" and a
 * "developer flow" side by side. The pitch has just argued they are one product,
 * so showing two flows here would quietly contradict it. Instead the four steps
 * are common, and each step names what each lens shows *within* it - which is
 * the actual product difference.
 */
const STEPS: {
  icon: LucideIcon;
  title: string;
  body: string;
  simple: string;
  developer: string;
}[] = [
  {
    icon: MessageSquare,
    title: "Say what you want, in a sentence",
    body: "No template picker, no field-by-field form. One prompt, the way you would brief a person.",
    simple: "You type it like a message.",
    developer: "You can attach a file path, a model, or a branch.",
  },
  {
    icon: Eye,
    title: "Watch it get built",
    body: "The app appears as the agents make it. You see the screens, not a progress bar with no picture.",
    simple: "Plain status: drawing the booking page.",
    developer: "The running agent, its model, tokens and latency.",
  },
  {
    icon: Rocket,
    title: "Put it online",
    body: "Deploy to a real URL, or push a branch and let your own pipeline handle it.",
    simple: "One button, then share the link.",
    developer: "Environments, build logs, env vars, rollback.",
  },
];

export function HowItWorks() {
  return (
    <PageShell
      width="wide"
      id="how"
      className="gap-0 border-y border-border bg-muted/20 py-16 sm:py-24"
    >
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 className="font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
          The same four steps, whichever door you came in.
        </h2>
        <p className="leading-relaxed text-muted-foreground text-balance">
          A project that started as a sentence and a project imported from a
          repository end up in exactly this workspace. That is the whole point:
          the choice you make at the start changes your first minute, not your
          product.
        </p>
      </div>

      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body, simple, developer }, index) => (
          <li key={title} className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-xs"
                aria-hidden
              >
                {index + 1}
              </span>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </div>

            <h3 className="font-heading text-sm font-medium text-balance">
              {title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>

            {/* The lens difference, in place, rather than two parallel flows. */}
            <dl className="mt-1 flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">Simple:</dt>
                <dd className="text-muted-foreground">{simple}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 text-muted-foreground">
                  Developer:
                </dt>
                <dd className="text-muted-foreground">{developer}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </PageShell>
  );
}
