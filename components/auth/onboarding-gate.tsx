"use client";

import * as React from "react";
import { Check, Code2, Sparkles } from "lucide-react";

import { completeOnboarding } from "@/lib/actions/profile";

/**
 * The one question that matters (Section 2).
 *
 * Exactly one, and it is a real decision rather than a preference: it sets the
 * account's default lens. Deliberately not a wizard — a five-step tour before
 * someone has built anything is the fastest way to lose them, so the question
 * is asked once, on a surface with one action, and never asked again.
 *
 * Both options are honest. "Simple" is not the lesser one; it is the same
 * product with a plainer vocabulary, and the footer says so, because a user
 * who picks wrong here must know it is one click to change.
 */
export function OnboardingGate({ displayName }: { displayName: string | null }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const answer = React.useCallback(
    async (viewMode: "simple" | "developer") => {
      setPending(true);
      setError(null);
      const form = new FormData();
      form.set("view_mode", viewMode);

      const result = await completeOnboarding(form);
      // A successful answer redirects server-side, so reaching here means the
      // write failed. Say so plainly instead of leaving a spinner forever.
      if (result?.error) {
        setError(result.error);
        setPending(false);
      }
    },
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <p className="text-sm text-muted-foreground">Welcome to Architect 2.0</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {displayName ? `Do you write code, ${displayName}?` : "Do you write code?"}
      </h1>
      <p className="mt-2 text-balance text-muted-foreground">
        This sets how much of the work we show you. You can switch it any time
        from the top bar — nothing is locked away.
      </p>

      <div
        className="mt-8 grid gap-3 sm:grid-cols-2"
        role="group"
        aria-label="Do you write code?"
      >
        <Choice
          busy={pending}
          onChoose={() => answer("simple")}
          icon={<Sparkles aria-hidden className="size-4" />}
          title="Not really"
          blurb="Plain language, live previews and a visual agent team. Code is there when you want it."
        />
        <Choice
          busy={pending}
          onChoose={() => answer("developer")}
          icon={<Code2 aria-hidden className="size-4" />}
          title="Yes, I do"
          blurb="Same build, plus the orchestration graph, per-agent models, file diffs, commits and env vars."
        />
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        Both options build the same apps with the same agents. The toggle changes
        how much is explained, not what exists.
      </p>
    </div>
  );
}

function Choice({
  title,
  blurb,
  icon,
  onChoose,
  busy,
}: {
  title: string;
  blurb: string;
  icon: React.ReactNode;
  onChoose: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={busy}
      aria-label={`${title} - ${blurb}`}
      className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-volt/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="text-volt">{busy ? null : icon}</span>
        {busy ? <span className="text-muted-foreground">Saving…</span> : title}
        {!busy ? <Check aria-hidden className="size-3.5 text-transparent group-hover:text-volt" /> : null}
      </span>
      <span className="text-sm leading-relaxed text-muted-foreground">{blurb}</span>
    </button>
  );
}