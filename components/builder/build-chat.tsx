"use client";

/**
 * The build thread.
 *
 * This is a thin view over `useAgent`. Every line in it came from an Anthropic
 * response: the prose is the model's own, the tool list is what it actually
 * called, and the error state is what the API actually returned.
 *
 * There is no simulated progress and no timer anywhere in this file. That was
 * the previous version's central lie, and removing it is the point.
 */

import { AlertTriangle, Check, CircleStop } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { useAgent } from "@/hooks/use-agent";
import { cn } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

type Agent = ReturnType<typeof useAgent>;

export function BuildChat({
  agent,
  onSend,
  agentReady,
  setupHint,
  initialPrompt,
  className,
}: {
  agent: Agent;
  /** The workspace owns sending, so it can attach the chosen model. */
  onSend: (text: string) => void;
  /**
   * Whether the agent is usable, decided on the server.
   *
   * This has to be a prop. `process.env.GROQ_API_KEY` is server-only: Next
   * inlines only NEXT_PUBLIC_* into the browser bundle, so a client component
   * that reads it always sees undefined - and the builder refused to run
   * with a perfectly valid key. That is what shipped once.
   */
  agentReady: boolean;
  setupHint: string;
  initialPrompt: string;
  className?: string;
}) {
  const { isDeveloper } = useViewMode();
  const [draft, setDraft] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [sent, setSent] = React.useState<string[]>([]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [agent.text, agent.tools.length, agent.error, agent.summary]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || agent.running) return;
    setSent((prev) => [...prev, trimmed]);
    setDraft("");
    onSend(trimmed);
  }

  const tokensIn = agent.turns.reduce((sum, t) => sum + t.input, 0);
  const tokensOut = agent.turns.reduce((sum, t) => sum + t.output, 0);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5"
      >
        {!agentReady ? (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <AlertTriangle className="size-3.5 text-warning" aria-hidden />
              The agent cannot run yet
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {setupHint}
            </p>
          </div>
        ) : null}

        {initialPrompt ? (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed">
              {initialPrompt}
            </p>
          </div>
        ) : null}

        {sent.map((text, index) => (
          <div key={`${index}-${text.slice(0, 8)}`} className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed">
              {text}
            </p>
          </div>
        ))}

        {agent.text ? (
          <p
            className={cn(
              "whitespace-pre-wrap text-sm leading-relaxed",
              agent.streaming && "animate-stream-caret",
            )}
          >
            {agent.text}
          </p>
        ) : agent.running ? (
          <p className="text-sm text-muted-foreground">Thinking…</p>
        ) : null}

        {agent.tools.length > 0 ? (
          <ol className="flex flex-col gap-1">
            {agent.tools.map((tool, index) => (
              <li
                key={`${tool.name}-${index}`}
                className="flex items-start gap-2 text-xs"
              >
                {tool.ok ? (
                  <Check className="mt-0.5 size-3 shrink-0 text-success" aria-hidden />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 size-3 shrink-0 text-destructive"
                    aria-hidden
                  />
                )}
                <span className="min-w-0">
                  <span className="font-mono text-muted-foreground">
                    {tool.name}
                  </span>{" "}
                  <span className="text-muted-foreground">{tool.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {agent.summary && !agent.running ? (
          <div className="rounded-lg border border-volt/30 bg-volt/5 p-3">
            <p className="text-xs font-medium text-volt">Done</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
              {agent.summary}
            </p>
            {agent.nextSteps.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {agent.nextSteps.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => send(step)}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    {step}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {agent.error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="size-3.5" aria-hidden />
              The agent stopped
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {agent.error}
            </p>
          </div>
        ) : null}

        {isDeveloper && agent.turns.length > 0 ? (
          <p className="font-mono text-micro text-muted-foreground">
            {agent.model} · {agent.turns.length} turn
            {agent.turns.length === 1 ? "" : "s"} · {tokensIn.toLocaleString()} in /{" "}
            {tokensOut.toLocaleString()} out
            {agent.switched > 0 ? ` · ${agent.switched} model switch` : ""}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
          className="flex flex-col gap-2"
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            disabled={!agentReady}
            placeholder={
              !agentReady
                ? "Set ANTHROPIC_API_KEY to start building"
                : isDeveloper
                  ? "Ask for a change, or describe what to build next..."
                  : "Tell it what to change, in your own words..."
            }
            className="min-h-16 resize-none"
            aria-label="Message the build agent"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {agent.running
                ? "Working…"
                : "Enter to send. Every file it writes is saved."}
            </span>
            {agent.running ? (
              <Button type="button" size="sm" variant="outline" onClick={agent.stop}>
                <CircleStop className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!draft.trim() || !agentReady}
              >
                Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

