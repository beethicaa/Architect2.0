/**
 * The user's repositories, for the import picker.
 *
 * Returns only what the picker needs. The OAuth token is never involved in the
 * response — the server fetches with it and hands back plain repo metadata.
 *
 * The `import` query parameter asks for the static analysis of one repo, which
 * is what makes the import flow show "here's what your app does today" *before*
 * the user commits to importing, as the brief requires.
 */

import { NextResponse } from "next/server";

import { listRepos, readTree } from "@/lib/github/client";
import { mapCodebase } from "@/lib/github/codebase";
import { GITHUB_SETUP_HINT, isGitHubConfigured } from "@/lib/env";
import { requireGitHubCredentials } from "@/lib/github/store";
import { getClaims } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGitHubConfigured) {
    return NextResponse.json({ error: GITHUB_SETUP_HINT }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const credentials = await requireGitHubCredentials();
  if (!credentials) {
    return NextResponse.json(
      { error: "Connect GitHub first, then pick a repository." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const inspect = url.searchParams.get("inspect");

  // Inspect one repository: the Researcher/Planner's static analysis, run
  // against the real tree so the user sees facts before importing.
  if (inspect) {
    const map = await mapCodebase(credentials, inspect, "HEAD");
    if (map.error) {
      return NextResponse.json({ error: map.error }, { status: 400 });
    }
    return NextResponse.json({ map: map.map });
  }

  const { repos, error } = await listRepos(credentials);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  // Branches are only fetched when asked for, because it is one API call per
  // repository and a user with 40 repos should not pay for 40 requests to look
  // at a list.
  if (url.searchParams.get("branches") === "1" && repos[0]) {
    const [first] = repos;
    const response = await fetch(
      `https://api.github.com/repos/${first.fullName}/branches?per_page=50`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${credentials.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Architect-2.0",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      // The default branch is still known, so the picker stays usable rather
      // than failing outright over a secondary detail.
      return NextResponse.json({ repos, branchError: "We could not list that repository's branches." });
    }

    const branches = (await response.json()) as { name: string }[];
    return NextResponse.json({
      repos: repos.map((repo) =>
        repo.id === first.id
          ? { ...repo, branches: branches.map((branch) => branch.name) }
          : repo,
      ),
    });
  }

  // A lightweight tree read proves the credentials actually work on *this*
  // repo, which a list alone would not. A 404 here is the specific signal that
  // the token is fine but the repo is not — a very different fix.
  if (repos[0] && url.searchParams.get("verify") === "1") {
    const { error: treeError } = await readTree(credentials, repos[0].fullName, repos[0].defaultBranch);
    if (treeError) {
      return NextResponse.json({ error: treeError }, { status: 400 });
    }
  }

  return NextResponse.json({ repos });
}
