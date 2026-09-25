import Link from "next/link";

import { GitHubMark } from "@/components/states/github-mark";
import { StatusPill } from "@/components/states/status-pill";
import { Card } from "@/components/ui/card";
import type { Project, ProjectStatus } from "@/lib/supabase/types";
import type { RunState } from "@/lib/types/domain";
import { relativeTime } from "@/lib/utils";

/**
 * One project on the dashboard.
 *
 * A card, not a table row: the dashboard is for a person deciding "where do I
 * pick up?", and a table makes every project the same shape. The card leads with
 * the project's *status* (what is happening to it) and its *origin* (how it
 * got here), because those are the two things that change what the user should
 * do next.
 */
export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block focus-visible:outline-none"
    >
      <Card className="h-full gap-0 p-0 transition-colors group-hover:bg-muted/30 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-heading text-sm font-medium leading-snug">
              {project.name}
            </h3>
            <StatusPill state={STATUS_TO_STATE[project.status]} />
          </div>

          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {project.description ??
              project.prompt ??
              "No description yet."}
          </p>
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {project.origin === "import" ? (
            <>
              <GitHubMark className="size-3 shrink-0" />
              <span className="truncate font-mono text-micro">
                {project.repo_full_name}
              </span>
            </>
          ) : (
            <>
              <span className="truncate">
                {project.framework ?? "From a description"}
              </span>
            </>
          )}
          <span className="ml-auto shrink-0">
            {relativeTime(project.last_opened_at ?? project.updated_at)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

/**
 * The five agent/deploy states mapped onto the five project statuses the
 * database allows. A project row is REAL, so it speaks the same status language
 * as the mocked run beside it — that is what makes the two halves feel like one
 * product.
 */
const STATUS_TO_STATE: Record<ProjectStatus, RunState> = {
  draft: "queued",
  building: "working",
  ready: "done",
  deployed: "done",
  archived: "needs-you",
};
