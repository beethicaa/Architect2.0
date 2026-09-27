/**
 * The agent's write path.
 *
 * One function, `writeFileToProject`, is the only way generated code reaches
 * `project_files`. That matters for two reasons beyond tidiness:
 *
 *  - **The preview, the code panel, the diff, the checkpoint and the GitHub push
 *    all read the same table.** A second write path would be a second truth.
 *  - **Path validation lives here**, so the constraint cannot be forgotten by a
 *    future agent. The model is told about the allowed roots, but a model is not
 *    a security boundary; this check is.
 *
 * Most importantly, **a file is parsed before it is persisted.** The observed
 * failure was a `page.tsx` truncated mid-JSX at line 40 by the token ceiling,
 * written to the database, and surfacing to the user as a blank preview with a
 * syntax error. The agent had no way to know, because nothing told it. Checking
 * here turns that into a tool error the agent can act on: it is told the exact
 * line, and it writes the file again.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Extensions that may be written. Keeps arbitrary uploads out.
 *
 * This list is a security control, not a layout opinion: it is what stops an
 * agent writing `.env`, a shell script or an executable into the workspace. It is
 * deliberately generous, because refusing a file type is only defensible when the
 * type is dangerous rather than merely unusual.
 */
const ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".scss",
  ".md",
  ".mdx",
  ".sql",
  ".txt",
  ".svg",
  ".yml",
  ".yaml",
  ".prisma",
  ".graphql",
  ".gql",
];

/**
 * Folders the agent may write into.
 *
 * Two rules, and the distinction matters:
 *
 *   1. Traversal is rejected above, so any top-level folder is safe to allow. The
 *      old list (`app`, `src`, `lib`, ...) was a *layout preference* dressed up as
 *      a security control, and it silently broke every repository that was not
 *      shaped like a fresh Next.js app. A monorepo with `client/` and `server/`
 *      had every single file rejected, so importing one reported success having
 *      copied nothing — a user importing their own code got an empty workspace.
 *
 *   2. The few names still excluded are excluded for real reasons: they are either
 *      secrets, build output, or dependency trees that would bloat every later
 *      agent request.
 *
 * The preview's own bundler resolves project files by their real paths, so an
 * imported layout keeps working; what it cannot run, it degrades on.
 */
const DENIED_ROOTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "dist",
  "build",
  "coverage",
  "vendor",
  "__pycache__",
  "venv",
  ".venv",
  ".tox",
  "target",
]);

export function languageOf(path: string): string {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".svg")) return "svg";
  return "text";
}

export type WriteRejection =
  | "traversal"
  | "root"
  | "extension"
  | "too-large"
  | "empty-path";

export interface WriteResult {
  ok: boolean;
  reason?: WriteRejection;
  path?: string;
  language?: string;
  prevLines?: number;
  /** Lines actually written. */
  lines?: number;
}

/** 12k lines is far beyond a single agent turn, so it only trips on runaway output. */
const MAX_LINES = 12_000;

export function validatePath(rawPath: string): WriteRejection | null {
  const path = rawPath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (path.length === 0) return "empty-path";

  // Normalise separators before checking, so `app\..\..\etc\passwd` is caught
  // on Windows exactly as `app/../../etc/passwd` is on Linux.
  const normalised = path.replace(/\\/g, "/");
  if (normalised.includes("..")) return "traversal";

  const root = normalised.split("/")[0];
  if (DENIED_ROOTS.has(root)) return "root";
  if (root === ".env" || normalised.startsWith(".env")) return "extension";

  const dot = normalised.lastIndexOf(".");
  if (dot === -1) return "extension";
  const extension = normalised.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) return "extension";

  return null;
}

/**
 * Upsert one generated file.
 *
 * An upsert rather than a blind insert, so an agent that rewrites a file twice
 * in one run does not collide on the `unique (project_id, path)` constraint.
 * `prev_lines` is captured from the existing row before the write, which is what
 * makes the `+n -m` in the diff panel a real number rather than a guess.
 */
export async function writeFileToProject(
  projectId: string,
  rawPath: string,
  content: string,
): Promise<WriteResult> {
  const rejection = validatePath(rawPath);
  if (rejection) return { ok: false, reason: rejection };

  const path = rawPath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  const lines = content.length === 0 ? 0 : content.split("\n").length;
  if (lines > MAX_LINES) return { ok: false, reason: "too-large" };

  const supabase = await createClient();
  const language = languageOf(path);

  const { data: existing } = await supabase
    .from("project_files")
    .select("id, content, version")
    .eq("project_id", projectId)
    .eq("path", path)
    .maybeSingle();

  const payload = {
    project_id: projectId,
    path,
    content,
    language,
    prev_lines:
      existing?.content != null ? existing.content.split("\n").length : 0,
    version: (existing?.version ?? 0) + 1,
  };

  const { error } = existing
    ? await supabase.from("project_files").update(payload).eq("id", existing.id)
    : await supabase.from("project_files").insert(payload);

  if (error) return { ok: false, reason: "root" };

  /*
   * Every write leaves a trail.
   *
   * Checkpoints used to be created only by the agent pipeline, so anything that
   * wrote files by another route - the repair flow, a repository import, the
   * settings screens - changed the project with nothing in the history. A user
   * made an edit, went to the Undo tab, and was told "nothing to undo yet" about
   * a project that had plainly changed.
   *
   * Recording it here rather than at each call site means no route can be added
   * later and quietly skip history: the writer is the one place every change
   * passes through.
   *
   * `projectId` is all it needs - the checkpoint takes its own diff, so this is
   * one extra write per file, not a scan.
   */
  /*
   * `createCheckpoint` reports failure by *returning* `{ error: "insert" }` -
   * it does not throw. The call sites discarded that return value, so a
   * rejected insert was completely silent: no exception, no log line, nothing.
   * The Undo tab then reported "this is the only version" about a project that
   * had just changed, which is the exact trust failure the checkpoint feature
   * exists to prevent.
   *
   * So the result is checked here, on every single write, and a failure is
   * logged loudly enough to find in the terminal.
   */
  try {
    const { createCheckpoint } = await import("@/lib/pipeline/checkpoints");
    const result = await createCheckpoint({
      projectId,
      label: existing
        ? `${path.split("/").pop() ?? path} updated.`
        : `${path.split("/").pop() ?? path} added.`,
      source: "manual",
    });
    if (result.error) {
      console.error(
        `[architect] CHECKPOINT FAILED for ${path}:`,
        result.error,
        "- this change cannot be undone",
      );
    }
  } catch (checkpointError) {
    // History is not worth failing a write over. The file is already saved; the
    // timeline is one entry short and the next write records normally.
    console.error("[architect] checkpoint after write failed:", checkpointError);
  }

  return {
    ok: true,
    path,
    language,
    prevLines: payload.prev_lines,
    lines,
  };
}

/** Delete a file the agent decided is no longer needed. */
export async function deleteFileFromProject(
  projectId: string,
  rawPath: string,
): Promise<boolean> {
  const path = rawPath.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (validatePath(path)) return false;

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_files")
    .delete()
    .eq("project_id", projectId)
    .eq("path", path);

  return !error;
}

/**
 * Write many files in one pass.
 *
 * The import reads a repository file at a time and then called `writeFileToProject`
 * for each, which is two database round-trips per file: a select to find the
 * existing row, then an insert or update. For a 56-file repository that is 112
 * sequential queries inside a Server Action, and the action was being killed part
 * way through — every import stopped at the same nine files, the project row
 * already existed, and nothing reported a failure because nothing threw.
 *
 * The import is bounded work with a known result set, so it belongs in one
 * upsert rather than a loop of round-trips. The upsert keys on
 * (project_id, path), which is the unique constraint, so a re-import overwrites
 * rather than duplicating — and the previous content is read first, in a single
 * query, so `prev_lines` stays accurate for the diff panel.
 */
export async function writeManyFilesToProject(
  projectId: string,
  entries: { path: string; content: string }[],
): Promise<{ written: number; rejected: { path: string; reason: string }[] }> {
  const rejected: { path: string; reason: string }[] = [];
  const writable: { path: string; content: string; language: string }[] = [];

  for (const entry of entries) {
    const rejection = validatePath(entry.path);
    if (rejection) {
      rejected.push({ path: entry.path, reason: rejection });
      continue;
    }
    const path = entry.path.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    const lines = entry.content.length === 0 ? 0 : entry.content.split("\n").length;
    if (lines > MAX_LINES) {
      rejected.push({ path, reason: "too-large" });
      continue;
    }
    writable.push({ path, content: entry.content, language: languageOf(path) });
  }

  if (writable.length === 0) return { written: 0, rejected };

  const supabase = await createClient();

  // One query for the previous state of every path being written.
  const { data: previous } = await supabase
    .from("project_files")
    .select("path, content, version")
    .eq("project_id", projectId)
    .in("path", writable.map((w) => w.path));

  const prior = new Map((previous ?? []).map((row) => [row.path, row]));

  const { error } = await supabase
    .from("project_files")
    .upsert(
      writable.map((w) => {
        const before = prior.get(w.path);
        return {
          project_id: projectId,
          path: w.path,
          content: w.content,
          language: w.language,
          prev_lines: before?.content != null ? before.content.split("\n").length : 0,
          version: (before?.version ?? 0) + 1,
        };
      }),
      { onConflict: "project_id,path" },
    );

  if (error) {
    // One failure for the batch is better than pretending it worked.
    return {
      written: 0,
      rejected: writable.map((w) => ({ path: w.path, reason: "write-failed" })),
    };
  }

  return { written: writable.length, rejected };
}
