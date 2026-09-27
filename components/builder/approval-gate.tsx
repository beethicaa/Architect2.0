"use client";

/**
 * An approval gate, as a decision rather than a question.
 *
 * Section 4 is explicit: a gated decision must be structured UI, not prose the
 * user has to type a reply to, and a non-technical user must never have to learn
 * anything technical in order to say no. So each option is a button with the
 * consequence spelled out, and "no" is a first-class button rather than
 * something you opt into by typing.
 *
 * The two actions after a choice — "Modify" and "Reject" — are separate on
 * purpose. Approving a proposed option and changing it are different intents, and
 * collapsing them means the only way to influence a decision is to reject it and
 * start again.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { REJECT_OPTION, type ApprovalGate } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

export function ApprovalGateCard({
  gate,
  onAnswer,
  className,
}: {
  gate: ApprovalGate;
  onAnswer: (optionId: string) => void | Promise<void>;
  className?: string;
}) {
  const { isDeveloper } = useViewMode();
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(optionId: string) {
    setChosen(optionId);
    setPending(true);
    try {
      await onAnswer(optionId);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-volt/40 bg-volt/5 p-4",
        className,
      )}
      aria-label="A decision is waiting for you"
    >
      <header className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-volt">
          Needs your decision
        </span>
        <h3 className="text-sm font-medium text-balance">{gate.question}</h3>
        {gate.why ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{gate.why}</p>
        ) : null}
      </header>

      <div className="flex flex-col gap-2" role="group" aria-label="Your options">
        {gate.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={pending}
            onClick={() => void submit(option.id)}
            aria-pressed={chosen === option.id}
            className={cn(
              "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
              "disabled:pointer-events-none disabled:opacity-60",
              chosen === option.id
                ? "border-volt bg-volt/10"
                : "border-border hover:border-volt/50 hover:bg-accent/40",
            )}
          >
            <span className="text-sm font-medium">{option.label}</span>
            {option.detail ? (
              <span className="text-xs leading-relaxed text-muted-foreground">
                {option.detail}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void submit(REJECT_OPTION)}
        >
          None of these
        </Button>
        <span className="text-xs text-muted-foreground">
          {isDeveloper
            ? "The run resumes from this agent with your answer."
            : "The team will try something else instead."}
        </span>
      </div>
    </section>
  );
}
