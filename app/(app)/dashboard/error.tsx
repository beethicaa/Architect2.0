"use client";

import { ErrorState } from "@/components/states/error-state";

/**
 * Route-level error boundary. `reset()` re-runs the Server Component, which is
 * the one fix worth offering: the failure is in reading Postgres, and asking
 * the person to refresh manually hides that the retry already happened.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-16 sm:px-6">
      <div className="w-full">
        <ErrorState
          title="The dashboard could not load"
          message={
            error.message ||
            "Something interrupted the request. Nothing was changed — try again."
          }
          action={reset}
          actionLabel="Try again"
        />
        {error.digest ? (
          <p className="mt-4 text-center font-mono text-xs text-muted-foreground">
            reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
