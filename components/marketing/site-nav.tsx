import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

/**
 * Marketing nav.
 *
 * Deliberately *not* the app chrome: no lens toggle, no project switcher. The
 * visitor has no project yet, and showing workspace controls to someone who
 * cannot use them yet is how marketing pages end up looking like broken apps.
 * The logo, theme switch and the two actions are the whole navigation.
 */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/?home=1" className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <span
            className="size-2 animate-live-pulse rounded-full bg-volt"
            aria-hidden
          />
          Architect 2.0
        </Link>

        <div className="ml-4 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <a href="#audiences" className="transition-colors hover:text-foreground">
            Who it&apos;s for
          </a>
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#team" className="transition-colors hover:text-foreground">
            The agent team
          </a>
          <a href="#history" className="transition-colors hover:text-foreground">
            Time Machine
          </a>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Start building</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
