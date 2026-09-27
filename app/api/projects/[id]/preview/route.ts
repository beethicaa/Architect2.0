import { compilePreview } from "@/lib/agent/preview";
import { listFiles } from "@/lib/agent/tools";
import { requireSupabaseEnv } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";

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

    // The session check, which this route was missing.
    //
    // Every other project route verifies the caller before touching a row. This
    // one did not, so `listFiles` ran against an unauthenticated client, RLS
    // returned nothing, and the endpoint answered 200 with "No app/page.tsx yet"
    // to anyone who guessed a project id — a misleading answer to a stranger.
    const supabase = await createClient();
    const claims = await getClaims();
    if (!claims) {
      return new Response("Sign in to open a preview.", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const files = await listFiles(supabase, id);
    const result = await compilePreview(files);

    if (!result.ok) {
      return html(
        `<!doctype html><html><body style="font:13px/1.6 ui-monospace,monospace;padding:20px;color:#b91c1c;background:#fff">
<strong>${escapeHtml(result.error ?? "The app did not compile.")}</strong>
</body></html>`,
        // The panel cannot read the iframe's text without a same-origin hack, so
        // the build error is also sent as a header. It is what turns a blank
        // frame into an offer to repair the file.
        result.error ?? "The app did not compile.",
      );
    }

    // Send the content fingerprint so the panel can key the iframe URL to the
    // exact files behind this document. See CompileResult.fingerprint.
    //
    // This single return also serves the "compiled with notes" case: `ok` is true
    // and `error` carries the notes, so the document renders while the header
    // carries the caption. A second, unreachable `return` used to follow this one,
    // saying the same thing with less information.
    return html(result.html, result.error, result.fingerprint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return html(
      `<!doctype html><html><body style="font:13px/1.6 ui-monospace,monospace;padding:20px;color:#b91c1c">
${escapeHtml(message)}</body></html>`,
      message,
    );
  }
}

function html(body: string, note?: string | null, fingerprint?: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...(note ? { "x-architect-note": encodeURIComponent(note) } : {}),
      ...(fingerprint ? { "x-architect-fingerprint": fingerprint } : {}),
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
