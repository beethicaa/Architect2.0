"use client";

/**
 * The client half of the agent loop.
 *
 * Reads the NDJSON stream from `/api/projects/[id]/agent` and turns it into
 * renderable state. Everything the UI shows - the model's prose as it arrives,
 * each tool call, each file written - comes from a real Anthropic response. There
 * is no simulated progress and no timer: if nothing is happening, nothing moves.
 *
 * The `refresh` counter is what makes the preview update. When a `file` event
 * lands, the iframe's cache is busted so the newly written code is compiled and
 * re-rendered immediately.
 */

import * as React from "react";

import type { AgentEvent } from "@/lib/agent/run";

export interface ToolCall {
  name: string;
  ok: boolean;
  detail: string;
  at: number;
}

export interface WrittenFile {
  path: string;
  added: number;
  removed: number;
}

export interface TurnLog {
  index: number;
  input: number;
  output: number;
}

export interface AgentState {
  /** The model's prose, accumulating as it streams. */
  text: string;
  /** Whether the assistant is currently producing output. */
  streaming: boolean;
  running: boolean;
  tools: ToolCall[];
  files: WrittenFile[];
  turns: TurnLog[];
  summary: string;
  nextSteps: string[];
  error: string | null;
  /** Bump to force the preview iframe to reload. */
  refresh: number;
  model: string;
  /** How many times the pool moved this run to a different model. */
  switched: number;
}

const initial: AgentState = {
  text: "",
  streaming: false,
  running: false,
  tools: [],
  files: [],
  turns: [],
  summary: "",
  nextSteps: [],
  error: null,
  refresh: 0,
  model: "",
  switched: 0,
};

export function useAgent(projectId: string) {
  const [state, setState] = React.useState<AgentState>(initial);
  const abortRef = React.useRef<AbortController | null>(null);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((prev) => ({ ...prev, running: false, streaming: false }));
  }, []);

  const send = React.useCallback(
    async (instruction: string, model?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({
        ...initial,
        // A new turn starts clean, but keeps `refresh` so the preview does not
        // flicker back to empty while the first file is being written.
        refresh: prev.refresh,
        running: true,
        streaming: true,
      }));

      try {
        const response = await fetch(`/api/projects/${projectId}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, ...(model ? { model } : {}) }),
          signal: controller.signal,
        });

        if (!response.body) {
          setState((prev) => ({
            ...prev,
            running: false,
            streaming: false,
            error: "The agent returned no stream. Check the terminal for details.",
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // NDJSON: one complete JSON object per line. Anything after the last
          // newline is a partial line and stays in the buffer.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let event: AgentEvent;
            try {
              event = JSON.parse(trimmed) as AgentEvent;
            } catch {
              continue;
            }

            setState((prev) => applyEvent(prev, event));
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          running: false,
          streaming: false,
          error:
            error instanceof Error
              ? error.message
              : "The agent could not be reached.",
        }));
      } finally {
        setState((prev) => ({ ...prev, running: false, streaming: false }));
      }
    },
    [projectId],
  );

  React.useEffect(() => () => abortRef.current?.abort(), []);

  return { ...state, send, stop, clear: () => setState(initial) };
}

function applyEvent(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case "start":
      return { ...state, model: event.model, streaming: true };

    case "text":
      return { ...state, text: state.text + event.delta, streaming: true };

    case "tool":
      return {
        ...state,
        tools: [
          ...state.tools,
          { name: event.name, ok: event.ok, detail: event.detail, at: Date.now() },
        ],
      };

    case "file":
      return {
        ...state,
        files: [
          ...state.files.filter((f) => f.path !== event.path),
          { path: event.path, added: event.added, removed: event.removed },
        ],
        // A file changed, so the preview must recompile and re-render.
        refresh: state.refresh + 1,
      };

    case "turn":
      return {
        ...state,
        turns: [
          ...state.turns,
          { index: event.index, input: event.usage.input, output: event.usage.output },
        ],
      };

    case "model":
      // The pool moved this turn to a different model. Shown rather than hidden:
      // on a free tier that switch is a real thing happening, and a builder
      // watching the build should be able to see it.
      return { ...state, model: event.model, switched: state.switched + 1 };

    case "done":
      return {
        ...state,
        summary: event.summary,
        nextSteps: event.nextSteps,
        running: false,
        streaming: false,
      };

    case "error":
      return { ...state, error: event.message, running: false, streaming: false };
  }
}
