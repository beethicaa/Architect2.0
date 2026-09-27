"use client";

/**
 * What one agent actually produced.
 *
 * This is the payoff of the graph: the user is never asked to take an agent's
 * word for anything. Clicking the Planner shows the plan it wrote; clicking the
 * Data Agent shows the SQL it chose; clicking the Reviewer shows what it thinks
 * is wrong. The text is the model's own output, stored verbatim in
 * `agent_runs.agents` — not a summary written about it.
 *
 * The schema agent is the one special case, because "here is the data model" is
 * genuinely hard to read as prose. Its SQL is pulled out of the artifact and
 * shown in a monospace block, with the plain-language part still above it.
 */

import { X } from "lucide-react";
import * as React from "react";

import { AgentModelPicker } from "@/components/agents/agent-model-picker";
import { AgentBadge } from "@/components/builder/agent-badge";
import { Button } from "@/components/ui/button";
import { AGENT_BY_KEY, type AgentKey } from "@/lib/pipeline/agents";
import { cn } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

export function AgentInspector({
  projectId,
  agentKey,
  artifact,
  model,
  files,
  modelOverride,
  onModelChanged,
  onClose,
}: {
  projectId: string;
  agentKey: AgentKey;
  /** The agent's own output, stored verbatim. */
  artifact: unknown;
  model?: string;
  files: string[];
  /** The pinned override, or undefined when the agent is on auto. */
  modelOverride: string | undefined;
  onModelChanged: (agentKey: AgentKey, model: string | undefined) => void;
  onClose: () => void;
}) {
  const { isDeveloper } = useViewMode();
  const spec = AGENT_BY_KEY[agentKey];

  // The schema agent stores { sql, prose }; everything else stores a string.
  const isSchema =
    typeof artifact === "object" && artifact !== null && "sql" in artifact;
  const record = (isSchema ? artifact : {}) as { sql?: unknown; prose?: unknown };
  const sql = isSchema && typeof record.sql === "string" ? record.sql : null;
  const prose =
    isSchema && typeof record.prose === "string"
      ? record.prose
      : typeof artifact === "string"
        ? artifact
        : "";

  const headingId = `inspector-${agentKey}`;

  return (
    <section
      className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
      aria-labelledby={headingId}
    >
      <header className="flex items-start gap-2">
        <AgentBadge agentKey={agentKey} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 id={headingId} className="text-sm font-medium">
            {spec.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isDeveloper ? spec.technicalRole : spec.role}
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close">
          <X aria-hidden />
        </Button>
      </header>

      {isDeveloper && model ? (
        <p className="font-mono text-micro text-muted-foreground">
          {modelOverride ? model : `${model} (auto)`}
        </p>
      ) : null}

      {/* Developer lens only. In Simple mode the control is absent entirely, not
          disabled — the brief asks for no model or config controls there, and a
          greyed-out select still reads as "there is a setting you cannot reach". */}
      {isDeveloper ? (
        <AgentModelPicker
          projectId={projectId}
          agentKey={agentKey}
          current={modelOverride}
          onChanged={(next) => onModelChanged(agentKey, next)}
        />
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {files.map((file) => (
            <li key={file} className="truncate font-mono text-micro text-muted-foreground">
              {file}
            </li>
          ))}
        </ul>
      ) : null}

      {prose ? (
        <Prose text={prose} />
      ) : sql ? null : (
        <p className="text-sm text-muted-foreground">
          This agent has not written anything yet.
        </p>
      )}

      {agentKey === "shipper" ? (
        // The Shipper is the one agent whose output the brief promises as a
        // link, and it is the one that cannot produce one yet.
        //
        // Rather than let the panel look finished while showing no URL, this
        // states exactly what is missing and what would produce it. A "coming
        // soon" badge, or a URL that goes nowhere, is the exact class of
        // dishonesty this product was rebuilt to remove.
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed">
          <p className="font-medium text-foreground">No live link yet</p>
          <p className="mt-1 text-muted-foreground">
            The deployment plan below is real, and is what a Vercel deploy would be
            built from. Publishing needs a Vercel token in{" "}
            <code className="font-mono">.env.local</code> (
            <code className="font-mono">VERCEL_TOKEN</code>) — until then nothing is
            pretended to be online.
          </p>
        </div>
      ) : null}

      {sql ? (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium">
            {isDeveloper ? "Schema" : "What it decided to remember"}
          </h4>
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-micro leading-relaxed">
            <code>{sql}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The agent's prose.
 *
 * Rendered as plain text with paragraphs, not markdown. A markdown renderer would
 * be another dependency and another thing that can go wrong, and the content is
 * already structured by the prompt (a numbered plan, a list of patterns) — so
 * whitespace and line breaks carry it.
 */
function Prose({ text }: { text: string }) {
  const trimmed = text.replace(/```[\s\S]*?```/g, "").trim();
  const blocks = trimmed.split(/\n{2,}/).filter(Boolean);

  return (
    <div className={cn("flex flex-col gap-2 text-sm leading-relaxed")}>
      {blocks.slice(0, 40).map((block, index) => (
        <p key={index} className="whitespace-pre-wrap break-words">
          {block}
        </p>
      ))}
      {blocks.length > 40 ? (
        <p className="text-xs text-muted-foreground">
          …and {blocks.length - 40} more sections.
        </p>
      ) : null}
    </div>
  );
}
