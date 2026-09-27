import { notFound } from "next/navigation";

import { ProjectClient } from "@/components/builder/project-client";
import {
  GROQ_SETUP_HINT,
  isGroqConfigured,
  isSupabaseConfigured,
  isVercelConfigured,
} from "@/lib/env";
import { DEMO_PROJECTS } from "@/lib/mock/demo-projects";
import { getAgentModels, getLatestRun, getProject } from "@/lib/projects";
import type { AgentKey } from "@/lib/pipeline/agents";
import { listFiles } from "@/lib/agent/tools";
import { createClient } from "@/lib/supabase/server";
import type { Project, ProjectFile } from "@/lib/supabase/types";

/**
 * The project / build screen.
 *
 * The project's files are read server-side on first paint, so the code panel has
 * something to show before the agent has run. After that the client re-reads
 * them whenever a write lands, so the tree and the diff counts are always the
 * database's view rather than an optimistic guess.
 *
 * `isGroqConfigured` is read *here*, on the server, and passed down. It cannot
 * be read in the browser: `process.env.GROQ_API_KEY` is server-only, so a client
 * component asking for it always gets undefined - which is what made the builder
 * refuse to run with a valid key already in `.env.local`.
 */
export default async function ProjectPage({
  params,
}: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const project: Project | null = isSupabaseConfigured
    ? (await getProject(id)).project
    : (DEMO_PROJECTS.find((item) => item.id === id) ?? null);

  if (!project) notFound();

  let files: ProjectFile[] = [];
  if (isSupabaseConfigured) {
    try {
      const supabase = await createClient();
      const records = await listFiles(supabase, id);
      files = records.map((record) => ({
        id: record.path,
        project_id: id,
        path: record.path,
        content: record.content,
        language: record.language,
        prev_lines: record.prevLines,
        version: record.version,
        created_at: "",
        updated_at: "",
      }));
    } catch {
      // The workspace table may not exist yet. The builder shows an empty file
      // list and the agent surfaces the real error when it first tries to write,
      // which is more honest than a blank page here.
      files = [];
    }
  }

  // The most recent run's artifacts, so the inspector has something real to show
  // on first paint. The graph's live state comes from the stream; this is the
  // durable record behind it.
  const artifacts: Partial<
    Record<AgentKey, { artifact: unknown; model: string; files: string[] }>
  > = {};

  if (isSupabaseConfigured) {
    const run = await getLatestRun(id);
    const agents = (run?.agents ?? {}) as Record<string, unknown>;

    for (const [key, value] of Object.entries(agents)) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as {
        artifact?: unknown;
        model?: unknown;
        files?: unknown;
      };
      artifacts[key as AgentKey] = {
        artifact: entry.artifact ?? null,
        model: typeof entry.model === "string" ? entry.model : "",
        files: Array.isArray(entry.files) ? (entry.files as string[]) : [],
      };
    }
  }

  // The per-agent model overrides, so the inspector's selector shows the value
  // that is actually in force rather than an empty select.
  const agentModels = isSupabaseConfigured ? await getAgentModels(id) : {};

  return (
    <ProjectClient
      project={project}
      initialFiles={files}
      agentReady={isGroqConfigured}
      setupHint={GROQ_SETUP_HINT}
      artifacts={artifacts}
      agentModels={agentModels}
      vercelReady={isVercelConfigured}
    />
  );
}
