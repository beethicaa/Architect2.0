import { FolderSearch } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Project not found" };

/**
 * A 404 inside the product, not a bare Next.js page: the one fix offered is
 * "go back to your projects", which is where the person was trying to get to.
 */
export default function ProjectNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <span
        className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/40"
        aria-hidden
      >
        <FolderSearch className="size-4 text-muted-foreground" />
      </span>
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="font-heading text-lg font-medium">No project here</h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-balance">
          It may have been deleted, or the link may be from a different account.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to your projects</Link>
      </Button>
    </div>
  );
}
