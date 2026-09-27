import { ConnectedAccounts } from "@/components/settings/connected-accounts";
import { DeleteAccount } from "@/components/settings/delete-account";
import { DisplayNameForm } from "@/components/settings/display-name-form";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/states/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isGitHubConfigured, isSupabaseConfigured } from "@/lib/env";
import { getProfile } from "@/lib/projects";
import { getClaims } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

/**
 * /profile — the account surface the menu already linked to.
 *
 * Scope is deliberately narrow: who you are, and the one destructive thing you
 * can do to your account. Everything about how the product *works* (the lens,
 * connected accounts) lives on `/settings`, because mixing "what I am" with
 * "how this workspace behaves" is how settings pages become untrustworthy.
 *
 * Everything here is REAL. There is no mock branch: without Supabase
 * credentials the form is disabled and says why, rather than accepting input and
 * silently discarding it.
 */
export default async function ProfilePage() {
  const configured = isSupabaseConfigured;
  const claims = configured ? await getClaims() : null;
  const profile = configured ? await getProfile() : null;

  const email = profile?.email ?? claims?.email ?? null;
  const displayName = profile?.display_name ?? profile?.full_name ?? null;
  const accountLabel = email ?? displayName ?? "your account";
  const hasAccount = Boolean(claims && profile);

  // Read server-side, because this screen renders on the server. Same rule as
  // the dashboard and workspace settings.
  const isDeveloper = profile?.view_mode === "developer";

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Profile"
        description="Your name and sign-in details. Your projects are not affected by anything on this page."
      />

      <PageSection title="Your details">
        <Card>
          <CardHeader>
            <CardTitle>Name and email</CardTitle>
            <CardDescription>
              The name here is what appears in the account menu. The email is your
              sign-in identity and cannot be edited here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DisplayNameForm
              defaultName={displayName}
              email={email}
              disabled={!hasAccount}
              disabledReason={
                hasAccount
                  ? undefined
                  : "Add your Supabase keys to .env.local to edit this."
              }
            />
          </CardContent>
        </Card>
      </PageSection>

      {/*
        The connected-accounts card exists in both lenses, but it says something
        different in each.

        "Where your code lives" and "push their changes back" are developer
        sentences. For someone who describes apps in plain language, the same
        capability is "you can connect a code service so we can work inside
        something you already have" - same button, same real OAuth underneath,
        but framed as what it does for them rather than as infrastructure.

        Absent, not hidden: a connected account still changes what the product
        can do for them, so leaving it out would be misleading rather than simple.
      */}
      <PageSection title="Connected accounts">
        <Card>
          <CardHeader>
            <CardTitle>
              {isDeveloper ? "Where your code lives" : "Connect a code service"}
            </CardTitle>
            <CardDescription>
              {isDeveloper
                ? "Optional. Connecting GitHub is what lets agents work inside an existing repository and push their changes back."
                : "Optional. Connect one and the team can work inside code you already have, instead of building from scratch."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Configuration is read on the server and passed down. A client
                component cannot read `process.env.GITHUB_*` — only NEXT_PUBLIC_*
                is inlined into the browser bundle — so reading it here would
                always report "not configured" regardless of .env.local. */}
            <ConnectedAccounts githubConfigured={isGitHubConfigured} />
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Account">
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>
              Deleting is permanent and removes every project, including its
              generated code and history.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <DeleteAccount accountLabel={accountLabel} />
            <p className="text-xs text-muted-foreground">
              Just want to step away? Sign out instead — everything stays exactly
              where it is.
            </p>
          </CardContent>
        </Card>
      </PageSection>
    </PageShell>
  );
}
