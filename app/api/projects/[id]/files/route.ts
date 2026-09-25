import { requireSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * GET /api/projects/[id]/files - the project's workspace.
 *
 * Exists so the client can re-read the file list after the agent writes, without
 * a Server Action round trip. It returns exactly the columns the code panel
 * renders, and relies on the same RLS policies as everything else, so there is
 * no second authorisation path to keep in sync.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    requireSupabaseEnv();
    const supabase = await createClient();

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
