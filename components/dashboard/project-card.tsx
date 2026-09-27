"use client";

/**
 * One project on the dashboard.
 *
 * A card, not a table row: the dashboard is for a person deciding "where do I
 * pick up?", and a table makes every project the same shape. The card leads with
 * the project's *status* (what is happening to it) and its *origin* (how it got
 * here), because those are the two things that change what the user should do
 * next.
 *
 * The lens decides what the card says about itself, which is the brief's
 * requirement rather than a nicety:
 *
 *   Simple     "Built from a description" and the sentence that started it.
 *              Enough to recognise the project and nothing to decode.
 *   Developer  the repository and branch, the framework, the file count, and the
 *              id. The things a developer uses to tell two projects apart
 *              without opening either.
 *
 * Both are rendered from the same row. The lens changes the density and the
 * vocabulary, never the facts - a Simple card must not become vaguer than the
 * truth, and a Developer card must not show anything we do not actually know.
 */

import { GitBranch, GitCommitHorizontal, Files } from "lucide-react";
import Link from "next/link";

import { GitHubMark } from "@/components/states/github-mark";
import { StatusPill } from "@/components/states/status-pill";
import { Card } from "@/components/ui/card";
import type { Project, ProjectStatus } from "@/lib/supabase/types";
import type { RunState } from "@/lib/types/domain";
import { relativeTime } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

export interface ProjectCardData extends Project {
  /** Real file count, read alongside the row so the Developer card is honest. */
  fileCount?: number;
}

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const { isDeveloper } = useViewMode();

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
            {isDeveloper && project.description
              ? project.description
              : (project.description ??
                project.prompt ??
                "No description yet.")}
          </p>

          {isDeveloper ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2.5 text-micro">
              <Fact icon={GitCommitHorizontal} label="id" value={project.id.slice(0, 8)} />
              {project.framework ? (
                <Fact icon={Files} label="stack" value={project.framework} />
              ) : null}
              {typeof project.fileCount === "number" ? (
                <Fact
                  icon={Files}
                  label="files"
                  value={String(project.fileCount)}
                />
              ) : null}
              {project.repo_branch ? (
                <Fact icon={GitBranch} label="branch" value={project.repo_branch} />
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className="mt-auto flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {project.origin === "import" ? (
            <>
              <GitHubMark className="size-3 shrink-0" />
              {isDeveloper ? (
                <span className="truncate font-mono text-micro">
                  {project.repo_full_name}
                  {project.repo_branch ? `@${project.repo_branch}` : ""}
                </span>
              ) : (
                <span className="truncate">From a repository</span>
              )}
            </>
          ) : isDeveloper ? (
            <span className="truncate font-mono text-micro">
              {project.framework ?? "from a description"}
            </span>
          ) : (
            <span className="truncate">Built from a description</span>
          )}

          {/* The file count, in both lenses. */}
          {typeof project.fileCount === "number" && project.fileCount > 0 ? (
            <span
              className="shrink-0 font-mono text-micro"
              title={`${project.fileCount} files in the workspace`}
            >
              {project.fileCount} files
            </span>
          ) : null}

          <span className="ml-auto shrink-0">
            {relativeTime(project.last_opened_at ?? project.updated_at)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

/** One label/value pair. Mono, because these are identifiers not prose. */
function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GitBranch;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-foreground">{value}</dd>
    </div>
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
