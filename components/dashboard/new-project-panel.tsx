"use client";

import { FolderGit2, Sparkles } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { GitHubMark } from "@/components/states/github-mark";
import { SimulatedBadge } from "@/components/states/simulated-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type ProjectActionState,
  createProject,
} from "@/lib/actions/projects";
import { GITHUB_REPOS } from "@/lib/mock/github";
import { cn } from "@/lib/utils";

/**
 * "New project" — the two doors into the same product.
 *
 * Product thinking behind this screen: the audience decides which door is
 * *first*, not which features exist. A non-technical builder's first tab is the
 * prompt; a developer's first tab is the repository. Behind the tabs the flow
 * is identical — one `projects` row, `origin` differs — because a project that
 * started from a description and a project imported from a repo converge on the
 * same builder the moment they exist. That convergence is the 2.0 thesis made
 * concrete, and it is why this is one tabbed panel rather than two pages.
 */
export function NewProjectPanel({
  mode: initialMode,
}: {
  /** Pre-selected tab, so the dashboard can deep-link into one door. */
  mode?: "prompt" | "import";
}) {
  const [mode, setMode] = React.useState(initialMode ?? "prompt");
  const [state, formAction] = React.useActionState<ProjectActionState, FormData>(
    createProject,
    { error: null, notice: null },
  );
  const [repo, setRepo] = React.useState(GITHUB_REPOS[0].fullName);

  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-3 sm:grid-cols-2"
        role="tablist"
        aria-label="How to start"
      >
        <Door
          active={mode === "prompt"}
          icon={Sparkles}
          title="Describe it"
          body="Best if you have never written code. Say what you want and watch it get built."
          onSelect={() => setMode("prompt")}
        />
        <Door
          active={mode === "import"}
          icon={FolderGit2}
          title="Bring a repository"
          body="Best if you already have code. We read it first, then work inside it."
          onSelect={() => setMode("import")}
        />
      </div>

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="origin" value={mode} />
        {mode === "import" ? (
          <input type="hidden" name="repo" value={repo} />
        ) : null}

        {mode === "prompt" ? <PromptField /> : <RepoField repo={repo} onPick={setRepo} />}

        {state.error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        <CreateButton mode={mode} />
      </form>
    </div>
  );
}


/* ------------------------------------------------------------------ pieces */

function PromptField() {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="prompt">What should it do?</Label>
      <Textarea
        id="prompt"
        name="prompt"
        required
        minLength={8}
        rows={4}
        placeholder="A booking app for my clinic where patients pick a day and time, and I get an email for each appointment."
        className="min-h-28 resize-none"
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        One or two sentences is plenty. You can change your mind later — every
        build is a checkpoint you can go back to.
      </p>
    </div>
  );
}

function RepoField({
  repo,
  onPick,
}: {
  repo: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label>Repository</Label>
      <div className="flex flex-col gap-2">
        {GITHUB_REPOS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.fullName)}
            aria-pressed={repo === item.fullName}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              repo === item.fullName
                ? "border-foreground/20 bg-muted/50"
                : "border-border hover:bg-muted/30",
            )}
          >
            <GitHubMark className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs">{item.fullName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {item.description}
              </span>
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {item.language}
            </span>
          </button>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SimulatedBadge className="h-4" />
        <span>
          The repository list is scripted. Connecting GitHub for real is in the
          GitHub screen.
        </span>
      </p>
    </div>
  );
}

function Door({
  active,
  icon: Icon,
  title,
  body,
  onSelect,
}: {
  active: boolean;
  icon: typeof Sparkles;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors",
        // Volt marks the current selection — the same meaning it has everywhere.
        active
          ? "border-volt/60 bg-volt-muted/40"
          : "border-border hover:bg-muted/30",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className={cn("size-4", active && "text-volt-ink")} />
        {title}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {body}
      </span>
    </button>
  );
}

function CreateButton({ mode }: { mode: "prompt" | "import" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="self-start">
      {pending
        ? "Working…"
        : mode === "prompt"
          ? "Start building"
          : "Import and read it"}
    </Button>
  );
}
