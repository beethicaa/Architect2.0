/**
 * Project mutations — the REAL slice.
 *
 * Same rules as every Server Action in Next.js: the action trusts nothing from
 * the form. The owner id comes from the verified session, and every write is
 * still subject to the RLS policies in the migration. `revalidatePath` then
 * makes the dashboard reflect the write in the same round trip.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { SUPABASE_HINT } from "@/lib/auth-error";
import { rethrowNavigation } from "@/lib/actions/navigation";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Shown when Postgres cannot be reached. Kept separate from the auth message
 * because the diagnosis differs: the credentials are fine, the network or the
 * database is not.
 */
const DATABASE_UNREACHABLE =
  "We could not reach the database. Check your connection and try again.";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { ProjectOrigin } from "@/lib/supabase/types";

export interface ProjectActionState {
  error: string | null;
  notice: string | null;
}

// NOTE: this is a "use server" file, so it may ONLY export async functions.
// Exporting a string constant from here invalidates the module and every
// action call fails at runtime with a 500. User-facing copy lives in
// `lib/auth-error.ts`; only the actions and the state type live here.

/**
 * "Start from a prompt" and "import an existing repo" create the same row with
 * a different `origin` — which is the product decision behind the two dashboard
 * entry points. One kind of project, two doors in, and the rest of the product
 * treats them identically.
 */
export async function createProject(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  if (!isSupabaseConfigured) {
    return { error: SUPABASE_HINT, notice: null };
  }

  const prompt = String(formData.get("prompt") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const origin = formData.get("origin") === "import" ? "import" : "prompt";

  if (origin === "import" && !repo) {
    return { error: "Choose a repository to import.", notice: null };
  }
  if (origin === "prompt" && prompt.length < 8) {
    return {
      error: "Describe the app in a sentence or two so the agents know what to build.",
      notice: null,
    };
  }

  const supabase = await createClient();
  const claims = await getClaims();
  if (!claims) {
    return { error: "Your session expired. Sign in again.", notice: null };
  }

  // A name is derived from the prompt when the user did not supply one, so the
  // dashboard is never a wall of "Untitled project".
  const projectName =
    name || (origin === "import" ? repo.split("/").pop() ?? "Imported project" : titleFrom(prompt));


  // Wrapped for the same reason as the auth actions: a database that cannot be
  // reached must produce a sentence, not a 500. `rethrowNavigation` runs first
  // because the `redirect()` below throws on success, and catching that would
  // report a successful save as a failure.
  let createdId: string;
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: claims.sub,
        name: projectName.slice(0, 80),
        prompt: origin === "prompt" ? prompt : null,
        origin: origin as ProjectOrigin,
        repo_full_name: origin === "import" ? repo : null,
        framework: origin === "import" ? "Next.js" : null,
        status: "draft",
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[architect] createProject insert failed:", error?.message);
      // A missing table is the common cause and has one specific fix, so it
      // gets a specific sentence rather than a generic failure.
      if (error?.code === "42P01" || /does not exist/i.test(error?.message ?? "")) {
        return {
          error:
            "The projects table does not exist yet. Run supabase/migrations/0001_core_schema.sql in the Supabase SQL Editor, then try again.",
          notice: null,
        };
      }
      return { error: "We could not create that project. Try again.", notice: null };
    }
    createdId = data.id;
  } catch (thrown) {
    rethrowNavigation(thrown);
    console.error("[architect] createProject failed:", thrown);
    return { error: DATABASE_UNREACHABLE, notice: null };
  }

  revalidatePath("/dashboard");
  redirect(`/projects/${createdId}`);
}

export async function deleteProject(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  if (!isSupabaseConfigured) {
    return { error: SUPABASE_HINT, notice: null };
  }

  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project.", notice: null };

  const supabase = await createClient();
  const claims = await getClaims();
  if (!claims) return { error: "Your session expired. Sign in again.", notice: null };

  // RLS allows only the owner to delete; the DB is the authority, not this check.
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    return { error: "We could not delete that project.", notice: null };
  }

  revalidatePath("/dashboard");
  return { error: null, notice: "Project deleted." };
}

/** "a booking app for my clinic" -> "Clinic booking app". */
function titleFrom(prompt: string): string {
  const cleaned = prompt
    .replace(/^(an?|the)\s+/i, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const words = cleaned.slice(0, 5).join(" ");
  if (!words) return "New project";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
