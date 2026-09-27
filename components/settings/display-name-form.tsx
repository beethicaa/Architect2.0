"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ProfileActionState, saveDisplayName } from "@/lib/actions/profile";

/**
 * The identity form on /profile.
 *
 * `useActionState` rather than a controlled form, so the server stays the single
 * authority on what is valid - the client never decides a name is acceptable.
 *
 * The `key` on the form is deliberate. React 19 resets an uncontrolled form to
 * its default values once an action resolves, which would visibly clear the
 * field the user just saved. Keying on the saved name means the form remounts
 * with the *new* server value instead, so the input keeps what was typed.
 */
/**
 * `useActionState` hands the action the previous state as well as the payload,
 * while `saveDisplayName` is a plain form action. Rather than change the action's
 * signature — it is also used as a plain `<form action>` elsewhere, and the two
 * shapes are genuinely different — the adapter lives here, in the one component
 * that needs the stateful form.
 */
const submitName = (
  _previous: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> => saveDisplayName(formData);

export function DisplayNameForm({
  defaultName,
  email,
  disabled,
  disabledReason,
}: {
  defaultName: string | null;
  email: string | null;
  /** True when there is no account to write to. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction] = React.useActionState<ProfileActionState, FormData>(
    submitName,
    { error: null, notice: null },
  );

  return (
    <form key={defaultName ?? "unnamed"} action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="display_name">Name</Label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={defaultName ?? ""}
          placeholder="What should we call you?"
          autoComplete="name"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          This is the name shown in your account menu. Leave it empty to use your
          email address instead.
        </p>
      </div>

      {email ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="account_email">Email</Label>
          {/* Read-only on purpose: the address is the login identity, and
              changing it here without re-verifying ownership would be a lie.
              The honest control is "delete and sign up again", said below. */}
          <Input id="account_email" value={email} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Your sign-in address. To change it, delete the account and sign up
            again - we will not move projects to a new address without you
            confirming ownership of it.
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{state.notice}</span>
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SaveButton disabled={disabled} />
        {disabledReason ? (
          <span className="text-xs text-muted-foreground">{disabledReason}</span>
        ) : null}
      </div>
    </form>
  );
}

function SaveButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}