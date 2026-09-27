"use client";

/**
 * The repository picker — the Developer-mode entry point.
 *
 * Replaces a hardcoded list of four repositories. Selecting a repo runs the
 * **real** static analysis against GitHub and shows the result before anything
 * is created, which is the flow the brief describes: pick a repo and a branch,
 * and the Researcher/Planner map the codebase before any generation happens.
 *
 * Three states, all of which are real: not configured, connected but with an
 * empty list, and connected with repositories. The previous version had none of
 * them, because the list was a constant.
 */

import * as React from "react";

import { GitHubMark } from "@/components/states/github-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importRepository, type ImportState } from "@/lib/actions/github";
import { relativeTime } from "@/lib/utils";

interface Repo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  stars: number;
}

export function RepoPicker({
  id,
  configured,
  connectedAs,
  redirectHint,
}: {
  /** Deep-link target, so `#import-repo` scrolls here and selects this door. */
  id?: string;
  configured: boolean;
  /** The signed-in GitHub login, or null when not connected. */
  connectedAs: string | null;
  /**
   * The exact callback URL this app will send GitHub, when it is one the OAuth
   * app is unlikely to have registered. Null when it should match.
   */
  redirectHint?: string | null;
}) {
  const [state, formAction] = React.useActionState<ImportState, FormData>(
    importRepository,
    { error: null, preview: null },
  );

  const [repos, setRepos] = React.useState<Repo[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Repo | null>(null);

  // Fetched from the client rather than rendered server-side so the OAuth token
  // is never part of a page payload, and so a reconnect needs no full render.
  React.useEffect(() => {
    if (!connectedAs) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setListError(null);
      const response = await fetch("/api/github/repos", {
        cache: "no-store",
      }).catch(() => null);

      if (cancelled) return;
      setLoading(false);

      if (!response) {
        setListError("We could not reach the server.");
        return;
      }
      const data = (await response.json()) as { repos?: Repo[]; error?: string };
      if (data.error) {
        setListError(data.error);
        return;
      }
      setRepos(data.repos ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [connectedAs]);

  if (!configured) {
    return (
      <Panel id={id}>
        <p className="text-sm font-medium">GitHub is not set up</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Importing a repository needs an OAuth app. Create one at GitHub, then set{" "}
          <code className="font-mono text-xs">GITHUB_CLIENT_ID</code> and{" "}
          <code className="font-mono text-xs">GITHUB_CLIENT_SECRET</code> in{" "}
          <code className="font-mono text-xs">.env.local</code>.
        </p>
      </Panel>
    );
  }

  if (!connectedAs) {
    return (
      <Panel id={id}>
        <p className="text-sm font-medium">Connect your GitHub</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Architect reads your repositories so the agents can work inside an
          existing codebase instead of starting from scratch. Your token is stored
          on the server and never sent to the browser.
        </p>

        {/*
          Shown *before* the connect button, not after the failure.

          GitHub matches the callback URL character for character. Browsing at a LAN
          address while the OAuth app was registered with localhost therefore
          produces "The redirect_uri is not associated with this application" - a
          GitHub error page that gives no hint the fix is one field in their app
          settings. Saying the exact URL up front turns a dead end into a
          thirty-second fix.
        */}
        {redirectHint ? (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs leading-relaxed text-foreground">
            {redirectHint}
          </p>
        ) : null}

        <Button asChild className="mt-4 self-start">
          <a href="/api/github/connect">
            <GitHubMark className="size-4" />
            Connect GitHub
          </a>
        </Button>
      </Panel>
    );
  }

  const filtered = (repos ?? []).filter((repo) => {
    if (!query.trim()) return true;
    const needle = query.toLowerCase();
    return (
      repo.name.toLowerCase().includes(needle) ||
      (repo.description ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <Panel id={id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-medium">
          Connected as <span className="font-mono">@{connectedAs}</span>
        </p>
        <a
          href="/api/github/connect"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Reconnect
        </a>
      </div>

      {listError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {listError}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Loading your repositories…
        </p>
      ) : repos && repos.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          No repositories found on this account. Architect only imports repositories
          you own or collaborate on — check the connection picked the right GitHub
          account.
        </p>
      ) : repos ? (
        <>
          <div className="mt-3 flex flex-col gap-2">
            <Label htmlFor="repo-search" className="text-xs text-muted-foreground">
              Search {repos.length} repositories
            </Label>
            <Input
              id="repo-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name or description"
            />
          </div>

          <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
            {filtered.slice(0, 40).map((repo) => (
              <li key={repo.id}>
                <button
                  type="button"
                  onClick={() => setSelected(repo)}
                  className="flex w-full flex-col gap-0.5 rounded-md border border-border p-2.5 text-left transition-colors hover:border-volt/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{repo.name}</span>
                    {repo.private ? (
                      <span className="text-micro text-muted-foreground">private</span>
                    ) : null}
                    {repo.language ? (
                      <span className="text-micro text-muted-foreground">
                        {repo.language}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-micro text-muted-foreground">
                      {relativeTime(repo.updatedAt)}
                    </span>
                  </span>
                  {repo.description ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {repo.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">
                Nothing matches “{query}”.
              </li>
            ) : null}
          </ul>
        </>
      ) : null}

      {selected ? (
        <form
          action={formAction}
          className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
        >
          <input type="hidden" name="repo" value={selected.fullName} />
          <input type="hidden" name="branch" value={selected.defaultBranch} />

          <p className="text-sm leading-relaxed">
            Import <span className="font-medium">{selected.fullName}</span> from{" "}
            <code className="font-mono text-xs">{selected.defaultBranch}</code>? The
            team will read the code and tell you what it does before changing
            anything.
          </p>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          {state.preview ? (
            <div className="rounded-md border border-volt/40 bg-volt/5 p-3">
              <p className="text-sm font-medium">{state.preview.framework}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {state.preview.summary}
              </p>
              {state.preview.warnings.map((warning) => (
                <p key={warning} className="mt-1 text-xs text-warning">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Import and read the code
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

/**
 * The repo picker's frame.
 *
 * Takes an `id` because all three of its states have to be the deep-link target:
 * the unconfigured notice, the connect prompt and the repository list are three
 * different elements, and `#import-repo` has to land on whichever is showing.
 */
function Panel({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-col rounded-lg border border-border p-4">
      {children}
    </div>
  );
}

