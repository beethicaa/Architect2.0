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

export interface ProjectsResult {
  projects: Project[];
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
  return { projects: data ?? [], error: null };
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
