"use client";

import {
  Database,
  FileCode2,
  GitBranch,
  ListChecks,
  Radar,
  Rocket,
  ScrollText,
} from "lucide-react";
import * as React from "react";

import { AGENTS, type AgentKey, type AgentSpec } from "@/lib/pipeline/agents";
import { cn } from "@/lib/utils";

/**
 * The agent graph — the emotional and functional centre of the product.
 *
 * Built as a reusable component rather than a one-off animation, because three
 * surfaces need it and none of them should own it: the live builder, a historical
 * checkpoint, and the landing page. All three pass the same state and get
 * identical behaviour.
 *
 * Two decisions worth defending:
 *
 *  1. **It is a list, not an SVG canvas.** The brief wants an inspectable graph
 *     with handoffs; a canvas would need hit-testing, keyboard navigation and
 *     screen-reader support built from scratch. A semantic list of nodes joined
 *     by visible connectors gets keyboard focus, `aria-current` and a screen
 *     reader's "4 of 7" for free — and is responsive without a layout engine.
 *  2. **It is identical in both lenses.** Simple mode shows the same graph with
 *     plain labels and no model controls, so the *component* is the same and
 *     only the labels and the optional model row differ. That is what "the
 *     toggle changes how much is shown, not what functionality exists" means in
 *     practice.
 */

export type NodeState = "queued" | "running" | "done" | "failed";

export interface GraphNode {
  key: AgentKey;
  state: NodeState;
  /** Plain-language outcome, once the agent has finished. */
  outcome?: string;
  /** The model that ran it. Developer lens only. */
  model?: string;
  files?: string[];
  seconds?: number;
  tokens?: number;
  error?: string;
}

export interface AgentGraphState {
  nodes: GraphNode[];
  /** The node whose inspector is open, if any. */
  selected: AgentKey | null;
  onSelect: (key: AgentKey | null) => void;
  /** Developer lens reveals the model and timing. */
  showTechnical: boolean;
}

const ICONS: Record<AgentKey, React.ComponentType<{ className?: string }>> = {
  planner: ScrollText,
  researcher: Radar,
  data_schema: Database,
  data_wiring: GitBranch,
  interface: FileCode2,
  reviewer: ListChecks,
  shipper: Rocket,
};

export function AgentGraph({ nodes, selected, onSelect, showTechnical }: AgentGraphState) {
  // A node is "active" when it is selected, or — if nothing is selected — the
  // one currently running. Auto-following the running agent is what makes the
  // graph feel live rather than a static diagram the user has to keep in sync by
  // hand.
  const running = nodes.find((node) => node.state === "running");
  const active = selected ?? running?.key ?? null;

  return (
    <div
      className="flex flex-col"
      role="list"
      aria-label="The agents building your app, in order"
    >
      {AGENTS.map((spec, index) => {
        const node = nodes.find((entry) => entry.key === spec.key);
        const state: NodeState = node?.state ?? "queued";
        const isActive = active === spec.key;

        return (
          <React.Fragment key={spec.key}>
            <GraphNodeRow
              spec={spec}
              state={state}
              outcome={node?.outcome}
              model={node?.model}
              seconds={node?.seconds}
              files={node?.files}
              error={node?.error}
              index={index}
              showTechnical={showTechnical}
              active={isActive}
              onSelect={() => onSelect(isActive ? null : spec.key)}
            />
            {index < AGENTS.length - 1 ? <Handoff done={state === "done"} /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function GraphNodeRow({
  spec,
  state,
  outcome,
  model,
  seconds,
  files,
  error,
  index,
  showTechnical,
  active,
  onSelect,
}: {
  spec: AgentSpec;
  state: NodeState;
  outcome?: string;
  model?: string;
  seconds?: number;
  files?: string[];
  error?: string;
  index: number;
  showTechnical: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = ICONS[spec.key];

  return (
    <div role="listitem">
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={active}
        aria-current={state === "running" ? "step" : undefined}
        className={cn(
          "group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt",
          state === "running" && "border-volt/50 bg-volt/5",
          state !== "running" && active && "border-border bg-accent/40",
          state === "queued" && !active && "border-border/60",
          state !== "running" && !active && "hover:border-border hover:bg-accent/30",
        )}
      >
        <NodeIcon state={state}>
          <Icon className="size-4" />
        </NodeIcon>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{spec.name}</span>
            <span className="sr-only">Step {index + 1} of {AGENTS.length}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {showTechnical ? state : plainState(state)}
            </span>
          </span>

          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {error ?? outcome ?? (showTechnical ? spec.technicalRole : spec.role)}
          </span>

          {showTechnical ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
              {model ? <span className="font-mono">{model}</span> : null}
              {seconds != null ? <span>{seconds}s</span> : null}
              {files && files.length > 0 ? (
                <span>
                  {files.length} file{files.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

/** The connector between two agents. */
function Handoff({ done }: { done: boolean }) {
  return (
    <div className="flex h-5 items-center pl-[1.4rem]" aria-hidden>
      <span
        className={cn("h-full w-px transition-colors", done ? "bg-volt/40" : "bg-border")}
      />
    </div>
  );
}

/**
 * The node's state indicator.
 *
 * The colour is the product's five-state vocabulary, so a user learns "volt means
 * done" once. The running state pulses, which is the only animation in the
 * component — and it respects `prefers-reduced-motion` via the global stylesheet.
 */
function NodeIcon({
  state,
  children,
}: {
  state: NodeState;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
        state === "done" && "border-volt/50 bg-volt/10 text-volt",
        state === "running" && "animate-live-pulse border-volt bg-volt/15 text-volt",
        state === "failed" && "border-destructive/50 bg-destructive/10 text-destructive",
        state === "queued" && "border-border/60 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function plainState(state: NodeState): string {
  switch (state) {
    case "done":
      return "Done";
    case "running":
      return "Working";
    case "failed":
      return "Stopped";
    default:
      return "Waiting";
  }
}
