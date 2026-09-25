import { compilePreview } from "@/lib/agent/preview";
import { listFiles } from "@/lib/agent/tools";
import { requireSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/projects/[id]/preview - a running copy of the generated app.
 *
 * Reads the project's real files, compiles them with esbuild (React included)
 * and Tailwind, and returns a single self-contained HTML document. The preview
 * iframe points at this URL, so what the user clicks is the actual output of
 * the actual model - not a picture of one.
 *
 * A compile failure returns 200 with the error text, not a 500: the preview
 * panel's job is to show the user what went wrong, and a blank panel is the one
 * outcome that helps nobody.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    requireSupabaseEnv();
    const supabase = await createClient();
    const files = await listFiles(supabase, id);
    const result = await compilePreview(files);

    if (!result.ok) {
      return html(
        `<!doctype html><html><body style="font:13px/1.6 ui-monospace,monospace;padding:20px;color:#b91c1c;background:#fff">
<strong>${escapeHtml(result.error ?? "The app did not compile.")}</strong>
</body></html>`,
      );
    }

    return html(result.html);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return html(
      `<!doctype html><html><body style="font:13px/1.6 ui-monospace,monospace;padding:20px;color:#b91c1c">
${escapeHtml(message)}</body></html>`,
    );
  }
}

function html(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
