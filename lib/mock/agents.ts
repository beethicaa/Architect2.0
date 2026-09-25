/**
 * MOCK: the agent team, for the marketing page.
 *
 * Architect's real runtime is a single Claude session with tools, not six
 * separate agents - see `lib/agent/run.ts`. So this file is honest about what it
 * is: the *shape* of the work a build involves, expressed as roles a
 * non-technical builder can read, used to explain the product on the landing
 * page.
 *
 * It is a description of the work, not a simulation of it. Nothing in the
 * product runs from this data.
 */

import type { AgentKind, AgentNode } from "@/lib/types/domain";

const AGENT_NODES: Omit<AgentNode, "state" | "progress" | "completion" | "dependsOn" | "outputs">[] = [
  {
    id: "planner",
    kind: "planner",
    name: "Planner",
    role: "Reads what you asked for and decides what to build.",
    model: "claude-sonnet-4-5",
  },
  {
    id: "research",
    kind: "research",
    name: "Researcher",
    role: "Looks at how other apps solve this before writing anything.",
    model: "claude-haiku-4-5",
  },
  {
    id: "schema",
    kind: "schema",
    name: "Data Agent",
    role: "Decides what the app needs to remember.",
    model: "claude-sonnet-4-5",
  },
  {
    id: "api",
    kind: "api",
    name: "Data Agent",
    role: "Connects the screens to real, saved data.",
    model: "claude-sonnet-4-5",
  },
  {
    id: "ui",
    kind: "ui",
    name: "Interface Agent",
    role: "Makes the screens you can click on.",
    model: "claude-sonnet-4-5",
  },
  {
    id: "review",
    kind: "review",
    name: "Reviewer",
    role: "Tries to break it before you find the problem.",
    model: "claude-sonnet-4-5",
  },
  {
    id: "deploy",
    kind: "deploy",
    name: "Shipper",
    role: "Puts it online and hands you the link.",
    model: "claude-haiku-4-5",
  },
];

/** The team, in the order a build introduces them. */
export function createAgentGraph(): { nodes: AgentNode[] } {
  return { nodes: AGENT_NODES as AgentNode[] };
}

export type { AgentKind };
