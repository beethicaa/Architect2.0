/**
 * The types both sides of the pipeline share.
 *
 * These live apart from `run.ts` on purpose. The run loop is server-only — it
 * imports the Supabase client and the model provider — so a client component
 * importing a type from it would pull that whole graph into the browser bundle.
 * Types are erased at compile time, but the *module* still has to resolve, and
 * `@/lib/supabase/server` throws outside a request. So the vocabulary the client
 * needs lives here, and the server imports it too.
 *
 * `RunEvent` is the wire format of the NDJSON stream. The client reducer and the
 * server emitter both speak it, which is what makes a reconnect able to replay
 * events instead of restarting the build.
 */

import type { Json } from "@/lib/supabase/types";
import type { AgentKey, PipelineStage } from "./agents";

/** An approval gate, parked on a run until the user answers. */
export interface ApprovalGate {
  agentKey: AgentKey;
  question: string;
  /** Why this needs a person, in plain language. */
  why: string;
  options: { id: string; label: string; detail: string }[];
  raisedAt: string;
}

/** Per-agent state, as the graph and the inspector consume it. */
export interface AgentState {
  state: "queued" | "running" | "done" | "failed";
  model: string;
  plain: string;
  technical: string;
  /** The agent's own output. What the inspector renders, verbatim. */
  artifact: Json | null;
  files: string[];
  /**
   * Writes refused before persisting, with the reason.
   *
   * Recorded rather than discarded: a file rejected for a syntax error would
   * otherwise vanish with no trace, and the user would see a build that quietly
   * produced less than it claimed.
   */
  rejected: string[];
  /**
   * What each written file exports, captured from the text that was actually
   * saved.
   *
   * This is the contract between agents, and its absence is what caused a
   * fourteen-error build: the Interface Agent imported `getNotes` and
   * `setNotes` from a module that exported `listNotes` and `addNote`, because
   * nothing ever told it what the Data Agent had produced.
   */
  exports: Record<string, string[]>;
  tokens: number;
  seconds: number | null;
  error: string | null;
}

export type AgentStates = Partial<Record<AgentKey, AgentState>>;

export type RunEvent =
  | { type: "agent-start"; agentKey: AgentKey; stage: PipelineStage; model: string }
  | { type: "agent-text"; agentKey: AgentKey; delta: string }
  | { type: "agent-done"; agentKey: AgentKey; files: string[]; seconds: number; tokens: number }
  | { type: "agent-failed"; agentKey: AgentKey; error: string }
  | { type: "file-written"; path: string; language: string }
  | { type: "gate"; gate: ApprovalGate }
  | { type: "waiting"; reason: string; resumeAt: number }
  | { type: "model-switch"; from: string; to: string; reason: string }
  | { type: "complete"; runId: string; receipt: string }
  | { type: "failed"; error: string };

/** The option id the UI uses for "no, do something else". */
export const REJECT_OPTION = "__reject";

/** The stack an agent-built app can be written in (Section 10's picker). */
export const FRAMEWORKS = [
  { id: "react", label: "React", hint: "The default. Best preview support." },
  { id: "next", label: "Next.js", hint: "If this app will grow into a real product." },
  { id: "vue", label: "Vue", hint: "If your team already knows Vue." },
  { id: "svelte", label: "Svelte", hint: "If you want the smallest possible output." },
  { id: "vanilla", label: "Plain HTML/CSS/JS", hint: "No framework at all." },
] as const;

export type FrameworkId = (typeof FRAMEWORKS)[number]["id"];

export function frameworkLabel(id: string | null | undefined): string {
  if (!id) return "React";
  return FRAMEWORKS.find((entry) => entry.id === id)?.label ?? id;
}
