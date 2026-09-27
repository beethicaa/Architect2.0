"use client";

import { FolderGit2, Sparkles } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { RepoPicker } from "@/components/github/repo-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ProjectActionState, createProject } from "@/lib/actions/projects";
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
 *
 * The repository door used to render four hardcoded repositories and carry a
 * "this list is scripted" badge. It now runs the real OAuth connect and the real
 * import, and the badge is gone because there is nothing left to disclaim.
 */
export function NewProjectPanel({
  mode: initialMode,
  githubConfigured,
  githubLogin,
  githubRedirectHint,
  primaryDoor,
}: {
  /** Pre-selected tab, so the dashboard can deep-link into one door. */
  mode?: "prompt" | "import";
  /** Resolved on the server; a client cannot read a server-only env var. */
  githubConfigured: boolean;
  githubLogin: string | null;
  /** The exact callback URL GitHub must have registered, or null when it will match. */
  githubRedirectHint: string | null;
  /**
   * Which door the account's lens puts first.
   *
   * This is the brief's requirement that the two audiences get different
   * experiences, not a preference: a developer's first move is pointing at the
   * repository they already have, and a non-technical user's is typing a
   * sentence. Order carries that, and the panel is read left to right.
   *
   * The other door is still offered, in the other position. Neither audience is
   * locked out of the other's path - that is the whole point of one product.
   */
  primaryDoor?: "prompt" | "import";
}) {
  /*
   * Deep links into a specific door.
   *
   * The dashboard's empty state links here with `#describe-it` or
   * `#import-repo`, so "Start from a description" lands on the description form
   * itself rather than on a card that may be showing the other door. The account
   * lens decides the default order, so whichever door is *not* first is exactly
   * the one someone is likely to have to jump to.
   *
   * Read once, as a lazy initialiser, rather than in an effect. An effect that
   * calls `setMode` would render the wrong door first and then correct itself,
   * which means a flash of the import form before switching to the description
   * form. There is also nothing to subscribe to: the fragment does not change
   * while this component is mounted, and reading it again would fight the
   * browser's own back/forward handling.
   */
  const [mode, setMode] = React.useState(() => {
    const hash =
      typeof window === "undefined" ? "" : window.location.hash.replace("#", "");
    if (hash === "describe-it") return "prompt" as const;
    if (hash === "import-repo") return "import" as const;
    return initialMode ?? primaryDoor ?? ("prompt" as const);
  });
  const [state, formAction] = React.useActionState<ProjectActionState, FormData>(
    createProject,
    { error: null, notice: null },
  );

  const promptDoor = (
    <Door
      key="prompt"
      active={mode === "prompt"}
      icon={Sparkles}
      title="Describe it"
      body="Best if you have never written code. Say what you want and watch it get built."
      onSelect={() => setMode("prompt")}
    />
  );

  const importDoor = (
    <Door
      key="import"
      active={mode === "import"}
      icon={FolderGit2}
      title="Bring a repository"
      body="Best if you already have code. We read it first, then work inside it."
      onSelect={() => setMode("import")}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div
        className="grid gap-3 sm:grid-cols-2"
        role="tablist"
        aria-label="How to start"
      >
        {primaryDoor === "import"
          ? [importDoor, promptDoor]
          : [promptDoor, importDoor]}
      </div>

      {mode === "prompt" ? (
        <form
          /* The deep-link target for "Start from a description", so the link
             scrolls here *and* selects this door. Without it the hash existed but
             pointed at a container that was not the form. */
          id="describe-it"
          action={formAction}
          className="flex scroll-mt-24 flex-col gap-5"
        >
          <input type="hidden" name="origin" value="prompt" />
          <PromptField />
          {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}
          <CreateButton label="Build it" />
        </form>
      ) : (
        <RepoPicker
          id="import-repo"
          configured={githubConfigured}
          connectedAs={githubLogin}
          redirectHint={githubRedirectHint}
        />
      )}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      {children}
    </p>
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

function CreateButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="self-start">
      {pending ? "Working…" : label}
    </Button>
  );
}
