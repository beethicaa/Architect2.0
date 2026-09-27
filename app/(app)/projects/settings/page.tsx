import { ConnectedAccounts } from "@/components/settings/connected-accounts";
import { LensChoice } from "@/components/settings/lens-choice";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/states/page-header";
import { Check, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isGitHubConfigured, isGroqConfigured } from "@/lib/env";
import { requireGitHubAccount } from "@/lib/github/store";
import { getProfile } from "@/lib/projects";

/**
 * What each `?github=` outcome means, in one sentence.
 *
 * The keys are the values the callback route actually sends - read from
 * `app/api/github/callback/route.ts`, not invented. My first pass used plausible
 * names ("failed", "unauthenticated") that the route never sends, so three of the
 * four real outcomes fell through to "no message" and the screen looked broken
 * again. Keying this off the route is the only thing that keeps the two in step.
 *
 * "cancelled" is deliberately not styled as an error: pressing Cancel on GitHub's
 * consent screen is a decision, not a failure, and calling it a problem is how
 * you train someone to ignore error messages.
 */
const GITHUB_OUTCOMES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  connected: {
    tone: "ok",
    text: "GitHub is connected. You can now import a repository.",
  },
  cancelled: {
    tone: "warn",
    text: "You cancelled before connecting, so nothing changed. Your projects are unaffected.",
  },
  invalid: {
    tone: "warn",
    text: "GitHub did not send an authorisation code back, so nothing was connected.",
  },
  state: {
    tone: "warn",
    text: "That connect attempt did not match the one we started, so we ignored it. Try again.",
  },
  exchange: {
    tone: "warn",
    text: "GitHub would not hand over access, so nothing was connected. Try again.",
  },
  profile: {
    tone: "warn",
    text: "Access was granted but GitHub would not say who you are, so we connected nothing.",
  },
  save: {
    tone: "warn",
    text: "We could not store the connection. Nothing was saved — try again in a moment.",
  },
};

export const metadata = { title: "Workspace settings" };

/**
 * Workspace settings — the second destination the account menu already linked to.
 *
 * Two decisions worth stating, because both are product calls rather than
 * implementation details:
 *
 * 1. **The lens lives here as a written-out choice, not just the top-bar
 *    switch.** The brief calls it a soft default rather than an account type, so
 *    the copy has to make clear that picking either one locks nothing in. A
 *    switch cannot say that; a sentence can.
 *
 * 2. **The URL is `/projects/settings` because that is where the account menu
 *    already pointed.** Renaming it would have meant editing the menu, and the
 *    ground rules for this build are explicit: the shell is final. Worth flagging
 *    that this path reads oddly for a workspace-level page — project-scoped
 *    settings (models, environment variables, team) belong at
 *    `/projects/[id]/settings`, and that is where Section 10 goes. If the menu is
 *    ever opened up for revision, this should become `/settings`.
 */
export default async function WorkspaceSettingsPage({
  searchParams,
}: PageProps<"/projects/settings">) {
  const params = await searchParams;
  const profile = await getProfile();
  const currentLens = profile?.view_mode === "developer" ? "Developer" : "Simple";

  // Read server-side rather than from the client hook, because this screen
  // renders on the server. Same rule as the dashboard.
  const isDeveloper = profile?.view_mode === "developer";

  // The account actually connected, read here rather than assumed. Without it
  // this screen showed "Connect GitHub" immediately after a successful connect,
  // which is the same as showing a failure.
  const githubHandle = isGitHubConfigured
    ? (await requireGitHubAccount())?.login ?? null
    : null;

  /*
    The GitHub callback redirects back here with `?github=<outcome>`, and until
    now nothing read it. Every result - connected, cancelled, invalid - looked
    identical, so a successful connect looked exactly like a failed one and the
    user was told nothing. The outcome is named, not described as a failure.
  */
  const githubOutcome = typeof params.github === "string" ? params.github : null;
  const githubNotice = GITHUB_OUTCOMES[githubOutcome ?? ""] ?? null;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Workspace settings"
        description="How Architect talks to you, and which accounts your projects can reach. Your projects themselves are configured from inside each project."
      />

      <PageSection title="How much you see">
        <Card>
          <CardHeader>
            <CardTitle>Default view</CardTitle>
            <CardDescription>
              Currently {currentLens}. The toggle in the top bar changes this
              instantly and saves it to your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LensChoice />
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Integrations">
        <Card>
          <CardHeader>
            <CardTitle>Connected accounts</CardTitle>
            <CardDescription>
              Optional, and per-workspace rather than per-person only — a teammate
              you invite needs their own connection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {githubNotice ? (
              <p
                role="status"
                className={
                  githubNotice.tone === "ok"
                    ? "mb-3 flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-2.5 text-sm text-foreground"
                    : "mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-sm text-foreground"
                }
              >
                {githubNotice.tone === "ok" ? (
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <TriangleAlert
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                )}
                {githubNotice.text}
              </p>
            ) : null}
            <ConnectedAccounts
              githubConfigured={isGitHubConfigured}
              githubHandle={githubHandle}
            />
          </CardContent>
        </Card>
      </PageSection>

      {/*
        The runtime card only exists in the Developer view.

        A non-technical user has no model to choose, no key to check and no use
        for `GROQ_API_KEY`. The brief is explicit that this audience must "never
        see code, diffs, commits, or model names unless they explicitly opt in" -
        so a disabled-looking row with a variable name in it is a violation, not a
        courtesy. Absent is the correct answer, not dimmed.
      */}
      {isDeveloper ? (
        <PageSection title="Build engine">
          <Card>
            <CardHeader>
              <CardTitle>Agent runtime</CardTitle>
              <CardDescription>
                Which model the specialist agents run on, and whether the key is
                actually present.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <StatusRow
                label="Groq"
                detail="Runs every agent in the pipeline — planner, researcher, data, interface, reviewer and shipper."
                ready={isGroqConfigured}
                missing="GROQ_API_KEY"
              />
              <StatusRow
                label="Preview compiler"
                detail="Bundles the generated code so you can click the real app while it is being built."
                ready
                missing=""
              />
            </CardContent>
          </Card>
        </PageSection>
      ) : null}
    </PageShell>
  );
}

/**
 * One row of "is this actually wired, or are you about to be disappointed".
 *
 * The product's credibility depends on saying this out loud rather than letting
 * someone discover it by clicking. Server-only env is read here and passed in,
 * because a client component cannot see it.
 */
function StatusRow({
  label,
  detail,
  ready,
  missing,
}: {
  label: string;
  detail: string;
  ready: boolean;
  missing: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-4">
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${ready ? "bg-success" : "bg-warning"}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium">
          {label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {ready ? "ready" : "not configured"}
          </span>
        </span>
        <span className="text-sm leading-relaxed text-muted-foreground">{detail}</span>
        {!ready && missing ? (
          <span className="text-xs text-muted-foreground">
            Add <code className="font-mono">{missing}</code> to{" "}
            <code className="font-mono">.env.local</code> and restart the dev
            server. We will not simulate a build without it.
          </span>
        ) : null}
      </div>
    </div>
  );
}
