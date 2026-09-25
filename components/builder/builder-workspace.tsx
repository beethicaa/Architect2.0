"use client";

/**
 * The builder workspace.
 *
 * Three columns, each showing a real thing:
 *
 *   left    the conversation with the agent - its actual prose, its actual tool
 *           calls, its actual errors, streamed
 *   middle  the app, running. An iframe over the project's real compiled files
 *   right   the code, read back from Postgres, with real diff counts
 *
 * The right panel is a tabbed stack because density is opt-in: a non-technical
 * builder should see their app, not a wall of source.
 *
 * There is no build clock, no scripted timeline and no progress percentage.
 * Those were the previous version's way of faking an agent, and they are gone.
 */

import { Code2 } from "lucide-react";
import * as React from "react";

import { BuildChat } from "@/components/builder/build-chat";
import { CodePanel } from "@/components/builder/code-panel";
import { LivePreview } from "@/components/builder/live-preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgent } from "@/hooks/use-agent";
import { MODELS } from "@/lib/agent/provider";
import type { ProjectFile, Project } from "@/lib/supabase/types";
import { useViewMode } from "@/lib/view-mode";

export function BuilderWorkspace({
  project,
  files,
  reloadFiles,
  agentReady,
  setupHint,
}: {
  project: Project;
  files: ProjectFile[];
  reloadFiles: () => void;
  /** Decided on the server; a client cannot read a server-only env var. */
  agentReady: boolean;
  /** The setup text is also passed in, so no client module imports lib/env. */
  setupHint: string;
}) {
  const { isDeveloper } = useViewMode();

  /*
   * The agent hook lives here, not in the chat.
   *
   * The chat renders the agent's output, but the *rest* of the workspace also
   * needs to know when the agent is running and which files it just wrote - the
   * preview reloads on a write, and the code panel flags what is new. Lifting it
   * means one source of truth for "what has the agent done", instead of three
   * components each holding a partial copy.
   */
  const agent = useAgent(project.id);
  const lastRefresh = React.useRef(agent.refresh);
  const [model, setModel] = React.useState<string | undefined>(undefined);

  // A model chosen here is forwarded to the route, which validates it against
  // the known list. It lives in this component rather than the chat because the
  // header renders it and the chat sends it - one control, one owner.
  const send = React.useCallback(
    (text: string) => agent.send(text, model),
    [agent, model],
  );

  React.useEffect(() => {
    if (agent.refresh !== lastRefresh.current) {
      lastRefresh.current = agent.refresh;
      reloadFiles();
    }
  }, [agent.refresh, reloadFiles]);

  const activePaths = agent.files.map((file) => file.path);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm font-medium">{project.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
            {agentReady
              ? agent.model
                ? `Groq · ${agent.model}`
                : "Groq connected"
              : "no agent key"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isDeveloper ? <ModelPicker value={model} onChange={setModel} /> : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[24rem_minmax(0,1fr)_28rem]">
        {/* Conversation */}
        <section
          className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0"
          aria-label="Conversation"
        >
          <BuildChat
            agent={agent}
            onSend={send}
            agentReady={agentReady}
            setupHint={setupHint}
            initialPrompt={project.prompt ?? ""}
            className="min-h-0 flex-1"
          />
        </section>

        {/* Preview */}
        <section className="flex min-h-0 flex-col" aria-label="Preview">
          <LivePreview
            projectId={project.id}
            refresh={agent.refresh}
            running={agent.running}
            hasFiles={files.length > 0}
            className="min-h-[26rem] flex-1"
          />
        </section>

        {/* Files */}
        <section
          className="flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0"
          aria-label="Files"
        >
          <Tabs defaultValue="code" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList variant="line" className="h-auto w-full justify-start gap-0 px-2">
              <TabsTrigger value="code">
                <Code2 />
                <span className="hidden sm:inline">Code</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="code" className="min-h-0 flex-1 overflow-y-auto p-3">
              <CodePanel files={files} activePaths={activePaths} />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}

/** Which model is actually answering. Shown only in the developer lens. */

/**
 * Which model builds the app.
 *
 * Developer lens only - a non-technical builder has no reason to know that
 * models exist, and a picker in the simple view is noise. "Auto" means the
 * server default, so a new model on the provider's side needs no UI change.
 */
function ModelPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = "architect-model";
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Model
      </label>
      <select
        id={id}
        value={value ?? "auto"}
        onChange={(event) =>
          onChange(event.target.value === "auto" ? undefined : event.target.value)
        }
        className="h-7 rounded-md border border-border bg-background px-2 font-mono text-micro"
      >
        <option value="auto">auto</option>
        {MODELS.map((option) => (
          <option key={option.id} value={option.id} title={option.note}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

