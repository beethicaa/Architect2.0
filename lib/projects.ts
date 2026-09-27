import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Project } from "@/lib/supabase/types";

/**
 * The REAL slice: reading projects out of Postgres.
 *
 * Two deliberate design decisions:
 *
 * 1. **`isSupabaseConfigured` is checked before touching the client.** The app
 *    has to boot with zero credentials (most flows are mocked), so callers get
 *    a typed `error` instead of an exception. This is why these functions
 *    return a result object rather than throwing.
 * 2. **`cache()` deduplicates within a request.** A page that renders the
 *    header and the list asks for the same projects twice; React's cache makes
 *    that one query. It is request-scoped, so there is no cross-user leakage.
 */

export interface ProjectListItem extends Project {
  /**
   * How many files the project has, counted from `project_files`.
   *
   * `undefined` means "not counted", not zero. An uncounted project must never
   * render as an empty app, so the card omits the row entirely rather than
   * showing a number we cannot substantiate. Only the Developer lens reads this,
   * and only because a developer uses file count to tell a stub from a real
   * build without opening the project.
   */
  fileCount?: number;
}

export interface ProjectsResult {
  projects: ProjectListItem[];
  error: "unconfigured" | "unauthenticated" | "query" | null;
}

export const getProjects = cache(async (): Promise<ProjectsResult> => {
  if (!isSupabaseConfigured) return { projects: [], error: "unconfigured" };

  const supabase = await createClient();
  const claims = await getClaims();
  if (!claims) return { projects: [], error: "unauthenticated" };

  // No `.or()` filter is needed, and adding one would be a bug.
  //
  // The `projects_select_own_or_member` RLS policy already restricts every row
  // to `owner_id = auth.uid() or is_project_member(id)`, so Postgres decides
  // visibility - not the query string. That is both safer (a filter forgotten
  // here cannot leak another account's projects) and more reliable: a nested
  // `in.(select ...)` subquery is parsed by PostgREST, not SQL, and its support
  // varies by version and by the `db-max-rows` setting.
  //
  // RLS cannot be bypassed by a client, so this is the correct way to ask
  // "my projects": no user id is trusted from here.
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return { projects: [], error: "query" };

  // The file count, for the Developer lens.
  //
  // This is a real count read from `project_files`, not an estimate, and it is
  // fetched in one grouped query rather than per project — twenty projects would
  // otherwise mean twenty round trips on the dashboard's first paint.
  //
  // It is computed with the same RLS-restricted client, so a user can only ever
  // count files in projects they can already see. A project that is not returned
  // here simply has no `fileCount`, and the card omits the row rather than
  // showing a zero it cannot substantiate.
  const ids = (data ?? []).map((row) => row.id);
  const counts: Record<string, number> = {};

  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from("project_files")
      .select("project_id")
      .in("project_id", ids);

    for (const row of rows ?? []) {
      counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
    }
  }

  const projects = (data ?? []).map((row) => ({
    ...row,
    fileCount: counts[row.id],
  }));

  return { projects, error: null };
});

export interface ProjectResult {
  project: Project | null;
  error: "unconfigured" | "unauthenticated" | "query" | null;
}

/** One project, read with the same RLS that protects everything else. */
export const getProject = cache(
  async (projectId: string): Promise<ProjectResult> => {
    if (!isSupabaseConfigured) return { project: null, error: "unconfigured" };

    const supabase = await createClient();
    const claims = await getClaims();
    if (!claims) return { project: null, error: "unauthenticated" };

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();

    if (error) return { project: null, error: "query" };
    return { project: data, error: null };
  },
);

/**
 * The most recent run for a project, with its per-agent state.
 *
 * Read on the server and passed into the workspace, because the artifacts are
 * the agents' own output and can be large — they do not belong in a client
 * payload that is fetched on every render. The graph's *live* state comes from
 * the stream; this is the durable record behind it, so a page refresh shows what
 * the agents actually said rather than resetting to an empty graph.
 */
export const getLatestRun = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_runs")
    .select("id, state, agents, receipt, started_at, finished_at, error")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as {
    id: string;
    state: string;
    agents: unknown;
    receipt: string | null;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  } | null;
});

/**
 * The per-agent model overrides for a project.
 *
 * Read on the server and passed down, because a client component cannot see
 * `process.env`, and — more to the point — the values are the answer to "which
 * model will run this agent", which is not a client concern at all.
 */
export const getAgentModels = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return {} as Record<string, string>;

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_settings")
    .select("agent_models")
    .eq("project_id", projectId)
    .maybeSingle();

  const raw = (data?.agent_models ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
});

/** The signed-in user's profile row (created by a trigger on sign-up). */
export const getProfile = cache(async () => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const claims = await getClaims();
  if (!claims) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", claims.sub)
    .maybeSingle();

  return data;
});

/** Counts for the dashboard's summary line. */
export function projectSummary(projects: Project[]) {
  const live = projects.filter((p) => p.status === "deployed").length;
  const building = projects.filter((p) => p.status === "building").length;
  const imported = projects.filter((p) => p.origin === "import").length;
  return { total: projects.length, live, building, imported };
}
