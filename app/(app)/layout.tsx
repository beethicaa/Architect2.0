import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { ViewModeToggle } from "@/components/layout/view-mode";
import { Separator } from "@/components/ui/separator";
import { isSupabaseConfigured } from "@/lib/env";
import { getProfile } from "@/lib/projects";
import { getClaims } from "@/lib/supabase/server";
import { ViewModeProvider } from "@/lib/view-mode";
import { cn } from "@/lib/utils";

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

  return (
    <ViewModeProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[110rem] items-center gap-3 px-4 sm:px-6">
            <Link
              href="/dashboard"
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

        <main className={cn("flex flex-1 flex-col")}>{children}</main>
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
