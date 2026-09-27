import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { GoogleMark } from "@/components/auth/google-mark";

/**
 * The centred auth layout.
 *
 * Two columns on desktop because the auth screen has a job beyond a form: it
 * is the first place a visitor meets the two-audience thesis, so the right
 * column states plainly what they are signing up for. On mobile it collapses
 * to the form alone, with the same pitch as the page's single sentence.
 */
export default function AuthLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,44rem)]">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium tracking-tight"
          >
            <span
              className="size-2 animate-live-pulse rounded-full bg-volt"
              aria-hidden
            />
            Architect 2.0
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <SiteFooter className="-mx-6 border-t-0 sm:-mx-10" />
      </div>

      {/* Pitch side */}
      <aside className="relative hidden overflow-hidden border-l border-border bg-muted/30 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-volt-muted opacity-60 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-2">
          <GoogleMark className="size-5" />
          <p className="text-sm text-muted-foreground">
            Joining the workspace where both audiences build.
          </p>
        </div>

        <div className="relative flex flex-col gap-8">
          <h2 className="max-w-md font-heading text-3xl font-medium tracking-tight text-balance">
            Describe it in a sentence, or point us at your repo.
          </h2>
          <div className="grid max-w-md gap-6">
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">If you do not write code</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Say what you want to build. Watch the screens appear, and undo
                any change you do not like.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">If you do</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Import a repository, choose the model each agent runs on, read
                the code before it lands, and push it yourself.
              </p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-muted-foreground">
          Auth and your projects are real. Everything the agents do in this
          assignment is simulated.
        </p>
      </aside>
    </div>
  );
}
