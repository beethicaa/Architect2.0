"use client";

/**
 * The builder workspace: conversation, live preview, and the agent graph.
 *
 * The graph is a tab rather than an afterthought because it is the product's
 * central claim — you are talking to a visible team, not a black box — so it is
 * present in both lenses and only the labels differ.
 *
 * The pipeline hook lives here rather than in the chat, because the preview and
 * the graph both need to know which files just landed. One source of truth for
 * "what has the team done", instead of three components each holding a copy.
 *
 * There is no build clock, no scripted timeline and no progress percentage.
 * Those were the previous version's way of faking an agent.
 */

import { Code2, History, Rocket, Workflow } from "lucide-react";
import * as React from "react";

import { AgentGraph } from "@/components/agents/agent-graph";
import { AgentInspector } from "@/components/agents/agent-inspector";
import { BuildChat } from "@/components/builder/build-chat";
import { CodePanel } from "@/components/builder/code-panel";
import { DeployPanel } from "@/components/deploy/deploy-panel";
import { LivePreview } from "@/components/builder/live-preview";
import { CheckpointTimeline } from "@/components/checkpoints/checkpoint-timeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePipeline } from "@/hooks/use-pipeline";
import type { AgentKey } from "@/lib/pipeline/agents";
import type { Project, ProjectFile } from "@/lib/supabase/types";
import { useViewMode } from "@/lib/view-mode";
import { cn } from "@/lib/utils";

type Artifacts = Partial<
  Record<AgentKey, { artifact: unknown; model: string; files: string[] }>
>;

export function BuilderWorkspace({
  project,
  files,
  reloadFiles,
  agentReady,
  setupHint,
  artifacts,
  agentModels: initialAgentModels,
  vercelReady,
}: {
  project: Project;
  files: ProjectFile[];
  reloadFiles: () => void;
  /** Decided on the server; a client cannot read a server-only env var. */
  agentReady: boolean;
  setupHint: string;
  /** Per-agent artifacts, read from the run row on the server. */
  artifacts: Artifacts;
  /** Per-agent model overrides, read from the server. */
  agentModels: Record<string, string>;
  /** Whether a Vercel token is configured, decided on the server. */
  vercelReady: boolean;
}) {
  const { isDeveloper } = useViewMode();
  const pipeline = usePipeline(project.id);
  const [selected, setSelected] = React.useState<AgentKey | null>(null);
  const [tab, setTab] = React.useState("agents");
  // Simple-lens opt-in to the code panel. A non-technical user is not shown code,
  // diffs or file paths unless they ask for them, but the capability is one click
  // away rather than hidden, because the two lenses are the same product.
  const [showCode, setShowCode] = React.useState(false);

  // Switching to Developer while the code panel is open should land on it, and
  // switching away from a tab that no longer exists must not leave the panel blank.
  //
  // Derived rather than synchronised with an effect: the only meaningful outcome
  // is "a tab is showing that this lens cannot show", and a derived value cannot
  // lag behind the lens the way an effect's second render pass does.
  const visibleTab = !isDeveloper && !showCode && tab === "code" ? "agents" : tab;

  // Held locally so the selector reflects a change immediately, and so the
  // workspace owns one map rather than each inspector instance guessing. The
  // server copy is already saved by the time this updates, so a reload agrees.
  //
  // The re-sync uses the "adjust state during render" pattern rather than an
  // effect: an effect here would fire a second render pass on every server
  // update, which is the cascading-render problem React's lint rule is pointing
  // at, and it would briefly show the stale map.
  const [agentModels, setAgentModels] = React.useState(initialAgentModels);
  const [syncedFrom, setSyncedFrom] = React.useState(initialAgentModels);
  if (syncedFrom !== initialAgentModels) {
    setSyncedFrom(initialAgentModels);
    setAgentModels(initialAgentModels);
  }

  const onModelChanged = React.useCallback(
    (agentKey: AgentKey, model: string | undefined) => {
      setAgentModels((current) => {
        const next = { ...current };
        if (model) next[agentKey] = model;
        else delete next[agentKey];
        return next;
      });
    },
    [],
  );

  // A rollback rewrites project_files server-side, so the preview has to
  // re-compile from scratch. It is a separate tick from the pipeline's refresh
  // because a restore is not an agent write — the two would otherwise be
  // indistinguishable to the preview, which is exactly the kind of hidden
  // coupling that makes a bug impossible to find later.
  const [restoreTick, setRestoreTick] = React.useState(0);
  const previewRefresh = pipeline.refresh + restoreTick;

  // A file landing is a real change in the database, so the list is re-read
  // rather than patched optimistically. The preview, the code panel and the
  // checkpoint all read the same table, and only the database keeps them
  // agreeing.
  React.useEffect(() => {
    if (pipeline.refresh > 0) reloadFiles();
  }, [pipeline.refresh, reloadFiles]);

  // The first request starts a build; later ones redirect it. Decided from
  // whether any agent has already produced something, so a second request reads
  // as an edit rather than a fresh build.
  const hasBuilt = Object.keys(artifacts).length > 0;
  const startRun = pipeline.start;
  const send = React.useCallback(
    (text: string) => void startRun(text, { isRedirect: hasBuilt }),
    [startRun, hasBuilt],
  );

  // Start building the moment the builder opens, if the project was created
  // from a prompt on the dashboard and nothing has been built yet.
  //
  // Asking the user to type the same sentence a second time is the single most
  // annoying thing this flow could do: they already said it, it is stored on the
  // project, and the whole point of the dashboard's big prompt box is that it is
  // the thing you press. So it fires on arrival.
  //
  // Three guards, each for a real reason:
  //   - no prompt: the project came from a repository, or was made by hand.
  //   - an import never auto-builds: its files are the user's existing code, and
  //     a build that starts the instant a repository is opened replaces the thing
  //     they imported. This was the "travel planner" failure — an empty workspace
  //     plus an agent with a mandate to fill it.
  //   - files exist: a build already happened, so this is a resume, not a start.
  //   - artifacts exist: the run row was written, so a previous build completed.
  //     Covers the case where files exist but the first run is still replaying.
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (autoStarted.current) return;
    if (pipeline.running) return;
    if (!agentReady) return;
    if (project.origin === "import") return;
    if (files.length > 0 || hasBuilt) return;
    if (!project.prompt || project.prompt.trim().length < 8) return;

    autoStarted.current = true;
    void startRun(project.prompt, { isRedirect: false });
  }, [
    agentReady,
    files.length,
    hasBuilt,
    project.origin,
    project.prompt,
    pipeline.running,
    startRun,
  ]);

  return (
    // `h-full` rather than growing with content.
    //
    // The app shell is now a fixed-height column (`h-dvh`, `overflow-hidden`), so
    // this workspace must fill exactly the space below the site header. When it
    // grew instead, the three columns inherited the *document's* height, the
    // chat panel's own scroll never engaged, and the composer was pushed below
    // the fold - so sending a message meant scrolling the whole page down to find
    // the box. A builder tool that hides its own input is a broken tool.
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm font-medium">{project.name}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"}
            {pipeline.switches > 0 ? ` · ${pipeline.switches} model switches` : ""}
            {pipeline.running ? " · agents working" : ""}
          </p>
        </div>
        {/* No History button here.
            There were two controls for one job: this one and the tab below, and
            the header copy is the least reliable place to put an action someone
            needs often - it is the first thing to be squeezed out on a narrow
            window. The tab is always visible, always in the same place, and its
            label already changes with the lens ("History" / "Undo"). Duplicating
            it was two things to keep in sync for no gain. */}
      </header>

      {/*
        The column widths are part of the lens, not just the labels.

        Simple gets a narrower conversation and a wider preview. A non-technical
        user is here to look at the thing they asked for; a developer is splitting
        attention between the thread and the code, and needs both to be readable
        at once. Same three panels, same data, different emphasis - which is what
        the brief means by the toggle "changing how much is shown, not what
        functionality exists".
      */}
      <div
        className={cn(
          "grid min-h-0 flex-1 lg:grid-cols-[var(--chat-w)_minmax(0,1fr)_var(--panel-w)]",
          /*
       * One layout for both lenses.
       *
       * These were `--chat-w: 24rem` / `--panel-w: 30rem` for Developer and
       * 19rem / 24rem for Simple, on the reasoning that a non-technical user
       * wants a wider preview. In practice it made the two lenses look like
       * different products: the chat reflowed and the whole workspace jumped
       * sideways when the toggle was pressed. The lens now changes what is
       * *shown* - words, model names, whether code is visible - and never the
       * geometry, so switching is a change of content rather than of shape.
       */
      "[--chat-w:24rem] [--panel-w:30rem]",
        )}
      >
        <section
          className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0"
          aria-label="Conversation"
        >
          <BuildChat
            projectId={project.id}
            running={pipeline.running}
            gate={pipeline.gate}
            onAnswer={pipeline.answer}
      onRestoreGate={pipeline.restoreGate}
            onSend={send}
            onStop={pipeline.stop}
            onInspect={setSelected}
            error={pipeline.error}
            waiting={pipeline.waiting}
            agentReady={agentReady}
            setupHint={setupHint}
            className="min-h-0 flex-1"
          />
        </section>

        <section className="flex min-h-0 flex-col" aria-label="Preview">
          <LivePreview
            projectId={project.id}
            refresh={previewRefresh}
            running={pipeline.running}
            hasFiles={files.length > 0}
            className="min-h-[26rem] flex-1"
          />
        </section>

        <section
          className="flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0"
          aria-label="Agents and files"
        >
          <Tabs
            value={visibleTab}
            onValueChange={setTab}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList variant="line" className="h-auto w-full justify-start gap-0 px-2">
              <TabsTrigger value="agents">
                <Workflow />
                <span className="hidden sm:inline">
                  {isDeveloper ? "Agents" : "Your team"}
                </span>
              </TabsTrigger>

              {/* Code is a developer-lens surface.
                  The brief is explicit that a non-technical user must "never see
                  code, diffs, commits, or model names unless they explicitly opt
                  in", so in Simple mode there is no Code tab at all. What is there
                  instead is a deliberate switch, because the capability has to
                  remain reachable: one click and the same panel appears, and the
                  choice is remembered for the session. */}
              {isDeveloper || showCode ? (
                <TabsTrigger value="code">
                  <Code2 />
                  <span className="hidden sm:inline">Code</span>
                </TabsTrigger>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCode(true)}
                  className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
                  title="Show the code the team is writing"
                >
                  <Code2 />
                  <span className="hidden sm:inline">Show code</span>
                </button>
              )}

              <TabsTrigger value="deploy">
                <Rocket aria-hidden />
                <span className="hidden sm:inline">
                  {isDeveloper ? "Deploy" : "Publish"}
                </span>
              </TabsTrigger>

              <TabsTrigger value="history">
                <History />
                <span className="hidden sm:inline">
                  {isDeveloper ? "History" : "Undo"}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agents" className="min-h-0 flex-1 overflow-y-auto p-3">
              <AgentGraph
                nodes={pipeline.nodes}
                selected={selected}
                onSelect={setSelected}
                showTechnical={isDeveloper}
              />
              {selected ? (
                <AgentInspector
                  projectId={project.id}
                  agentKey={selected}
                  artifact={artifacts[selected]?.artifact ?? null}
                  model={
                    agentModels[selected] ??
                    artifacts[selected]?.model ??
                    pipeline.nodes.find((node) => node.key === selected)?.model
                  }
                  files={artifacts[selected]?.files ?? []}
                  modelOverride={agentModels[selected]}
                  onModelChanged={onModelChanged}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Select an agent to see exactly what it produced.
                </p>
              )}
            </TabsContent>

            <TabsContent value="code" className="min-h-0 flex-1 overflow-y-auto p-3">
              <CodePanel files={files} activePaths={pipeline.writtenPaths} />
            </TabsContent>

            {/* Publishing. The Shipper promises a live link, and this is where
                that promise is kept - a real deployment with a real URL, polled
                until Vercel reports it ready, with the provider's own log lines
                rather than an invented progress bar. */}
            <TabsContent value="deploy" className="min-h-0 flex-1 overflow-y-auto p-3">
              <DeployPanel
                projectId={project.id}
                configured={vercelReady}
                hasFiles={files.length > 0}
                fileCount={files.length}
                onDeployed={reloadFiles}
              />
            </TabsContent>

            {/* The timeline. A restore rewrites project_files, so the file list
                and the preview both have to re-read — `reloadFiles` is the same
                callback a build write triggers, which is the point: a rollback is
                a file change like any other, not a special UI-only state. */}
            <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-3">
              <CheckpointTimeline
                projectId={project.id}
                onRestored={() => {
                  reloadFiles();
                  setRestoreTick((n) => n + 1);
                }}
              />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}

