/**
 * Checkpoints for a project: list them, and restore one.
 *
 * Two actions on one route, because they are the same resource — a checkpoint
 * is something you read or something you act on, and splitting them across
 * `/checkpoints` and `/checkpoints/[id]/restore` would add a route for no gain.
 *
 * The restore is a **real revert**: `restoreCheckpoint` deletes every current
 * file and rewrites `project_files` from the snapshot, so code, data bindings
 * and UI all go back together. Rolling back only the chat transcript would be the
 * fake version, and it would make the whole timeline worthless.
 */

import { NextResponse } from "next/server";

import { getCheckpoints, readStats, restoreCheckpoint } from "@/lib/pipeline/checkpoints";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The timeline, newest first. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const rows = await getCheckpoints(id);

  // `snapshot` holds every file's full content, which is far too much to ship
  // for a list. The timeline only needs the label, the stats and the head flag;
  // a restore reads the snapshot server-side.
  // `isHead` is derived from position - `rows` is newest-first - rather than
  // from the stored column. The column is cleared by an `.update()` that
  // silently matches nothing under RLS, so in a real project every entry was
  // flagged, every row was labelled "current", and Undo found nothing to undo.
  // The list order is the only ordering that is always correct.
  const timeline = rows.map((row, index) => ({
    id: row.id,
    label: row.label,
    stats: readStats(row.stats as unknown),
    modelSummary: (row.model_summary ?? {}) as Record<string, string>,
    commitSha: row.commit_sha,
    source: row.source,
    isHead: index === 0,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ checkpoints: timeline });
}

/** Restore a checkpoint. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { checkpointId?: string };

  if (!body.checkpointId) {
    return NextResponse.json({ error: "Which checkpoint?" }, { status: 400 });
  }

  // RLS on project_files means a read-only member gets an error from the restore
  // rather than a silent no-op — which is the behaviour we want: saying a
  // rollback happened when it did not is the worst possible outcome here.
  const result = await restoreCheckpoint(body.checkpointId);
  if (result.error) {
    const message =
      result.error === "missing"
        ? "That checkpoint is no longer there."
        : // Said plainly rather than as a failure: the request was refused by
          // design, because undo only moves backwards. "Not older" means this
          // entry is the current state, so there is nothing behind it to go to.
          result.error === "not-older"
          ? "That is already the current version. Pick an older one to undo to."
          : result.error === "delete" || result.error === "insert"
            ? "We could not roll back. Your current files are unchanged — try again."
            : "We could not roll back. Try again in a moment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // A restore is a meaningful change, so it gets its own checkpoint pointing at
  // the restored state. Without this, the timeline would have a hole where the
  // rolled-back work used to be, and restoring again would be ambiguous.
  if (result.projectId === id) {
    const { createCheckpoint } = await import("@/lib/pipeline/checkpoints");
    await createCheckpoint({
      projectId: id,
      label: `Rolled back to an earlier version`,
      source: "manual",
    });
  }

  const supabase = await createClient();
  await supabase
    .from("projects")
    .update({ status: "ready" })
    .eq("id", id);

  return NextResponse.json({ ok: true, snapshot: null as Json });
}
