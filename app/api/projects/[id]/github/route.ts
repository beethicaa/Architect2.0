/**
 * Push the project's files to GitHub.
 *
 * The brief's push flow: Developer mode gets a real diff and can push to a new
 * branch; Simple mode gets a plain-language summary with a single "Save these
 * changes to GitHub" that performs the same push. One endpoint serves both,
 * because the *operation* is identical — only the framing differs, and framing
 * belongs in the UI.
 *
 * The pushed files are read from `project_files`, which is the same table the
 * preview and the code panel read. So a push is always exactly what the user is
 * looking at, never a separate copy that can drift.
 */

import { NextResponse } from "next/server";

import { pushFiles } from "@/lib/github/client";
import { GITHUB_SETUP_HINT, isGitHubConfigured } from "@/lib/env";
import { getCheckpoints, getHeadCheckpoint } from "@/lib/pipeline/checkpoints";
import { requireGitHubCredentials } from "@/lib/github/store";
import { createClient, getClaims } from "@/lib/supabase/server";
import { shortId } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isGitHubConfigured) {
    return NextResponse.json({ error: GITHUB_SETUP_HINT }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    branch?: string;
    message?: string;
    /** Push only what changed since this checkpoint. */
    sinceCheckpointId?: string;
  };

  const supabase = await createClient();

  // RLS restricts this to people who can edit the project.
  const { data: project } = await supabase
    .from("projects")
    .select("id, repo_full_name, repo_branch")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "That project was not found." }, { status: 404 });
  }

  if (!project.repo_full_name) {
    return NextResponse.json(
      { error: "This project is not connected to a repository." },
      { status: 400 },
    );
  }

  const credentials = await requireGitHubCredentials();
  if (!credentials) {
    return NextResponse.json(
      { error: "Connect GitHub before pushing." },
      { status: 401 },
    );
  }

  const { data: files } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", id);

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "There is nothing to push yet." }, { status: 400 });
  }

  // When a baseline checkpoint is given, only files whose content differs are
  // pushed. Pushing the whole tree on every save would bury the agent's actual
  // change under everything that was already there, which defeats the point of
  // reviewing a diff.
  let toPush = files.map((file) => ({ path: file.path, content: file.content }));
  let changedOnly = 0;

  if (body.sinceCheckpointId) {
    const baseline = (await getCheckpoints(id)).find(
      (row) => row.id === body.sinceCheckpointId,
    );
    const previous = new Map(
      ((baseline?.snapshot ?? []) as { path: string; content: string }[]).map((file) => [
        file.path,
        file.content,
      ]),
    );
    toPush = toPush.filter((file) => previous.get(file.path) !== file.content);
    changedOnly = toPush.length;

    if (toPush.length === 0) {
      return NextResponse.json({
        error: "Nothing has changed since that point, so there is nothing to push.",
      });
    }
  }

  const branch =
    (body.branch ?? "").trim() ||
    `architect/${new Date().toISOString().slice(0, 10)}-${shortId(id)}`;

  const head = await getHeadCheckpoint(id);
  const message =
    (body.message ?? "").trim() ||
    `Architect: ${head?.label ?? "agent changes"}`;

  const result = await pushFiles(credentials, {
    repo: project.repo_full_name,
    baseBranch: project.repo_branch ?? "main",
    newBranch: branch,
    files: toPush,
    message,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Record the commit on a fresh checkpoint. That is what makes "revert to this
  // commit" a real git operation in the timeline rather than a database-only
  // label that lies about being a commit.
  if (result.commitSha) {
    const { createCheckpoint } = await import("@/lib/pipeline/checkpoints");
    await createCheckpoint({
      projectId: id,
      label: `Saved to GitHub — ${branch}`,
      commitSha: result.commitSha,
      source: "push",
    });
  }

  return NextResponse.json({
    ok: true,
    commitSha: result.commitSha,
    branch,
    filesPushed: toPush.length,
    changedOnly,
    compareUrl: `https://github.com/${project.repo_full_name}/compare/${project.repo_branch ?? "main"}...${branch}`,
  });
}
