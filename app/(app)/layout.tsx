import Link from "next/link";
import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { ViewModeToggle } from "@/components/layout/view-mode";
import { Separator } from "@/components/ui/separator";
import { isSupabaseConfigured } from "@/lib/env";
import { getProfile } from "@/lib/projects";
import { getClaims } from "@/lib/supabase/server";
import type { ViewMode } from "@/lib/types/domain";
import { SiteFooter } from "@/components/layout/site-footer";
import { ViewModeProvider } from "@/lib/view-mode";

/**
 * The app chrome — shared by every authenticated route.
 *
 * Consistency decisions made once, here, so no screen has to repeat them:
 *  - a fixed 56px top bar with the product mark, the lens toggle, the theme
 *    switch and the account menu, always in that order;
 *  - one content column: `max-w-6xl` with the same padding at every breakpoint,
 *    except the builder, which opts out to fill the viewport;
 *  - the lens provider lives here, so the toggle works on every page and the
 *    choice survives navigation.
 *
 * Route protection is here (not in `proxy.ts`): if Supabase is configured and
 * there is no session, the user is sent to sign-in. When it is *not*
 * configured, the app still renders — the mocked flows must remain reviewable
 * without credentials.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const configured = isSupabaseConfigured;
  const claims = configured ? await getClaims() : null;

  if (configured && !claims) redirect("/sign-in");

  const profile = configured ? await getProfile() : null;

  // The lens is a per-account preference, so the account's saved value is the
  // server snapshot. This is what makes the toggle survive a new device rather
  // than being tab state that happens to have a cookie next to it.
  //
  // `view_mode` is a text column constrained to 'simple' | 'developer' by
  // migration 0003, but the narrowing below is deliberate rather than a cast:
  // an unexpected value (a hand-edited row, an older schema) should fall back
  // to the product default, never leak arbitrary text into the provider.
  const accountMode: ViewMode | undefined =
    profile?.view_mode === "developer" ? "developer" : profile?.view_mode === "simple" ? "simple" : undefined;

  // One question, once. Gated in the layout rather than per-page so no screen
  // can be reached before the answer — and skipped entirely without an account,
  // because the mocked flows have to stay reviewable with no credentials.
  const needsOnboarding = Boolean(profile) && !profile?.onboarding_completed;

  return (
    <ViewModeProvider defaultMode={accountMode} persist={configured && Boolean(profile)}>
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
        {/*
          `shrink-0` on both, and no `sticky` on the header.

          In a fixed-height flex column the footer is only guaranteed to sit at the
          bottom of the viewport if it cannot be compressed, and the flex algorithm
          will shrink an un-marked sibling to make room. `sticky` on the header was
          doing nothing at all: it needs a scrolling ancestor, and the shell is
          `overflow-hidden` by design, so it was cargo cult from a version that let
          the page scroll.
        */}
        <header className="z-40 shrink-0 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[110rem] items-center gap-3 px-4 sm:px-6">
            {/*
              The wordmark goes to the landing page, on every screen.
              It pointed at `/dashboard`, so the logo behaved differently
              inside the product than outside it - and there is already a
              "Projects" item in the nav for the place it was sending you.
            */}
            <Link
              href="/?home=1"
              className="flex items-center gap-2 text-sm font-medium tracking-tight"
            >
              <span
                className="size-2 animate-live-pulse rounded-full bg-volt"
                aria-hidden
              />
              <span className="hidden sm:inline">Architect 2.0</span>
            </Link>

            <Separator
              orientation="vertical"
              className="mr-1 hidden h-5 sm:block"
            />

            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/dashboard"
                className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Projects
              </Link>
            </nav>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <ViewModeToggle size="sm" />
              <ThemeToggle />
              <UserMenu profile={profile} email={claims?.email ?? null} />
            </div>
          </div>
        </header>

        {!configured ? <UnconfiguredNotice /> : null}

        {/* `WorkspaceShell` decides whether this area scrolls, from the route.
            The reason it is not a single global rule: the builder must not scroll
            (its panels do), while the dashboard and settings must (their content
            is taller than the viewport). Setting one rule broke whichever screen
            it was not written for.

            The onboarding gate is passed through the same container so it inherits
            the same rule rather than escaping it. */}
        <WorkspaceShell>
          {needsOnboarding ? (
            <OnboardingGate
              displayName={profile?.display_name ?? profile?.full_name ?? null}
            />
          ) : (
            children
          )}
        </WorkspaceShell>

        {/* The same footer as every other screen.
            It sits outside the scrolling `main` and the shell is `h-dvh` with
            `main` as `flex-1 min-h-0`, so the builder shrinks to fit rather than
            pushing the footer off-screen - which is what a footer inside `main`
            would have done. */}
        <SiteFooter />
      </div>
    </ViewModeProvider>
  );
}

/**
 * Shown on every app screen when Supabase credentials are missing.
 *
 * This is the honest middle path between "the dashboard is broken" and "faking
 * a logged-in user": the rest of the interface works, and the one real slice
 * says plainly that it needs configuration.
 */
function UnconfiguredNotice() {
  return (
    <div className="border-b border-warning/30 bg-warning/5 px-4 py-2.5 sm:px-6">
      <p className="mx-auto max-w-[110rem] text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">
          Running without Supabase.
        </span>{" "}
        Projects, the agent graph, previews and deploys are all simulated. Add
        your keys to <code className="font-mono">.env.local</code> to make auth
        and project persistence real.
      </p>
    </div>
  );
}
