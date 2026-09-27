"use client";

import { ExternalLink } from "lucide-react";

import { GitHubMark } from "@/components/states/github-mark";
import { Button } from "@/components/ui/button";

/**
 * Connected accounts — GitHub.
 *
 * The brief puts "connected accounts" in the account menu, and this is that
 * surface. It reports the *real* configuration state rather than pretending an
 * account is connected: without `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
 * there is no OAuth app to send the user to, so the button says so and explains
 * the one thing that is missing, instead of opening a dead link.
 *
 * `isGitHubConfigured` is read on the server and passed in as a prop. Reading
 * `process.env` from a client component would always be `undefined` — only
 * `NEXT_PUBLIC_*` is inlined into the browser bundle — which is exactly the bug
 * that made the agent read as "key not set" no matter what was in `.env.local`.
 */
export function ConnectedAccounts({
  githubConfigured,
  githubHandle,
}: {
  githubConfigured: boolean;
  /** Present only once a real OAuth exchange has stored a token. */
  githubHandle?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-lg border border-border p-4">
        <span className="mt-0.5 shrink-0 text-foreground">
          <GitHubMark className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">GitHub</span>
          {githubHandle ? (
            <span className="truncate text-sm text-muted-foreground">
              Connected as{" "}
              <span className="font-medium text-foreground">{githubHandle}</span>
            </span>
          ) : (
            <span className="text-sm leading-relaxed text-muted-foreground">
              {githubConfigured
                ? "Not connected yet. Connect to import a repository, push agent commits, and see repo state in Developer view."
                : "Needs two keys in .env.local — GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET — before it can connect."}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!githubConfigured}
          aria-label={
            githubConfigured
              ? "Connect GitHub"
              : "GitHub is not configured — add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env.local"
          }
        >
          {githubHandle ? "Manage" : "Connect"}
          <ExternalLink aria-hidden data-icon="inline-end" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Connecting is optional. Projects built from a description work without it;
        GitHub is what lets agents work inside an existing repository and push
        their changes back.
      </p>
    </div>
  );
}
