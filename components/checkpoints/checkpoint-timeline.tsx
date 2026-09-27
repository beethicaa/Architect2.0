"use client";

/**
 * The checkpoint timeline — the product's original addition, and the answer to
 * the failure mode that makes people distrust agentic builders.
 *
 * The problem is specific: a build tool that changes your app without asking can
 * silently break something you cared about, and once that happens you stop
 * trusting it. A chat log does not fix that, because it does not let you *go
 * back*. This does — and the restore is a real revert of the files, not a
 * cosmetic scroll-back of the conversation.
 *
 * It is the same feature read two ways, which is the whole product thesis in one
 * component:
 *
 *   Simple     "Undo" — "Sign in added — entries now only show for the person
 *              who wrote them", and a Restore button.
 *   Developer  "History" — the same entries with the run's commit hash, the
 *              model each agent used, and the files that changed.
 */

import { History, RotateCcw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { AGENT_BY_KEY, type AgentKey } from "@/lib/pipeline/agents";
import { cn, relativeTime } from "@/lib/utils";
import { useViewMode } from "@/lib/view-mode";

export interface CheckpointSummary {
  id: string;
  label: string;
  stats: { filesChanged: number; linesAdded: number; linesRemoved: number; screens: number };
  modelSummary: Record<string, string>;
  commitSha: string | null;
  source: string;
  isHead: boolean;
  createdAt: string;
}

export function CheckpointTimeline({
  projectId,
  onRestored,
  className,
}: {
  projectId: string;
  /** Bumped after a restore so the file list and preview re-read. */
  onRestored: () => void;
  className?: string;
}) {
  const { isDeveloper } = useViewMode();
  const [rows, setRows] = React.useState<CheckpointSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/checkpoints`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      setLoading(false);
      return;
    }
    const data = (await response.json()) as { checkpoints: CheckpointSummary[] };
    setRows(data.checkpoints);
    setLoading(false);
  }, [projectId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/projects/${projectId}/checkpoints`, {
        cache: "no-store",
      }).catch(() => null);
      if (cancelled) return;
      if (!response?.ok) {
        setLoading(false);
        return;
      }
      const data = (await response.json()) as { checkpoints: CheckpointSummary[] };
      setRows(data.checkpoints);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function restore(checkpointId: string) {
    setPendingId(checkpointId);
    setError(null);
    setConfirming(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/checkpoints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "We could not roll back. Try again.");
        return;
      }
      await load();
      onRestored();
    } catch {
      setError("We could not reach the server. Your files are unchanged.");
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-lg border border-border/60"
            aria-hidden
          />
        ))}
        <p className="text-xs text-muted-foreground">Loading your history…</p>
      </div>
    );
  }
  /*
   * The head is derived from position, never from the `is_head` column.
   *
   * `rows` arrives newest-first, so `index === 0` is the current version - that
   * is what `CheckpointRow` receives. The column looked authoritative and was
   * not: the demote that clears it is an `.update()`, and an update matching zero
   * rows returns no error, so under RLS it changed nothing. Every checkpoint
   * kept `is_head = true`, all seven were labelled "current", and the Undo button
   * - which looked for the newest row that was *not* the head - found nothing to
   * undo over a seven-entry history.
   *
   * The order is the source of truth. `getHead` on the server reads the newest
   * row for the same reason.
   */



  if (rows.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border p-4", className)}>
        <p className="text-sm font-medium">No checkpoints yet</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Every completed build saves one automatically, and you can roll back to
          any of them at any time. Nothing to show until the team has built
          something.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <History aria-hidden className="size-3.5" />
        {rows.length} {rows.length === 1 ? "checkpoint" : "checkpoints"} — every
        build can be undone
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <UndoLatest
        projectId={projectId}
        target={rows[1] ?? null}
        isDeveloper={isDeveloper}
        busy={pendingId !== null}
        onRestored={() => {
          void load();
          onRestored();
        }}
        onError={setError}
      />

      <ol className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <CheckpointRow
            key={row.id}
            row={row}
            isHead={index === 0}
            isDeveloper={isDeveloper}
            busy={pendingId === row.id}
            confirming={confirming === row.id}
            onAsk={() => setConfirming(row.id)}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void restore(row.id)}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * The one-click undo.
 *
 * The per-row buttons already work, but they ask the user to find the entry they
 * want. "Undo" in the common case means exactly one thing - take back the most
 * recent change - so it gets a single button above the list, aimed at the newest
 * entry that is not the head.
 *
 * It is deliberately one-way, and says so. Undo moves backwards through the
 * timeline and never forwards, so there is no "redo" next to it: a redo that
 * silently re-applies discarded work is how a user loses something they thought
 * they had kept. The server enforces the same rule, so this is the affordance
 * rather than the guarantee.
 */
function UndoLatest({
  projectId,
  target,
  isDeveloper,
  busy,
  onRestored,
  onError,
}: {
  projectId: string;
  target: CheckpointSummary | undefined;
  isDeveloper: boolean;
  busy: boolean;
  onRestored: () => void;
  onError: (message: string) => void;
}) {
  if (!target) {
    // The control stays on screen even when there is nothing to undo.
    //
    // Hiding it meant "no undo yet" and "undo is broken" looked identical, and
    // you had no way to tell which you were looking at. A disabled control with a
    // reason is honest in a way that an absent one is not - and it means the thing
    // does not appear and disappear as the timeline grows.
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Nothing to undo yet. This is the only version, so there is nothing before
          it to go back to. Every change after this gets its own entry here.
        </p>
        <Button variant="outline" size="xs" disabled title="There is no earlier version to return to">
          <RotateCcw aria-hidden />
          {isDeveloper ? "Undo last" : "Undo"}
        </Button>
      </div>
    );
  }
  return <LatestUndoButton projectId={projectId} target={target} isDeveloper={isDeveloper} busy={busy} onRestored={onRestored} onError={onError} />;
}

function LatestUndoButton({
  projectId,
  target,
  isDeveloper,
  busy,
  onRestored,
  onError,
}: {
  projectId: string;
  target: CheckpointSummary;
  isDeveloper: boolean;
  busy: boolean;
  onRestored: () => void;
  onError: (message: string) => void;
}) {
  const [asking, setAsking] = React.useState(false);

  async function undo() {
    setAsking(false);
    const response = await fetch(`/api/projects/${projectId}/checkpoints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId: target.id }),
    }).catch(() => null);

    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
      onError(body?.error ?? "We could not undo that. Your files are unchanged.");
      return;
    }
    onRestored();
  }

  if (!asking) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-2.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {isDeveloper ? "Undo the last change" : "Take back the last change"}
        </p>
        <Button variant="outline" size="xs" onClick={() => setAsking(true)} disabled={busy}>
          <RotateCcw aria-hidden />
          {isDeveloper ? "Undo last" : "Undo"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Undo back to “{target.label}”? Everything after it is replaced, and undo
        only moves backwards.
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="xs" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" size="xs" onClick={() => void undo()} disabled={busy}>
          <RotateCcw aria-hidden />
          {busy ? "Undoing…" : "Undo"}
        </Button>
      </div>
    </div>
  );
}

function CheckpointRow({
  row,
  isHead,
  isDeveloper,
  busy,
  confirming,
  onAsk,
  onCancel,
  onConfirm,
}: {
  row: CheckpointSummary;
  /**
   * Whether this is the newest entry. Passed in rather than read from
   * `row.isHead`, because that column is maintained by an `.update()` that
   * silently matches nothing under RLS - which is what left every checkpoint
   * flagged "current" and the Undo button inactive over a seven-entry history.
   */
  isHead: boolean;
  isDeveloper: boolean;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const stats = row.stats;
  const modelList = Object.entries(row.modelSummary);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        isHead ? "border-volt/40 bg-volt/5" : "border-border",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm leading-relaxed">{row.label}</p>
        <p className="text-micro text-muted-foreground">
          {relativeTime(row.createdAt)}
          {isHead ? " · current" : ""}
          {/*
            Only a *restore* is a rollback.

            `source: "manual"` is written by the workspace writer on every file
            save, so labelling it "rolled back" told the user their own edit had
            been reverted. `restoreCheckpoint` does not create a row at all - it
            moves `is_head` onto the restored entry - so there is no row to
            label, and the honest marker here is simply that a file changed.
          */}
          {row.source === "manual" ? " · file edited" : ""}
        </p>
      </div>

      {/* The stat line is real: filesChanged, lines and screens all come from a
          diff against the previous head, not a placeholder. */}
      <p className="text-xs text-muted-foreground">
        {stats.filesChanged} {stats.filesChanged === 1 ? "file" : "files"} changed
        {stats.linesAdded > 0 ? ` · +${stats.linesAdded}` : ""}
        {stats.linesRemoved > 0 ? ` · -${stats.linesRemoved}` : ""}
        {stats.screens > 0 ? ` · ${stats.screens} screens` : ""}
      </p>

      {isDeveloper && (row.commitSha || modelList.length > 0) ? (
        <dl className="flex flex-col gap-0.5 border-t border-border pt-2 text-micro">
          {row.commitSha ? (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Commit</dt>
              <dd className="font-mono">{row.commitSha.slice(0, 7)}</dd>
            </div>
          ) : null}
          {modelList.length > 0 ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">Models</dt>
              <dd className="min-w-0 font-mono">
                {modelList
                  .map(
                    ([key, model]) =>
                      `${AGENT_BY_KEY[key as AgentKey]?.name ?? key}: ${model.split("/").pop()}`,
                  )
                  .join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {isHead ? null : confirming ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">
            Roll the app back to this version? Everything after it is replaced.
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="xs"
              onClick={onConfirm}
              disabled={busy}
            >
              <RotateCcw aria-hidden />
              {busy
                ? "Rolling back…"
                : isDeveloper
                  ? "Revert here"
                  : "Undo to here"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border pt-2">
          <Button variant="outline" size="xs" onClick={onAsk} disabled={busy}>
            <RotateCcw aria-hidden />
            {isDeveloper ? "Revert to this commit" : "Undo to this version"}
          </Button>
        </div>
      )}
    </li>
  );
}

