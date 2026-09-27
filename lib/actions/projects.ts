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
/**
 * Condense a prompt into a project name.
 *
 * The first five words are almost never the best five words. "a web app where i
 * store notes of all subjects" became "Web app where i store notes" - which
 * describes the technology rather than the thing being built, and several
 * projects then differed only by a stray "the".
 *
 * So the leading filler is dropped, and the words that merely restate the medium
 * ("web app", "mobile app", "website") are dropped with it, because by the time
 * someone is in the builder they know it is an app. What is left is the part
 * that actually names the subject.
 *
 * This is a rule-based condensation rather than a model call on purpose: it runs
 * inside the create-project request, and adding a network round trip to naming a
 * project would make the button feel slow for a cosmetic gain.
 */
/**
 * Words that carry no information in a project name.
 *
 * Split into two groups because they are removed for different reasons:
 *
 *   - Grammar and the medium. "a", "the", "web", "app" - by the time someone is
 *     looking at a list of projects they know these are apps, and the words only
 *     pad the title.
 *   - The action verbs people reach for when describing software. "store",
 *     "track", "manage", "generate". Almost every prompt opens with one, and
 *     keeping it puts a verb where a name belongs: "Store subjectwise notes"
 *     instead of "Subjectwise notes".
 *
 * The list is deliberately generic. Anything specific to a domain ("biology",
 * "clinic") is exactly the word worth keeping.
 */
const FILLER = new Set([
  // grammar
  "a", "an", "the", "i", "we", "my", "our", "me", "you", "your", "us",
  "that", "which", "where", "when", "who", "whose", "for", "to", "with",
  "and", "but", "so", "then", "also", "have", "has", "having", "it", "is",
  "are", "be", "been", "will", "would", "shall", "should", "can", "could",
  "may", "might", "must", "do", "does", "did", "there", "here", "if", "than",
  "as", "at", "by", "from", "in", "into", "of", "on", "or", "over", "up",
  "out", "about", "just", "very", "really", "some", "any", "each", "every",
  "all", "both", "more", "most", "such", "own", "same", "s", "t", "re", "ve",
  "ll", "d", "m",
  // the medium
  "app", "application", "apps", "web", "webapp", "web-app", "website", "site",
  "mobile", "desktop", "online", "thing", "things", "something", "anything",
  "stuff", "tool", "page", "program", "system", "software",
  // asking for it
  "want", "need", "wants", "needs", "like", "please", "lets", "let", "help",
  "make", "build", "create", "generate", "develop", "give", "design", "code",
  // describing what it does
  "store", "stores", "track", "tracks", "manage", "manages", "organise",
  "organize", "keep", "keeps", "save", "saves", "add", "show", "list", "view",
  "log", "note", "see", "find", "search", "plan", "help",
]);

function titleFrom(prompt: string): string {
  const words = prompt
    .toLowerCase()
    // Possessives first: "son's" would otherwise split into "son" and "s", and
    // the stray "s" is exactly the kind of debris that makes a title look
    // machine-made. Contractions go the same way - "it'd" became "it d".
    .replace(/['\u2019]s\b/g, "")
    .replace(/n['\u2019]t\b/g, " not")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Keep the distinctive words, in the order they were written.
  const meaningful = words.filter((word) => !FILLER.has(word));

  // Everything was filler ("an app") - fall back to the original opening so the
  // project is still distinguishable rather than blank.
  const chosen = (meaningful.length > 0 ? meaningful : words).slice(0, 5);
  if (chosen.length === 0) return "New project";

  const titled = chosen.join(" ");
  // Sentence case, not Title Case: "Study notes and quizzes" reads as a name,
  // where "Study Notes And Quizzes" reads as a label.
  return titled.charAt(0).toUpperCase() + titled.slice(1);
}
