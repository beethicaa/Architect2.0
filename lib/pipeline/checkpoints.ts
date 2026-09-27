/**
 * Checkpoints: the cross-cutting snapshot service (Section 9).
 *
 * The brief calls this "a service every other feature writes to", so it is a
 * module rather than a table. Every meaningful change — a completed pipeline
 * run, a manual edit, a push, a deploy — calls `createCheckpoint`.
 *
 * The important property is that a restore is a REAL revert. `snapshot` holds
 * every file's path and content at that moment, and `restoreCheckpoint` deletes
 * `project_files` and rewrites it from that snapshot. So rolling back reverts
 * the code, the data bindings and the UI together. Rolling back only the chat
 * transcript would be the fake version of this feature, and it is the one thing
 * that would make the whole timeline worthless.
 */

import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Checkpoint, Json, ProjectFile } from "@/lib/supabase/types";

/**
 * The shape stored in `checkpoints.snapshot`.
 *
 * The index signature is what lets it go into a JSONB column without a cast:
 * `Json` is structurally `{ [key: string]: Json | undefined }`, and an interface
 * without one is not assignable to it even when every field is a string. Adding
 * it here is cheaper than casting at every write and read.
 */
export interface SnapshotFile {
  path: string;
  content: string;
  language: string;
  [key: string]: Json | undefined;
}

export interface CheckpointStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  screens: number;
  [key: string]: Json | undefined;
}

export interface CreateCheckpointInput {
  projectId: string;
  runId?: string | null;
  /** Simple mode's one-line description. Written by the Reviewer, never typed. */
  label: string;
  /** Developer mode's per-agent model record. */
  modelSummary?: Record<string, string>;
  /** Set when the project is GitHub-connected, so a revert can be a real git op. */
  commitSha?: string | null;
  source?: "pipeline" | "manual" | "push" | "deploy";
}


/**
 * Capture the project as it is right now.
 *
 * The previous head is demoted in the same call that inserts the new one, and
 * the `checkpoints_one_head_idx` partial unique index is what actually enforces
 * a single head — so two concurrent writes cannot leave the timeline with two
 * heads. If that insert does fail on the unique index, the caller's error is
 * surfaced rather than swallowed.
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

/**
 * Every file currently in the project, in one query.
 *
 * `cache()` because a checkpoint write and its stats both need this, and
 * request-scoped dedup turns it into one read.
 */
export const getProjectFiles = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return [] as ProjectFile[];

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_files")
    .select("*")
    .eq("project_id", projectId)
    .order("path", { ascending: true });

  return (data ?? []) as ProjectFile[];
});

/**
 * `checkpoints.snapshot` is JSONB, so it comes back as `Json`. These two readers
 * narrow it in one place, with an explicit `unknown` hop, rather than scattering
 * casts and a runtime shape check through every call site.
 *
 * The check is real rather than a blind cast: a hand-edited or older row gets
 * filtered out instead of handing the restore path `undefined` paths to write
 * into `project_files`.
 */
export function readSnapshot(value: unknown): SnapshotFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is SnapshotFile =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as SnapshotFile).path === "string" &&
      typeof (entry as SnapshotFile).content === "string",
  );
}

export function readStats(value: unknown): CheckpointStats {
  const empty: CheckpointStats = {
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
    screens: 0,
  };
  if (typeof value !== "object" || value === null) return empty;
  const raw = value as Partial<CheckpointStats>;
  return {
    filesChanged: numberOr(raw.filesChanged, 0),
    linesAdded: numberOr(raw.linesAdded, 0),
    linesRemoved: numberOr(raw.linesRemoved, 0),
    screens: numberOr(raw.screens, 0),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function createCheckpoint(input: CreateCheckpointInput) {
  if (!isSupabaseConfigured) {
    return { error: "unconfigured" as const, checkpoint: null };
  }

  const supabase = await createClient();
  const files = await getProjectFiles(input.projectId);

  // Diff against the current version so the stats are real numbers rather than
  // "some files changed".
  //
  // Read as "the newest row", never as `is_head = true`. That column is cleared
  // by an `.update()` which silently matches nothing under RLS, so every
  // checkpoint in a real project ended up flagged - and `maybeSingle()` against
  // seven matching rows *throws* "multiple rows returned". That throw is what
  // turned every Undo into a 400 and every diff into a silent failure.
  const { data: head } = await supabase
    .from("checkpoints")
    .select("snapshot")
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous = new Map<string, SnapshotFile>();
  for (const entry of readSnapshot(head?.snapshot)) {
    previous.set(entry.path, entry);
  }

  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const file of files) {
    const before = previous.get(file.path);
    if (!before) {
      changed += 1;
      added += countLines(file.content);
    } else if (before.content !== file.content) {
      changed += 1;
      const beforeLines = countLines(before.content);
      const afterLines = countLines(file.content);
      if (afterLines > beforeLines) added += afterLines - beforeLines;
      else removed += beforeLines - afterLines;
    }
  }
  removed += Math.max(0, previous.size - files.length);

  // "Screens" is what the dashboard and the Time Machine both show, so it is
  // derived from the same file list rather than counted separately somewhere.
  const screens = files.filter((file) => /(^|\/)page\.[jt]sx?$/.test(file.path)).length;

  const stats: CheckpointStats = {
    filesChanged: changed,
    linesAdded: added,
    linesRemoved: removed,
    screens,
  };

  const snapshot: SnapshotFile[] = files.map((file) => ({
    path: file.path,
    content: file.content,
    language: file.language,
  }));

  /*
   * Demote the old head, then insert the new one.
   *
   * The demote is best-effort on purpose. An `.update()` matching zero rows
   * returns no error, so under a restrictive RLS policy it can silently change
   * nothing and leave a stale head behind. `0006` drops the partial unique index
   * that made that fatal, and `getHead` reads the newest row rather than
   * trusting `is_head`, so the insert no longer depends on the demote working.
   *
   * The error is still surfaced: "we asked and it said no" means a policy is
   * denying writes, which is worth knowing.
   */
  const { error: demoteError } = await supabase
    .from("checkpoints")
    .update({ is_head: false })
    .eq("project_id", input.projectId)
    .eq("is_head", true);

  if (demoteError) {
    console.error("[architect] could not demote the old head:", demoteError.message);
  }

  const { data: inserted, error } = await supabase
    .from("checkpoints")
    .insert({
      project_id: input.projectId,
      run_id: input.runId ?? null,
      label: input.label,
      commit_sha: input.commitSha ?? null,
      model_summary: input.modelSummary ?? {},
      snapshot,
      stats,
      source: input.source ?? "pipeline",
      is_head: true,
    })
    .select()
    .single();

  if (error || !inserted) {
    // The PostgREST error is the only thing that says *why*, and it was being
    // discarded in favour of the literal string "insert". Every checkpoint in a
    // real project failed this way and the terminal only ever said "insert" -
    // which names the operation, not the cause. This is the line that made the
    // difference between a five-round guess and a one-turn fix.
    console.error("[architect] checkpoint insert rejected:", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      projectId: input.projectId,
    });
    return { error: "insert" as const, checkpoint: null };
  }

  return { error: null, checkpoint: inserted as Checkpoint };
}

/** Reverse-chronological. The head first, because that is what is open. */
export const getCheckpoints = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return [] as Checkpoint[];

  const supabase = await createClient();
  const { data } = await supabase
    .from("checkpoints")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (data ?? []) as Checkpoint[];
});

export const getCheckpoint = cache(async (checkpointId: string) => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("checkpoints")
    .select("*")
    .eq("id", checkpointId)
    .maybeSingle();

  return (data ?? null) as Checkpoint | null;
});

/**
 * The newest state, which is what a rollback is measured against.
 *
 * Read as "the most recent row" rather than trusting `is_head`. That column is
 * maintained by two separate statements - one on create, one on restore - so a
 * partial failure can leave it stale, and a stale head would make the one-way
 * guard reject valid undos or allow invalid ones.
 */
const getHead = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("checkpoints")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as Checkpoint | null;
});

/**
 * Restore a checkpoint. This is the part that has to be real.
 *
 * Deletes every current file and rewrites `project_files` from the snapshot, so
 * a file created after the checkpoint genuinely disappears rather than lingering
 * as an orphan. RLS on `project_files` means the caller must be able to edit the
 * project; a read-only member gets an RLS error rather than a silent no-op.
 */
export async function restoreCheckpoint(checkpointId: string) {
  if (!isSupabaseConfigured) return { error: "unconfigured" as const };

  const checkpoint = await getCheckpoint(checkpointId);
  if (!checkpoint) return { error: "missing" as const };

  const supabase = await createClient();
  const claims = await getClaims();
  if (!claims) return { error: "unauthenticated" as const };

  // Undo is one-way: you can only move *back* through the timeline.
  //
  // Without this, restoring an older checkpoint silently discards everything
  // written after it - including work the user has not looked at yet - and then
  // offers them a "restore" on a newer entry that has already been erased, which
  // reads as the product losing their work rather than as a restore.
  //
  // The head is the newest state, so only entries older than it are valid
  // targets. This is enforced here rather than in the UI because the endpoint is
  // callable directly, and a guard that lives only in the component is a guard
  // that can be walked around.
  // Compared by identity, not by timestamp.
  //
  // This compared `head.created_at >= checkpoint.created_at`, and every
  // checkpoint from a single build is written within the same second - so a
  // perfectly valid undo of the second-newest entry compared equal, was
  // rejected as "not-older", and the route returned 400 with no server-side
  // error to find. Timestamps are not a total order; row identity is.
  const head = await getHead(checkpoint.project_id);
  if (head && head.id === checkpoint.id) {
    return { error: "not-older", projectId: checkpoint.project_id } as const;
  }

  const { error: deleteError } = await supabase
    .from("project_files")
    .delete()
    .eq("project_id", checkpoint.project_id);

  if (deleteError) {
    // The reason is printed, not summarised. Returning a bare "delete" is what
    // made this a 400 with no explanation and cost several rounds of guessing;
    // the message from Postgres names the policy or constraint at fault.
    console.error("[architect] restore could not clear the workspace:", {
      code: deleteError.code,
      message: deleteError.message,
      details: deleteError.details,
      hint: deleteError.hint,
      projectId: checkpoint.project_id,
    });
    return { error: "delete" as const };
  }

  const snapshot = readSnapshot(checkpoint.snapshot);
  if (snapshot.length > 0) {
    const { error: insertError } = await supabase.from("project_files").insert(
      snapshot.map((file) => ({
        project_id: checkpoint.project_id,
        path: file.path,
        content: file.content,
        language: file.language,
        prev_lines: countLines(file.content),
        version: 1,
      })),
    );
    if (insertError) {
      console.error("[architect] restore could not rewrite the files:", {
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        files: snapshot.length,
      });
      return { error: "insert" as const };
    }
  }

  // The restored state becomes the new head, so rolling forward again is just
  // another restore rather than a special case.
  await supabase
    .from("checkpoints")
    .update({ is_head: false })
    .eq("project_id", checkpoint.project_id)
    .eq("is_head", true);

  await supabase
    .from("checkpoints")
    .update({ is_head: true })
    .eq("id", checkpoint.id);

  return { error: null, projectId: checkpoint.project_id };
}

/**
 * The head checkpoint, or null when the project has never been checkpointed.
 *
 * Separate from `getCheckpoints` because the deploy and push flows both need
 * "what would I be shipping right now" and neither should have to pull the whole
 * timeline to answer it.
 */
export const getHeadCheckpoint = cache(async (projectId: string) => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  // The newest row, not `is_head = true`. See the note in `createCheckpoint`:
  // that column is not reliably cleared, and `maybeSingle()` against several
  // matching rows throws - which is what made Undo return 400.
  const { data } = await supabase
    .from("checkpoints")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data ?? null) as Checkpoint | null;
});
