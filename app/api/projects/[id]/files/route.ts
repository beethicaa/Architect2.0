import { requireSupabaseEnv } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * GET /api/projects/[id]/files - the project's workspace.
 *
 * Exists so the client can re-read the file list after the agent writes, without
 * a Server Action round trip. It returns exactly the columns the code panel
 * renders, and relies on the same RLS policies as everything else, so there is
 * no second authorisation path to keep in sync.
 *
 * RLS is what stops the *data* leaking: an anonymous caller's query returns
 * nothing. What RLS cannot do is distinguish "you have no files" from "you are
 * not signed in", so this route checks the session too and answers 401 rather
 * than an empty list. Without it a logged-out visitor sees a plausible-looking
 * empty workspace instead of an honest refusal, and the code panel renders that
 * as "this project has no code" — which reads as a broken build.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    requireSupabaseEnv();
    const supabase = await createClient();

    const claims = await getClaims();
    if (!claims) {
      return Response.json(
        { files: [], error: "Sign in to read this project's files." },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("project_files")
      .select("id, project_id, path, content, language, prev_lines, version, created_at, updated_at")
      .eq("project_id", id)
      .order("path");

    if (error) throw new Error(error.message);

    const files = (data ?? []) as Database["public"]["Tables"]["project_files"]["Row"][];
    return Response.json({ files });
  } catch (error) {
    return Response.json(
      { files: [], error: error instanceof Error ? error.message : String(error) },
      { status: 200 },
    );
  }
}
