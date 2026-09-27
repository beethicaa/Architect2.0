"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { type ProfileActionState, deleteAccount } from "@/lib/actions/profile";

/**
 * Deleting an account, for real.
 *
 * This is the one destructive action in the product, so it is behind a typed
 * confirmation rather than a single click: the user has to type the word that
 * names what they are losing. A "Delete" button that fires immediately is how
 * products lose people's projects and their trust at the same time.
 *
 * The action itself is honest. It deletes the `auth.users` row, not just the
 * profile, and it refuses with the exact missing key rather than reporting a
 * success that did not happen - see `deleteAccount` in lib/actions/profile.ts.
 */
export function DeleteAccount({ accountLabel }: { accountLabel: string }) {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Typing a new confirmation must clear the previous failure, otherwise a
  // second attempt shows a stale error while it is in flight.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      const result: ProfileActionState = await deleteAccount();
      // Success redirects server-side, so arriving here means it failed.
      if (result?.error) setError(result.error);
    } catch {
      setError("We could not reach your account. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete account</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{accountLabel}</span>,
              every project in it, and the generated code and history. There is no
              undo, and we cannot recover it for you. If you only want a break,
              signing out keeps everything exactly where it is.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium">
              Type <span className="font-mono text-destructive">delete</span> to confirm
            </label>
            <input
              id="delete-confirm"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              disabled={pending}
              aria-describedby={error ? "delete-confirm-error" : undefined}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-volt focus-visible:ring-2 focus-visible:ring-volt/20 disabled:opacity-60"
            />
          </div>

          {error ? (
            <p
              id="delete-confirm-error"
              role="alert"
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog open while the action runs, and do not let the
                // dialog's own close handler mask a failure.
                event.preventDefault();
                void confirm();
              }}
              disabled={typed.trim().toLowerCase() !== "delete" || pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}