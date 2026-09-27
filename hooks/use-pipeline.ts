"use client";

/**
 * Drives the seven-agent pipeline from the browser.
 *
 * Reads the NDJSON stream from `/api/projects/[id]/pipeline` and reduces each
 * `RunEvent` into graph state. The reducer is the important part: it is the
 * *same* shape whether an event arrived over the socket or was reconstructed
 * from `agent_runs` after a reload, so a dropped connection mid-build does not
 * lose progress. That is Section 10's reconnect requirement, and it is why the
 * state lives in one pure reducer rather than a pile of `setState` calls.
 *
 * It deliberately does not hold the chat thread. The server already wrote every
 * turn to `project_messages`, so a second client-side copy would eventually
 * disagree with it.
 */

import * as React from "react";

import type { GraphNode, NodeState } from "@/components/agents/agent-graph";
import { AGENT_KEYS, type AgentKey } from "@/lib/pipeline/agents";
import type { ApprovalGate, RunEvent } from "@/lib/pipeline/types";

interface PipelineState {
  nodes: GraphNode[];
  running: boolean;
  runId: string | null;
  gate: ApprovalGate | null;
  /** Streaming text for the agent currently working, keyed by agent. */
  streaming: Record<string, string>;
  /** Bumped whenever a file lands, so the preview and code panel re-read. */
  refresh: number;
  written: { path: string; language: string }[];
  error: string | null;
  /** Free-tier backpressure, shown verbatim because it is not our fault. */
  waiting: string | null;
  switches: number;
}

export const EMPTY_PIPELINE: PipelineState = {
  nodes: AGENT_KEYS.map((key) => ({ key, state: "queued" as NodeState })),
  running: false,
  runId: null,
  gate: null,
  streaming: {},
  refresh: 0,
  written: [],
  error: null,
  waiting: null,
  switches: 0,
};

/**
 * Apply one event. Pure, so the same function serves the live stream and a
 * replay from the database.
 */
function reduce(state: PipelineState, event: RunEvent): PipelineState {
  const patch = (key: AgentKey, next: Partial<GraphNode>): GraphNode[] =>
    state.nodes.map((node) => (node.key === key ? { ...node, ...next } : node));

  switch (event.type) {
    case "agent-start":
      return {
        ...state,
        running: true,
        nodes: patch(event.agentKey, {
          state: "running",
          model: event.model,
          outcome: undefined,
          error: undefined,
        }),
      };

    case "agent-text":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          [event.agentKey]: (state.streaming[event.agentKey] ?? "") + event.delta,
        },
      };

    case "agent-done": {
      const stream = state.streaming[event.agentKey] ?? "";
      return {
        ...state,
        nodes: patch(event.agentKey, {
          state: "done",
          // The streamed prose becomes the node's outcome, so the graph shows
          // what the agent actually said rather than its static job description.
          outcome: firstLine(stream) || undefined,
          files: event.files,
          seconds: event.seconds,
          tokens: event.tokens,
        }),
        streaming: { ...state.streaming, [event.agentKey]: "" },
      };
    }

    case "agent-failed":
      return {
        ...state,
        nodes: patch(event.agentKey, { state: "failed", error: event.error }),
        error: event.error,
      };

    case "file-written":
      return {
        ...state,
        written: [...state.written, { path: event.path, language: event.language }],
        // One bump per file; the preview coalesces these itself.
        refresh: state.refresh + 1,
        // A wait is only true while waiting. Work arriving means the retry
        // succeeded, so the notice is cleared here rather than lingering until
        // the run ends - "retrying (attempt 2 of 4)" sitting on screen after the
        // file has landed is its own kind of wrong.
        waiting: null,
      };

    case "gate":
      return { ...state, gate: event.gate, running: false };

    case "waiting":
      return { ...state, waiting: event.reason };

    case "model-switch":
      return { ...state, switches: state.switches + 1 };

    case "complete":
      return { ...state, running: false, waiting: null, runId: event.runId };

    case "failed":
      return { ...state, running: false, error: event.error };

    default:
      return state;
  }
}


export function usePipeline(projectId: string) {
  const [state, setState] = React.useState<PipelineState>(EMPTY_PIPELINE);
  const abortRef = React.useRef<AbortController | null>(null);

  // Guards a double submit without reading a ref during render: `running` is
  // already in the closure below, and the button is disabled while it is true,
  // so the only remaining risk is a submit landing in the same tick.
  const startGuard = React.useRef(false);

  const apply = React.useCallback((event: RunEvent) => {
    setState((current) => reduce(current, event));
  }, []);

  const start = React.useCallback(
    async (prompt: string, options?: { isRedirect?: boolean; resume?: boolean }) => {
      if (startGuard.current) return;
      startGuard.current = true;

      try {
        // A new run clears the previous one. Keeping stale node outcomes would
        // show a finished build's claims next to a fresh agent working.
        setState({ ...EMPTY_PIPELINE, running: true });

        const controller = new AbortController();
        abortRef.current = controller;

        const response = await fetch(`/api/projects/${projectId}/pipeline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, isRedirect: options?.isRedirect, resume: options?.resume }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setState((current) => ({
            ...current,
            running: false,
            error: body?.error ?? "The build could not start.",
          }));
          return;
        }

        await readNdjson(response.body, apply, controller.signal);
      } catch {
        // An abort is the user pressing stop, which is not an error.
        if (!abortRef.current?.signal.aborted) {
          setState((current) => ({
            ...current,
            running: false,
            error:
              "The connection dropped, so the build stopped. Everything written so far is saved.",
          }));
        }
      } finally {
        startGuard.current = false;
      }
    },
    [projectId, apply],
  );

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /**
   * Re-open a gate that was raised by an earlier run.
   *
   * The live `gate` event only arrives while a stream is running, so a run that
   * parked waiting for an answer looked identical to a stalled one after a
   * reload: the thread said "Needs your decision" and rendered no buttons,
   * because a pending gate message deliberately renders `null` on the assumption
   * that the live card is showing. The gate is persisted in the message's `meta`,
   * so it can be restored rather than lost.
   */
  const restoreGate = React.useCallback((gate: ApprovalGate, runId: string) => {
    setState((current) =>
      current.gate ? current : { ...current, gate, runId, running: false },
    );
  }, []);

  /**
   * Answer a parked approval gate, then continue the build.
   *
   * The POST only *records* the decision - it writes the answer into the
   * conversation and closes the gate. It does not re-drive the pipeline, so
   * nothing moved on: the card cleared and the run stayed parked after
   * Researcher, which read exactly like a hang.
   *
   * A new run is started deliberately. The pipeline replays
   * `project_messages`, which now contains the decision, so the next agent sees
   * the user's choice as part of the conversation rather than being handed a
   * special resume path it would have to duplicate.
   */
  const answer = React.useCallback(
    async (optionId: string) => {
      if (!state.gate || !state.runId) return;
      try {
        const response = await fetch(`/api/projects/${projectId}/gate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: state.runId,
            gate: state.gate,
            optionId,
          }),
        });
        if (!response.ok) {
          setState((current) => ({
            ...current,
            error: "We could not record your answer. Try again.",
          }));
          return;
        }
        setState((current) => ({ ...current, gate: null }));
        /*
         * A resume flag, not a placeholder message. The route rejected an empty turn
         * with a 400, and posting "Continue the build." worked but left a line in
         * the thread that the user never wrote and could not explain.
         *
         * The wording is deliberate: the decision itself was already written into
         * `project_messages` by the gate endpoint, so this is only a nudge to
         * carry on, not a restatement of what was chosen.
         */
        await start("", { resume: true });
      } catch {
        setState((current) => ({
          ...current,
          error: "We could not record your answer. Try again.",
        }));
      }
    },
    [projectId, state.gate, state.runId, start],
  );

  return React.useMemo(
    () => ({
      ...state,
      start,
      stop,
      restoreGate,
      answer,
      writtenPaths: state.written.map((entry) => entry.path),
    }),
    [state, start, stop, restoreGate, answer],
  );
}

/**
 * Read an NDJSON body one line at a time.
 *
 * `TextDecoderStream` plus a manual line split, because a `fetch` response body
 * delivers chunks at arbitrary boundaries — a chunk landing mid-line is the
 * normal case, not an edge case, and splitting on newline handles it.
 */
async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();
  let buffer = "";

  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      const lines = buffer.split("\n");
      // The last element is either empty or a partial line; keep it buffered.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onEvent(JSON.parse(trimmed) as RunEvent);
        } catch {
          // A malformed line is dropped rather than killing the stream. The run
          // continues server-side and the checkpoint still lands.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function firstLine(text: string): string {
  const line = text
    .replace(/<architect:write[\s\S]*?<\/architect:write>/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_`>]/g, "")
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return (line ?? "").slice(0, 160);
}

export { reduce as reducePipelineEvent };
