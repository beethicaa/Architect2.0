import { CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * TEMPORARY — scaffold status page.
 *
 * This is not a product screen. It exists so that `npm run dev` shows something
 * honest and useful after the scaffold commit, and so the design tokens and
 * shadcn primitives can be eyeballed in one place. Screen #1 (the landing page)
 * replaces this file.
 */

const verified: string[] = [
  "Next.js 16 App Router · TypeScript (strict) · Tailwind CSS v4",
  "shadcn/ui primitives installed; tokens themed in app/globals.css",
  "Supabase wired for SSR — browser + server clients, cookie session refresh in proxy.ts",
  "Postgres schema with row-level security in supabase/migrations",
  "Light + dark themes, motion tokens, and one accent colour that means something",
];

/** The five states every agent/deploy surface in the product will use. */
const statusVocabulary = [
  { label: "queued", dot: "bg-info" },
  { label: "working", dot: "bg-volt animate-live-pulse" },
  { label: "done", dot: "bg-success" },
  { label: "needs you", dot: "bg-warning" },
  { label: "failed", dot: "bg-destructive" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span
            className="size-2 animate-live-pulse rounded-full bg-volt"
            aria-hidden
          />
          <span className="font-heading text-sm font-medium tracking-tight">
            Architect 2.0
          </span>
        </div>

        <Badge variant="outline" className="w-fit">
          Scaffold complete · screens next
        </Badge>

        <h1 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
          The foundation is in place.
        </h1>

        <p className="max-w-prose leading-relaxed text-muted-foreground">
          Describe an app in plain language and watch a team of agents build it —
          or import a repository and keep shipping with agents you can inspect,
          configure and deploy. No product screens exist yet: the landing page is
          screen #1.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Verified in this scaffold</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {verified.map((item) => (
            <div key={item} className="flex items-start gap-3">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-volt-ink" />
              <span className="text-muted-foreground">{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-sm font-medium">
          Status vocabulary
        </h2>
        <Separator />
        <div className="flex flex-wrap gap-2">
          {statusVocabulary.map((status) => (
            <Badge key={status.label} variant="secondary" className="gap-1.5">
              <span
                className={`size-1.5 rounded-full ${status.dot}`}
                aria-hidden
              />
              {status.label}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          One accent, used only where something is alive. The rest of the
          interface stays neutral so the accent keeps its meaning.
        </p>
      </section>

      <footer className="mt-auto border-t pt-6 text-xs text-muted-foreground">
        <p>
          Auth and project persistence are real (Supabase); everything downstream
          of &ldquo;an agent does something&rdquo; is a mocked flow. The exact
          split is documented in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
            docs/real-vs-dummy.md
          </code>
          , and the product thinking in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">
            docs/product-vision.md
          </code>
          .
        </p>
      </footer>
    </main>
  );
}
