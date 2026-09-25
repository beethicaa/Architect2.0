"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { GoogleMark } from "@/components/auth/google-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type AuthState,
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * The auth form — REAL Google + email/password via Supabase.
 *
 * Design notes:
 *  - `useActionState` (not a controlled form) so the server is the single
 *    authority on what is valid; the client never decides a password is good.
 *  - One inline alert, one `role="alert"`, one fix. Submitting again clears it
 *    because the state object is replaced wholesale by the action.
 *  - Google sits *above* the email field: it is the fastest path and the reason
 *    most people will ever use this form.
 *  - Confirm-password only appears on sign-up, so sign-in stays short.
 */
export function AuthForm({
  mode,
  title,
  subtitle,
  next,
  footerHref,
  footerPrompt,
  footerLabel,
}: {
  mode: "sign-in" | "sign-up";
  title: string;
  subtitle: string;
  next?: string;
  footerHref: string;
  footerPrompt: string;
  footerLabel: string;
}) {
  const action = mode === "sign-in" ? signInWithPassword : signUpWithPassword;
  const [state, formAction] = React.useActionState<AuthState, FormData>(action, {
    error: null,
    notice: null,
    redirectTo: "/dashboard",
  });

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-medium tracking-tight">
          {title}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      </header>

      <form action={signInWithGoogle} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <GoogleButton />
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span className="text-xs text-muted-foreground">or use email</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {mode === "sign-up" ? (
          <Field
            id="name"
            label="Your name"
            hint="Shown on anything you share with your team."
          >
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder="Beethica Rath"
            />
          </Field>
        ) : null}

        <Field id="email" label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </Field>

        <Field
          id="password"
          label="Password"
          hint={mode === "sign-up" ? "At least 8 characters." : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={mode === "sign-up" ? 8 : undefined}
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
          />
        </Field>

        {mode === "sign-up" ? (
          <Field id="confirmPassword" label="Confirm password">
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>
        ) : null}

        {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
        {state.notice ? (
          <FormAlert tone="success">{state.notice}</FormAlert>
        ) : null}

        <SubmitButton
          label={mode === "sign-in" ? "Sign in" : "Create account"}
        />
      </form>

      <p className="text-sm text-muted-foreground">
        {footerPrompt}{" "}
        <Link
          href={footerHref}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {footerLabel}
        </Link>
      </p>
    </div>
  );
}


/* ------------------------------------------------------------------ pieces */

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      disabled={pending}
      className="w-full"
    >
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <GoogleMark className="size-4" />
      )}
      Continue with Google
    </Button>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? "Just a moment" : label}
    </Button>
  );
}

/** One alert, one tone, one fix — mirrors components/states/error-state.tsx. */
function FormAlert({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-success/30 bg-success/5 text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
