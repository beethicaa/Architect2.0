import {
  Database,
  FileCode2,
  GitBranch,
  ListChecks,
  Network,
  Radar,
  Rocket,
  ScrollText,
} from "lucide-react";

import { AGENTS, type AgentKey, type AgentSpec } from "@/lib/pipeline/agents";

/**
 * The agent team, on the marketing page.
 *
 * It reads the *same* `lib/pipeline/agents.ts` the builder's graph does, so the
 * team advertised on the landing page is literally the team that runs. A static
 * illustration here would drift from the product within one commit; this cannot.
 *
 * That was true when it read the mock, and it is truer now: the mock described
 * an intended team, while this describes the seven agents `runPipeline` actually
 * calls, in the order it calls them.
 */
export function AgentTeam() {
  const [planner, ...rest] = AGENTS;

  return (
    <section
      id="team"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="flex max-w-2xl flex-col gap-3">
        <h2 className="font-heading text-2xl font-medium tracking-tight text-balance sm:text-3xl">
          You are not talking to a chatbot.
        </h2>
        <p className="leading-relaxed text-muted-foreground text-balance">
          You are talking to a team. Each specialist has one job, hands its work
          to the next, and can be inspected on its own. This is the part most
          &ldquo;build an app with AI&rdquo; tools hide — and the reason people
          either trust them completely or not at all.
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-5">
        <Node node={planner} primary />
        {rest.map((node) => (
          <Node key={node.key} node={node} />
        ))}
      </div>

      <div className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Network className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          The same graph, inside the product, is interactive: click any agent to
          see what it produced, or switch to the developer view to change the
          model it runs on.
        </span>
      </div>
    </section>
  );
}

const ICONS: Record<AgentKey, typeof Database> = {
  planner: ScrollText,
  researcher: Radar,
  data_schema: Database,
  data_wiring: GitBranch,
  interface: FileCode2,
  reviewer: ListChecks,
  shipper: Rocket,
};

function Node({
  node,
  primary = false,
}: {
  node: AgentSpec;
  primary?: boolean;
}) {
  const Icon = ICONS[node.key];
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground"
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">{node.name}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {node.role}
        </p>
        {primary ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Every build starts here, whatever you asked for.
          </p>
        ) : null}
      </div>
    </div>
  );
}
