"use client";

/**
 * An agent's icon and name.
 *
 * Deliberately tiny and shared by the thread and the graph, so the Planner looks
 * the same in both. One icon per specialist, used in every surface — that
 * consistency is what lets a user recognise who is speaking without reading the
 * name.
 */

import {
  Database,
  FileCode2,
  GitBranch,
  ListChecks,
  Radar,
  Rocket,
  ScrollText,
  Users,
} from "lucide-react";

import { AGENT_BY_KEY, type AgentKey } from "@/lib/pipeline/agents";
import { cn } from "@/lib/utils";

const ICONS: Record<AgentKey, React.ComponentType<{ className?: string }>> = {
  planner: ScrollText,
  researcher: Radar,
  data_schema: Database,
  data_wiring: GitBranch,
  interface: FileCode2,
  reviewer: ListChecks,
  shipper: Rocket,
};

export function AgentBadge({
  agentKey,
  className,
}: {
  agentKey: AgentKey | null;
  className?: string;
}) {
  if (!agentKey) {
    return (
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border border-border",
          className,
        )}
        aria-hidden
      >
        <Users className="size-3.5 text-muted-foreground" />
      </span>
    );
  }

  const Icon = ICONS[agentKey];
  const spec = AGENT_BY_KEY[agentKey];

  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border border-volt/40 bg-volt/10 text-volt",
        className,
      )}
      title={spec.name}
      aria-hidden
    >
      <Icon className="size-3.5" />
    </span>
  );
}
