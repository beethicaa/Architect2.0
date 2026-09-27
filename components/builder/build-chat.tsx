"use client";

/**
 * The build thread.
 *
 * Every line here came from a real model response. The prose is the agent's own,
 * the file list is what it actually wrote, and the error is what the API actually
 * returned. There is no simulated progress and no timer in this file.
 *
 * Three things make it a *thread* rather than a log:
 *
 *  1. **Each agent is a distinct block** with its own icon and status, not one
 *     undifferentiated stream. "Planner is reading your request" and "Interface
 *     Agent is building the screen" are different events and look different.
 *  2. **Every message carries a per-message technical switch.** The brief is
 *     explicit that this is per-message, not a global setting: a non-technical
 *     user reads "Setting up your app's storage", and a developer can flip that
 *     one message to "Provisioning the Postgres schema" without leaving the
 *     thread.
 *  3. **A gate is a card with buttons**, not prose asking for a reply. Saying no
 *     must not require knowing anything technical.
 */

import { CircleStop, Loader2, Send } from "lucide-react";
import * as React from "react";

import { AgentBadge } from "@/components/builder/agent-badge";
import { ApprovalGateCard } from "@/components/builder/approval-gate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_BY_KEY, type AgentKey } from "@/lib/pipeline/agents";
import type { ApprovalGate } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

export interface ThreadMessage {
  id: string;
  role: "you" | "agent" | "system" | "gate";
  agent_key: string | null;
  body: string;
  technical: string | null;
  meta: Record<string, unknown> | null;
  run_id: string | null;
  gate_status: string | null;
  is_redirect: boolean;
  created_at: string;
}

export function BuildChat({
  projectId,
  running,
  gate,
  onAnswer,
  onRestoreGate,
  onSend,
  onStop,
  onInspect,
  error,
  waiting,
  agentReady,
  setupHint,
  className,
}: {
  projectId: string;
  running: boolean;
  gate: ApprovalGate | null;
  onAnswer: (optionId: string) => Promise<void>;
  /** Re-open a gate raised by an earlier run, so a parked build is answerable. */
  onRestoreGate: (gate: ApprovalGate, runId: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Open an agent's artifact in the inspector. */
  onInspect?: (agentKey: AgentKey) => void;
  error: string | null;
  waiting: string | null;
  agentReady: boolean;
  setupHint: string;
  className?: string;
}) {
  const { isDeveloper } = useViewMode();
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/messages`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { messages: ThreadMessage[] };
    setMessages(data.messages);

    /*
     * Re-open a gate raised by an earlier run.
     *
     * `state.gate` is only populated by the live `gate` event, so a run that
     * parked waiting for a decision looked identical to a stalled one after a
     * reload. The thread showed "Needs your decision" and the pending gate
     * message rendered `null` on the assumption the live card was displaying -
     * so there were no buttons, and the build never moved again.
     *
     * The gate is persisted in the message's `meta`, so it is restored rather
     * than lost. Gated on Developer lens because that is the only lens that
     * raises one.
     */
    const pending = [...data.messages]
      .reverse()
      .find(
        (message) =>
          message.role === "gate" &&
          message.gate_status === "pending" &&
          message.meta &&
          typeof message.meta.gate === "object" &&
          message.meta.gate !== null,
      );
    if (pending?.meta && typeof pending.run_id === "string") {
      onRestoreGate(pending.meta.gate as ApprovalGate, pending.run_id);
    }
  }, [projectId, onRestoreGate]);

  // The persisted thread is the source of truth. The run appends to the same
  // table, so re-reading after a run picks up everything the agents said without
  // the browser ever holding a competing copy that could drift.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Re-read when a run ends, so the finished thread is complete.
  const wasRunning = React.useRef(running);
  React.useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);

  // Keep the thread pinned to the newest message.
  //
  // The previous version scrolled on `messages.length`, which only changes when
  // the thread is re-read from the database. During a run the agents are
  // streaming text, so the panel grew continuously and the newest line sat
  // below the fold - the user had to drag to the bottom on every message to see
  // what the team was doing, which is precisely when they most want to watch it.
  //
  // So this tracks growth rather than message count, and keeps following while
  // pinned. Unpinning on a manual scroll up means a deliberate scroll back
  // through history is not yanked away by the next token.
  const [pinned, setPinned] = React.useState(true);

  const stickToBottom = React.useCallback(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  const onScroll = React.useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    // Within a few pixels of the bottom counts as "following along".
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setPinned(atBottom);
  }, []);

  // A ResizeObserver rather than a scroll event: streaming text changes the
  // height of the content, not the scroll position, so a scroll listener alone
  // would never notice that the newest line had moved out of view.
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (pinned) stickToBottom();
    });
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [pinned, stickToBottom]);

  // New messages, a run starting or a gate opening are all moments where the
  // bottom is the right place to be.
  React.useEffect(() => {
    stickToBottom();
  }, [messages.length, running, gate, stickToBottom]);

  function send() {
    const trimmed = draft.trim();
    if (!trimmed || running) return;
    setDraft("");
    setStarted(true);
    onSend(trimmed);
  }


  const isEmpty = loaded && messages.length === 0 && !running;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {isEmpty && !started ? (
          <OpeningPrompt
            agentReady={agentReady}
            setupHint={setupHint}
            onPick={(text) => {
              setStarted(true);
              onSend(text);
            }}
          />
        ) : null}

        <ol className="flex flex-col gap-3">
          {messages.map((message) => (
            <ThreadRow
              key={message.id}
              message={message}
              isDeveloper={isDeveloper}
              onInspect={onInspect}
            />
          ))}
        </ol>

        {running ? <WorkingLine waiting={waiting} /> : null}

        {gate ? (
          <ApprovalGateCard gate={gate} onAnswer={onAnswer} className="mt-3" />
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <label htmlFor="build-prompt" className="sr-only">
          {started ? "Change your app" : "Describe what you want to build"}
        </label>
        <Textarea
          id="build-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. Sending must not require
            // hunting for a button, and a multi-line request must not need a
            // modifier to be typed.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            agentReady
              ? started
                ? "Change something — “make the buttons blue”, “add a search box”…"
                : "Describe what you want to build…"
              : "Add your Groq key to build"
          }
          rows={2}
          disabled={!agentReady}
          className="resize-none"
        />
        <div className="mt-2 flex items-center gap-2">
          {running ? (
            <Button variant="outline" size="sm" onClick={onStop}>
              <CircleStop aria-hidden />
              Stop
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={send}
            disabled={!agentReady || running || draft.trim().length === 0}
            className="ml-auto"
          >
            {started ? "Change it" : "Build it"}
            <Send aria-hidden data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The first-run panel. Real example prompts that actually start a build. */
function OpeningPrompt({
  agentReady,
  setupHint,
  onPick,
}: {
  agentReady: boolean;
  setupHint: string;
  onPick: (text: string) => void;
}) {
  if (!agentReady) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm leading-relaxed text-muted-foreground">
        {setupHint}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-4">
      <p className="text-sm text-muted-foreground">
        Describe the app in a sentence or two. Seven specialists take it from there.
      </p>
      <div className="flex flex-col gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-md border border-border p-3 text-left text-sm transition-colors hover:border-volt/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One message.
 *
 * The user's own messages are plain bubbles. An agent's message is a block with
 * its icon, its name and a one-line outcome, and it carries the per-message
 * technical switch.
 *
 * That switch is the point. A developer looking at "Setting up your app's
 * storage" needs the actual event name, and a non-technical user must never be
 * shown it unasked. Rather than a global setting, each message remembers its own
 * choice, so flipping one does not flip the rest of the thread.
 */
function ThreadRow({
  message,
  isDeveloper,
  onInspect,
}: {
  message: ThreadMessage;
  isDeveloper: boolean;
  onInspect?: (agentKey: AgentKey) => void;
}) {
  const [showTechnical, setShowTechnical] = React.useState(false);

  if (message.role === "you") {
    return (
      <li className="flex flex-col items-end gap-1">
        <p className="max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm">
          {message.body}
        </p>
        {message.is_redirect ? (
          <span className="text-micro text-muted-foreground">
            changing the current build
          </span>
        ) : null}
      </li>
    );
  }

  if (message.role === "system") {
    return (
      <li className="text-center text-xs text-muted-foreground">{message.body}</li>
    );
  }

  if (message.role === "gate") {
    // The live gate is rendered by ApprovalGateCard above the thread; a past one
    // is shown here as its resolved outcome so the history reads correctly.
    if (message.gate_status === "pending") return null;
    return (
      <li className="text-center text-xs text-muted-foreground">
        Decision: {message.gate_status === "approved" ? "approved" : "declined"}
      </li>
    );
  }

  // A failure that already happened, not one happening now.
  //
  // These are persisted in `project_messages` and re-rendered every time the
  // thread loads, which made an 18-minute-old "Groq's quota is used up" look
  // exactly like the current state of the build. The user changed the key, the
  // account was fine, four runs then succeeded - and the old message was still
  // sitting there saying the quota was spent.
  //
  // A past failure is history, so it is rendered as history: muted, timestamped
  // in its own words, and visually distinct from anything live. The live error
  // surface is the banner at the foot of the thread, which is the only place
  // that should ever be red.
  if (message.meta?.error === true) {
    return (
      <li className="flex items-start gap-2.5 opacity-60">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-micro text-muted-foreground">
            Earlier attempt stopped &mdash; this is a record, not the current state
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {message.body.replace(/^Stopped:\s*/, "")}
          </p>
        </div>
      </li>
    );
  }

  const agentKey = message.agent_key as AgentKey | null;
  const spec = agentKey ? AGENT_BY_KEY[agentKey] : null;
  const files = Array.isArray(message.meta?.files) ? (message.meta.files as string[]) : [];
  const useTechnical = isDeveloper || showTechnical;

  // Every agent's turn is a button, because the brief is explicit that a message
  // must open the panel holding that agent's work: "Each agent message is
  // clickable and opens the relevant panel in the Agent Section - deep-link
  // between chat and the graph."
  //
  // This is also the only route to an agent's actual output. The thread shows a
  // one-line outcome; the plan, the schema and the deployment summary are in the
  // inspector. Without this link the Shipper's work was simply invisible - the
  // user watched it report "done" and had no way to read what it produced.
  const inspectable = agentKey !== null && message.meta?.error !== true;

  return (
    <li className="flex items-start gap-2.5">
      <AgentBadge agentKey={agentKey} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          disabled={!inspectable}
          onClick={() => inspectable && onInspect?.(agentKey)}
          className={cn(
            "flex min-w-0 flex-col gap-0.5 rounded-md text-left transition-colors",
            inspectable &&
              "cursor-pointer px-1.5 py-1 -mx-1.5 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
          )}
          title={inspectable ? `See everything ${spec?.name ?? "this agent"} produced` : undefined}
        >
          <span className="flex items-baseline gap-2">
            <span className="text-xs font-medium">{spec?.name ?? "Team"}</span>
            <span className="truncate text-xs text-muted-foreground">
              {useTechnical ? message.technical ?? message.body : message.body}
            </span>
          </span>

          {files.length > 0 ? (
            <span className="truncate font-mono text-micro text-muted-foreground">
              {files.join(" · ")}
            </span>
          ) : null}
        </button>

        {inspectable ? (
          <button
            type="button"
            onClick={() => onInspect?.(agentKey)}
            className="self-start text-micro text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
          >
            See what {spec?.name ?? "they"} produced
          </button>
        ) : null}

        {/* The per-message switch. Hidden when there is nothing to reveal, so
            the thread does not fill with dead controls. */}
        {message.technical && message.technical !== message.body ? (
          <button
            type="button"
            onClick={() => setShowTechnical((value) => !value)}
            aria-pressed={showTechnical}
            className="self-start text-micro text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
          >
            {showTechnical ? "Show plain language" : "Show what actually happened"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Three examples, chosen because they are genuinely different shapes of app — a
 * diary, a stock list, a booking flow — rather than three phrasings of the same
 * thing. Clicking one sends it; nothing here is decorative.
 */
const EXAMPLES = [
  "A daily journal where I write an entry each morning and can search back through past years",
  "A small shop's stock list where I add a product, see what is low, and mark things as ordered",
  "A barbershop booking page: pick a chair, pick a time, and see the day's appointments",
];

/** The live status line while agents work. */
function WorkingLine({ waiting }: { waiting: string | null }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin" />
      <span>{waiting ?? "The team is working. You do not need to do anything."}</span>
    </p>
  );
}
