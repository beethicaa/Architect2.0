/**
 * Import a GitHub repository as a project.
 *
 * "use server" is load-bearing here, not decorative. `RepoPicker` is a client
 * component and imports `importRepository`; without the directive Next treats it
 * as an ordinary module and pulls its whole import graph — the Supabase server
 * client, the token store, `next/headers` — into the browser bundle, which fails
 * the build. With it, only the action is referenced from the client.
 *
 * That also constrains this file to exporting async functions and types, which
 * is why `ImportState` is an interface and the constant it would otherwise want
 * is inlined.
 *
 * The mapping the brief asks for — "Researcher/Planner agents read and map the
 * codebase before any generation happens, summarised for the user" — happens
 * here, synchronously, before the project exists. The user sees what the app is
 * and confirms before anything is created, so importing is a decision rather
 * than a leap of faith.
 */

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rethrowNavigation } from "@/lib/actions/navigation";
import { GITHUB_SETUP_HINT, isGitHubConfigured, isSupabaseConfigured } from "@/lib/env";
import { mapCodebase } from "@/lib/github/codebase";
import { planImport } from "@/lib/github/import-plan";
import { readFile, readTree } from "@/lib/github/client";
import { requireGitHubCredentials, type GitHubCredentials } from "@/lib/github/store";
import { writeManyFilesToProject } from "@/lib/pipeline/workspace";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Project } from "@/lib/supabase/types";

/**
 * Copy a repository's own files into a new project's workspace.
 *
 * The reason this function exists is a bug worth recording. Importing a
 * repository created a project row and then told the agents to "continue working
 * inside" it — without ever copying the code in. The workspace was empty, so the
 * only coherent thing a model could do was build something from nothing, and a
 * user importing a Kaggle Black Friday sales repository was shown a travel
 * planner. The import looked successful at every step that was measured, because
 * the only broken step was the one nobody had written.
 *
 * A workspace is what makes an import an import, so this is treated as required:
 * if it fails, the caller is told and the user is not sent into a project that
 * pretends to contain code it does not have.
 */
async function importRepositoryFiles(
  credentials: GitHubCredentials,
  repo: string,
  projectId: string,
  branch: string,
): Promise<{ error: string | null; copied: number; trimmed: boolean; planned: number; incomplete: boolean }> {
  const tree = await readTree(credentials, repo, branch);
  if (tree.error) {
    return { error: tree.error, copied: 0, trimmed: false, planned: 0, incomplete: false };
  }

  const plan = planImport(tree.tree);

  if (plan.paths.length === 0) {
    return {
      error:
        "That repository has no source files we can work with — it looks like a notebook, a data set, or a collection of images.",
      copied: 0,
      trimmed: false,
      planned: 0,
      incomplete: false,
    };
  }

  let copied = 0;

  // Why files were refused, counted rather than swallowed. "We could not read
  // that repository" sent the user looking for a permissions problem that did not
  // exist; the real cause was a path rule in our own writer, and it should be
  // visible from here rather than inferred from a generic message.
  const refusals = new Map<string, number>();

  // Read every planned file from GitHub, then store them in one pass.
  //
  // Both halves matter, and both were wrong before.
  //
  // Storing per file meant two database round-trips each — a select then an
  // upsert — so a 56-file repository issued 112 sequential queries inside a
  // Server Action. The action was killed part way through, every time, at the
  // same point: nine files, the project row already created, and no error
  // anywhere, because nothing threw. The symptom looked like a GitHub problem
  // and was measured as one — a direct read of all 56 files succeeds.
  //
  // One batched upsert turns that into two queries regardless of size.
  const fetched: { path: string; content: string }[] = [];

  // Read with bounded concurrency rather than one file at a time.
  //
  // This is the actual cause of "the repository only has nine files". The first
  // version walked `plan.paths` sequentially, so importing 56 files meant 56
  // serial HTTPS round trips to GitHub. That runs well past the Server Action's
  // response window, so the action was killed partway through the *read* and the
  // batched write below never executed at all. Nothing threw, which is why it
  // looked like a repository that genuinely contained nine files - and why the
  // same nine files survived every later attempt.
  //
  // Eight at a time turns 56 serial calls into 7 rounds. It is deliberately not
  // higher: GitHub rate-limits bursts harder than it rate-limits a steady
  // stream, and `readFile` already retries a throttled response.
  const CONCURRENCY = 8;
  const results: ({ path: string; content: string } | null)[] = new Array(plan.paths.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, plan.paths.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= plan.paths.length) return;
      const path = plan.paths[index];

      let file: { content: string; error: string | null };
      try {
        file = await readFile(credentials, repo, path, branch);
      } catch (caught) {
        // One unreadable file must not cost the other fifty-five, and the reason
        // has to be visible: a silent skip is what made every one of these look
        // like a repository that only contained nine files.
        const message = caught instanceof Error ? caught.message : String(caught);
        console.error(`[architect] import: reading ${path} threw:`, message);
        refusals.set(`threw while reading: ${message.slice(0, 70)}`, 1);
        continue;
      }

      if (file.error) {
        refusals.set(`read failed: ${file.error}`, (refusals.get(`read failed: ${file.error}`) ?? 0) + 1);
        continue;
      }

      results[index] = { path, content: file.content };
    }
  });
  await Promise.all(workers);

  for (const entry of results) {
    if (entry) fetched.push(entry);
  }

  const batch = await writeManyFilesToProject(projectId, fetched);
  copied = batch.written;

  for (const refusal of batch.rejected) {
    refusals.set(`rejected (${refusal.reason})`, (refusals.get(`rejected (${refusal.reason})`) ?? 0) + 1);
  }

  const incomplete = fetched.length + batch.rejected.length < plan.paths.length;
  if (incomplete) {
    console.warn(
      `[architect] import of ${repo} is INCOMPLETE: ${copied} of ${plan.paths.length} files copied`,
    );
  }

  if (copied === 0) {
    const detail = [...refusals.entries()]
      .map(([reason, count]) => `${reason} x${count}`)
      .join(", ");

    console.error(`[architect] import copied nothing from ${repo}:`, detail);

    return {
      error: detail
        ? `GitHub returned the files but we could not store them — ${detail}.`
        : "We could not read the contents of that repository.",
      copied: 0,
      trimmed: plan.trimmed,
      planned: plan.paths.length,
      incomplete: false,
    };
  }

  if (refusals.size > 0) {
    console.warn(
      `[architect] import of ${repo}: copied ${copied}, refused ${[...refusals.values()].reduce((a, b) => a + b, 0)} — ${[...refusals.keys()].join("; ")}`,
    );
  }

  if (plan.trimmed) {
    console.warn(
      `[architect] import trimmed ${repo}: kept ${copied} of ${tree.tree.length} files`,
    );
  }

  return { error: null, copied, trimmed: plan.trimmed, planned: plan.paths.length, incomplete };
}

export interface ImportState {
  error: string | null;
  /** The analysis, so the UI can show it before the user confirms. */
  preview: {
    framework: string;
    summary: string;
    detail: string;
    fileCount: number;
    entryPoints: string[];
    dependencies: string[];
    warnings: string[];
  } | null;
}

export async function importRepository(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const fullName = String(formData.get("repo") ?? "").trim();
  const branch = String(formData.get("branch") ?? "").trim() || "HEAD";

  if (!fullName || !fullName.includes("/")) {
    return { error: "Pick a repository first.", preview: null };
  }
  if (!isGitHubConfigured) return { error: GITHUB_SETUP_HINT, preview: null };
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured.", preview: null };
  }

  const claims = await getClaims();
  if (!claims) return { error: "Please sign in again.", preview: null };

  const credentials = await requireGitHubCredentials();
  if (!credentials) {
    return { error: "Connect GitHub before importing.", preview: null };
  }

  const { map, error } = await mapCodebase(credentials, fullName, branch);
  if (error || !map) {
    return { error: error ?? "We could not read that repository.", preview: null };
  }

  // Two modes: analyse only (the picker), or analyse and create.
  if (formData.get("analyseOnly") === "1") {
    return {
      error: null,
      preview: {
        framework: map.framework,
        summary: map.summary,
        detail: map.detail,
        fileCount: map.fileCount,
        entryPoints: map.entryPoints,
        dependencies: map.dependencies,
        warnings: map.warnings,
      },
    };
  }

  const supabase = await createClient();
  const name = fullName.split("/")[1];

  // Reuse the project for this repository instead of creating another one.
  //
  // Every import used to insert a fresh row, so retrying a failed import left a
  // trail of near-duplicates: nine `Flow-State` projects in one account, three of
  // them holding 19 files and the rest empty. Worse, the newest was the one the
  // user landed on, so a fix applied to the older project appeared to do nothing —
  // the same error, byte for byte, three times over.
  //
  // A repository is one project. Re-importing means "refresh the files in the
  // project I already have", and the branch is part of the identity because the
  // same repo on two branches is genuinely two codebases.
  //
  // There is no `archived_at` column. An earlier version of this filter included
  // `.is("archived_at", null)`, which PostgREST rejected as an unknown column, so
  // `existing` was always null and every import took the insert branch — silently
  // producing yet another duplicate. The failure was invisible because the code
  // was written to carry on when the lookup returned nothing.
  //
  // `status = 'archived'` is the real column, and it is what "not deleted" means
  // for this table.
  const { data: existing, error: lookupError } = await supabase
    .from("projects")
    .select("*")
    .eq("repo_full_name", fullName)
    .eq("origin", "import")
    .eq("owner_id", claims.sub)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    // Loud rather than silent. A failed lookup means a duplicate project, and a
    // duplicate is what made this whole flow confusing in the first place.
    console.error("[architect] import lookup failed:", lookupError.message);
  }

  const branchColumn = branch === "HEAD" ? null : branch;
  const reusable = existing && (existing.repo_branch ?? null) === branchColumn;

  let project: Project | null = null;
  let insertError: { message: string } | null = null;

  if (reusable && existing) {
    // The workspace is refreshed — but *after* the new files are in, never before.
    //
    // Deleting first means any failure in the copy destroys the project. That is
    // not hypothetical: importing is a burst of GitHub requests, it gets
    // throttled, and a throttled import after a delete leaves an empty workspace
    // while reporting a fresh project. Two repositories ended up at zero files
    // that way. The copy is the step that can fail, so it goes first and the
    // removal of files the repository no longer has happens at the very end.
    project = existing;
  } else {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        owner_id: claims.sub,
        name,
        description: map.summary,
        origin: "import",
        repo_full_name: fullName,
        repo_branch: branchColumn,
        framework: map.framework,
        status: "ready",
        accent: "volt",
      })
      .select()
      .single();

    project = data;
    insertError = error;
  }

  if (insertError || !project) {
    console.error("[architect] importRepository failed:", insertError?.message);
    return { error: "We could not create that project. Try again.", preview: null };
  }

  // The prompt is the real analysis, so the Researcher opens by describing the
  // codebase it is actually looking at.
  const prompt = [
    `Continue working inside the existing ${fullName} repository (branch ${branch}).`,
    "",
    map.detail,
    "",
    "Before generating anything, read the existing code and say what it does and what is missing.",
  ].join("\n");

  await supabase.from("projects").update({ prompt }).eq("id", project.id);

  // Copy the repository's own files into the workspace.
  //
  // This step is what makes an import an import. Without it the project is an
  // empty directory, the agents are asked to "continue working inside" something
  // that does not exist, and the only thing a model can do is invent an app —
  // which is how importing a Kaggle sales repository produced a travel planner.
  //
  // It runs *after* the project row exists because `writeFileToProject` needs a
  // project id, and it uses the same writer the agents use, so an imported file
  // and a generated file are indistinguishable downstream.
  const imported = await importRepositoryFiles(credentials, fullName, project.id, branch);

  if (imported.error) {
    // The project exists but is empty, which is the exact state that produced
    // the travel planner. Say so plainly rather than leaving a half-built import
    // that looks like a successful one.
    return {
      error:
        `${imported.error} The project was created but no code was copied in, so there is nothing to work inside yet.`,
      preview: null,
    };
  }

  if (imported.incomplete) {
    // The shortfall has to reach the user, and the one place they will look is
    // the project itself. A project that claims a codebase it does not have is
    // worse than a visible failure, because everything downstream then reasons
    // from a workspace that is quietly missing its entry point.
    await supabase
      .from("projects")
      .update({
        description:
          `${imported.copied} of ${imported.planned} files imported. ` +
          `GitHub throttled the rest — reopen the repository to fetch the remainder.`,
      })
      .eq("id", project.id);

    console.warn(
      `[architect] import of ${fullName} is INCOMPLETE: ${imported.copied} of ${imported.planned} files copied`,
    );
  }

  if (imported.trimmed) {
    // A partial import must be visible. Silently copying the first 40 files of a
    // large repository would look identical to copying all of them, and the user
    // would find out from a missing import later rather than from this.
    console.warn(
      `[architect] imported ${imported.copied} files from ${fullName}; the rest were left out to keep the build within the free-tier budget`,
    );
  }

  revalidatePath("/dashboard");

  try {
    redirect(`/projects/${project.id}`);
  } catch (caught) {
    rethrowNavigation(caught);
    return { error: "We could not open that project. Try again.", preview: null };
  }
}
