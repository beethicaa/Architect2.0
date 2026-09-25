"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one error state.
 *
 * Rule: an error state proposes exactly one fix. Not a stack, not "try again
 * later" — one action that either resolves it or explains the next step.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  /** The single recommended fix. Rendered as a button or a link. */
  action,
  actionLabel = "Try again",
  actionHref,
  className,
}: {
  title?: string;
  message: string;
  action?: () => void;
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        className="flex size-10 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10"
        aria-hidden
      >
        <CircleAlert className="size-4 text-destructive" />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className="font-heading text-base font-medium">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground text-balance">
          {message}
        </p>
      </div>
      {actionHref ? (
        <Button asChild variant="outline" size="lg">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : action ? (
        <Button onClick={action} variant="outline" size="lg">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
