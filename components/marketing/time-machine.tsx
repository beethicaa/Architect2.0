import { History, Undo2 } from "lucide-react";

import { PageShell } from "@/components/layout/page-shell";
import { versionsFor } from "@/lib/mock/versions";

/**
 * Time Machine - the original addition beyond the brief.
 *
 * It is pitched here, before the closing CTA, because it is the answer to the
 * objection every builder has: "what if it breaks something I already liked?"
 * Leading with the undo story is also how the pitch reaches developers, who
 * have heard "AI rewrote my file" before.
 */
export function TimeMachine() {
  return (
    <PageShell width="wide" id="history" className="gap-0 py-16 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-4xl border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <History className="size-3" aria-hidden />
            Beyond the brief
          </span>
          <h2 className="font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
            Every build is a checkpoint you can go back to.
          </h2>
          <p className="leading-relaxed text-muted-foreground text-balance">
            The number one reason people stop trusting an agentic builder is not
            that it is bad. It is that they cannot tell what it just did, and
            asking it to undo that is a coin flip. So every change is saved, with
            a receipt in plain language and, for developers, the agent run and
            diff that produced it.
          </p>

          <ul className="flex flex-col gap-2.5">
            <Reading
              lens="Simple"
              text="Go back to how it looked before the calendar."
            />
            <Reading
              lens="Developer"
              text="Revert to 3d5aa890, the commit before the UI agent ran."
            />
          </ul>
        </div>

        {/* A journalling project, so the receipts read as entries and reminders
            rather than reusing a booking demo on the marketing page. */}
        <ol className="flex flex-col gap-2">
          {versionsFor("a daily journalling app").map((version, index) => (
            <li
              key={version.id}
              className="flex flex-col gap-1.5 rounded-xl border border-border p-4"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-sm font-medium">{version.label}</p>
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  <Undo2 className="size-3" aria-hidden />
                  restore
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {version.receipt}
              </p>
              <p className="font-mono text-micro text-muted-foreground">
                {version.summary}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </PageShell>
  );
}

function Reading({ lens, text }: { lens: string; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 shrink-0 rounded-4xl border border-border px-2 py-0.5 text-xs text-muted-foreground">
        {lens}
      </span>
      <span className="text-muted-foreground">{text}</span>
    </li>
  );
}
