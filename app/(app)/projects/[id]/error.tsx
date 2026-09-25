"use client";

import { ErrorState } from "@/components/states/error-state";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 items-center px-4 py-16">
      <div className="w-full">
        <ErrorState
          title="This project could not open"
          message={
            error.message ||
            "We could not read the project. Your work was not changed."
          }
          action={reset}
          actionLabel="Try again"
        />
      </div>
    </div>
  );
}
