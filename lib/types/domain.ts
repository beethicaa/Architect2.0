/**
 * Shared domain types.
 *
 * Two sources feed the product:
 *  - REAL: the `projects` row from Postgres (see `lib/supabase/types.ts`)
 *  - MOCK: everything an agent "does" (see `lib/mock/*`)
 *
 * This file is the vocabulary that lets a screen talk about both without
 * caring. A component reads these types and never imports from `lib/mock/*`
 * and `@/lib/supabase/*` in the same breath.
 */

/* ------------------------------------------------------------------ the lens */

/**
 * The 2.0 mechanic: one product, two readings.
 *
 * The lens changes presentation only - never the query, never the payload.
 * See docs/product-vision.md.
 */
export type ViewMode = "simple" | "developer";

/* ------------------------------------------------------------- status states */

/**
 * The five states every agent / build / deploy surface uses. Sharing them is
 * what lets a user learn the language once (docs/design-system.md).
 */
export type RunState = "queued" | "working" | "done" | "needs-you" | "failed";

/* --------------------------------------------------------------- agent graph */

/** What an agent *is*, which decides its icon and its place in the graph. */
export type AgentKind =
  | "planner"
  | "research"
  | "schema"
  | "api"
  | "ui"
  | "review"
  | "deploy";

export interface AgentNode {
  id: string;
  /** Proper name, e.g. "Interface Agent". */
  name: string;
  /** Plain-language job, e.g. "Makes the screens you can click on." */
  role: string;
  kind: AgentKind;
  /** The model this node runs on - only surfaced in the developer lens. */
  model: string;
  state: RunState;
  /** 0-1. Only meaningful while `state === "working"`. */
  progress: number;
  /** 0-1 across the whole build; drives the node's fill in the graph. */
  completion: number;
  /** Ids this node waits for. */
  dependsOn: string[];
  /** What the node produced, in the user's words. */
  outputs: string[];
}

export interface AgentEdge {
  from: string;
  to: string;
  /** What flows across the handoff, e.g. "schema". */
  handoff?: string;
}

export interface AgentGraph {
  nodes: AgentNode[];
  edges: AgentEdge[];
}

/* -------------------------------------------------------------- build stream */

export interface BuildStep {
  id: string;
  /** Short imperative, shown to everyone: "Draw the booking screen". */
  title: string;
  /** What actually happened, shown to developers. */
  detail: string;
  state: RunState;
  /** Seconds; omitted while running. */
  seconds?: number;
  /** Tokens spent (developer lens). */
  tokens?: number;
  /** Files this step wrote, as repo-relative paths. */
  files: string[];
  /** The agent node that owns the step. */
  agentId: string;
}

export interface BuildRun {
  id: string;
  prompt: string;
  state: RunState;
  /** 0-1 overall. */
  progress: number;
  steps: BuildStep[];
  startedAt: string;
  finishedAt?: string;
  /** Aggregate spend, developer lens only. */
  tokens: number;
  costUsd: number;
}

/* -------------------------------------------------------------- chat thread */

export type ChatRole = "you" | "agent";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** What was said. Rendered identically in both lenses. */
  text: string;
  /** True while tokens are still arriving. */
  streaming?: boolean;
  /** Plain-language result line, e.g. "Added 3 screens". Simple lens. */
  outcome?: string;
  /** Developer-only evidence: tool calls, files, tokens, latency. */
  trace?: string[];
  /** A version id when this message produced a checkpoint. */
  versionId?: string;
  /** Which agent authored the reply. */
  agentId?: string;
}

/* ------------------------------------------------------------------ preview */

export type PreviewScreen = "home" | "detail" | "form" | "settings";

export interface PreviewState {
  screen: PreviewScreen;
  /** 0-1; the UI is "still being built" below 1. */
  completeness: number;
  /** The live URL a real deploy would serve. Mocked. */
  liveUrl: string;
  status: RunState;
}

/* ---------------------------------------------------------------- GitHub */

export interface GitHubRepo {
  id: string;
  fullName: string;
  description: string;
  language: string;
  private: boolean;
  updatedAt: string;
  stars: number;
  defaultBranch: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  authoredAt: string;
  /** True for commits an agent made rather than a human. */
  byAgent: boolean;
  agentName?: string;
  filesChanged: number;
}

/* --------------------------------------------- Time Machine (the original) */

export interface Version {
  id: string;
  /** The sentence a builder would use: "Added the booking page". */
  label: string;
  /** One line explaining what changed and why. */
  receipt: string;
  createdAt: string;
  /** Plain: "5 screens changed". Developer: files + agent run. */
  summary: string;
  files: string[];
  agentRun: string;
  /** Screen count, for the timeline thumbnail. */
  screens: number;
  restored?: boolean;
}

/* ----------------------------------------------------------------- deploy */

export interface Deployment {
  id: string;
  environment: "preview" | "production";
  state: RunState;
  url: string;
  createdAt: string;
  /** Version this deploy was cut from. */
  versionId: string;
  commitSha: string;
  logs: string[];
}
