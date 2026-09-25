"use client";

/**
 * The client shell for the project screen.
 *
 * It owns the file list and re-reads it from the database after every agent
 * write. That matters: the file tree, the diff counts and the preview all have
 * to agree, and the only version they can all agree on is what the database
 * actually holds. An optimistic client-side copy would eventually disagree.
 */

import * as React from "react";

import { BuilderWorkspace } from "@/components/builder/builder-workspace";
import type { Project, ProjectFile } from "@/lib/supabase/types";

export function ProjectClient({
  project,
  initialFiles,
  agentReady,
  setupHint,
}: {
  project: Project;
  initialFiles: ProjectFile[];
  /**
   * Whether the agent is usable, resolved on the server.
   *
   * Passed in rather than read here because a client component cannot see
   * `process.env.GROQ_API_KEY`. Reading it client-side made the builder refuse
   * to run with a perfectly valid key already in `.env.local`.
   */
  agentReady: boolean;
  setupHint: string;
}) {
  const [files, setFiles] = React.useState<ProjectFile[]>(initialFiles);
  const [tick, setTick] = React.useState(0);

  const reloadFiles = React.useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (tick === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/projects/${project.id}/files?v=${tick}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { files: ProjectFile[] };
        if (!cancelled) setFiles(data.files);
      } catch {
        // A failed refresh leaves the previous list on screen rather than
        // blanking it. The agent's own error state is the real signal.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick, project.id]);

  return (
    <BuilderWorkspace
      project={project}
      files={files}
      reloadFiles={reloadFiles}
      agentReady={agentReady}
      setupHint={setupHint}
    />
  );
}
