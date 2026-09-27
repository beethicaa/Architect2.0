/**
 * The GitHub operations this product actually performs.
 *
 * Three flows, per Section 7:
 *   - list:  the user's repos, for the import picker
 *   - read:  the file tree and manifests, so the Researcher can map a codebase
 *   - write: a branch and a commit, so agent changes can be pushed
 *
 * The write path uses the **Git Data API** (blobs → tree → commit → ref) rather
 * than the Contents API. The Contents API is one file per request and would mean
 * N round trips for an agent that just wrote six files; the Data API takes them
 * in one commit, which is also what makes the result reviewable as a single
 * coherent change rather than a stack of unrelated ones.
 */

import { githubFetch, type GitHubCredentials } from "@/lib/github/store";

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  stars: number;
}

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
}

export async function listRepos(
  credentials: GitHubCredentials,
): Promise<{ repos: RepoSummary[]; error: string | null }> {
  // Sorted by pushed rather than created: someone picking a repo to keep
  // working on cares about which they touched last.
  const result = await githubFetch<RawRepo[]>(
    credentials,
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
  );

  if (result.error || !result.data) {
    return { repos: [], error: result.error ?? "We could not list your repositories." };
  }

  // Forks and archived repos are excluded: agents cannot meaningfully work in
  // them, and offering them produces an import that fails later with a much
  // less obvious error.
  const repos = result.data
    .filter((repo) => !repo.fork && !repo.archived)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      language: repo.language,
      private: repo.private,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
      stars: repo.stargazers_count,
    }));

  return { repos, error: null };
}

export interface RepoTree {
  path: string;
  type: "blob" | "tree";
  size: number;
}

interface RawTree {
  tree: { path: string; type: string; size?: number }[];
  truncated: boolean;
}

/**
 * The file tree, for the Researcher's static analysis.
 *
 * `truncated: true` is returned honestly rather than ignored — GitHub caps a
 * tree walk, and a repo big enough to hit that produces a partial picture. The
 * importer surfaces it, so nobody is told they have the whole codebase when
 * they do not.
 */
export async function readTree(
  credentials: GitHubCredentials,
  repo: string,
  branch: string,
): Promise<{ tree: RepoTree[]; truncated: boolean; error: string | null }> {
  const result = await githubFetch<RawTree>(
    credentials,
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );

  if (result.error || !result.data) {
    return {
      tree: [],
      truncated: false,
      error: result.error ?? "We could not read that repository.",
    };
  }

  const tree = result.data.tree
    .filter((entry) => entry.type === "blob" || entry.type === "tree")
    .map((entry) => ({
      path: entry.path,
      type: entry.type as "blob" | "tree",
      size: entry.size ?? 0,
    }));

  return { tree, truncated: result.data.truncated, error: null };
}

export async function readFile(
  credentials: GitHubCredentials,
  repo: string,
  path: string,
  branch: string,
): Promise<{ content: string; error: string | null }> {
  const result = await githubFetch<{ content: string; encoding: string }>(
    credentials,
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
  );

  if (result.error || !result.data) {
    return { content: "", error: result.error ?? `We could not read ${path}.` };
  }

  // GitHub returns base64. A non-UTF-8 file (a lockfile, a binary asset)
  // decodes to something unusable, so it is reported as empty rather than as
  // mojibake that the agents would then try to reason about.
  try {
    return { content: atob(result.data.content.replace(/\n/g, "")), error: null };
  } catch {
    return { content: "", error: null };
  }
}

/** Base64 for content that may contain non-Latin-1 characters. */
function toBase64(content: string): string {
  // `btoa` throws on any code point above 255, and generated code routinely
  // contains them — an em dash in a string literal, an emoji in seed data. The
  // encode/decode round-trip is what makes that safe.
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Push the project's files to a new branch.
 *
 * One commit containing every changed file, so a reviewer sees a single coherent
 * change. Returns the commit sha, which is then stored on the checkpoint — which
 * is what makes "revert to this commit" a real git operation rather than a
 * database-only illusion.
 */
export async function pushFiles(
  credentials: GitHubCredentials,
  input: {
    repo: string;
    baseBranch: string;
    newBranch: string;
    files: { path: string; content: string }[];
    message: string;
  },
): Promise<{ commitSha: string | null; error: string | null }> {
  if (input.files.length === 0) {
    return { commitSha: null, error: "There is nothing to push." };
  }

  // 1. The base branch's head, which the new commit hangs off.
  const base = await githubFetch<{ object: { sha: string } }>(
    credentials,
    `/repos/${input.repo}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
  );
  if (base.error || !base.data) {
    return { commitSha: null, error: base.error ?? "We could not find that branch." };
  }
  const baseSha = base.data.object.sha;

  // 2. One blob per file. Parallel, because these are independent and there can
  //    be a dozen of them after a build.
  const blobs = await Promise.all(
    input.files.map(async (file) => {
      const created = await githubFetch<{ sha: string }>(
        credentials,
        `/repos/${input.repo}/git/blobs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: toBase64(file.content),
            encoding: "base64",
          }),
        },
      );
      return { path: file.path, sha: created.data?.sha ?? null };
    }),
  );

  const usable = blobs.filter((blob) => blob.sha !== null);

  // Partial success is reported as failure. A commit missing three of six files
  // is worse than no commit: it looks like it worked, and the repo is now
  // inconsistent with the product.
  if (usable.length !== input.files.length) {
    return {
      commitSha: null,
      error: "Some files could not be uploaded, so nothing was pushed.",
    };
  }

  // 3. A tree referencing them, based on the existing one.
  const tree = await githubFetch<{ sha: string }>(
    credentials,
    `/repos/${input.repo}/git/trees`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base_tree: baseSha,
        tree: usable.map((blob) => ({
          path: blob.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        })),
      }),
    },
  );
  if (tree.error || !tree.data) {
    return { commitSha: null, error: tree.error ?? "We could not build the commit." };
  }

  // 4. The commit itself.
  const commit = await githubFetch<{ sha: string }>(
    credentials,
    `/repos/${input.repo}/git/commits`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        tree: tree.data.sha,
        parents: [baseSha],
      }),
    },
  );
  if (commit.error || !commit.data) {
    return { commitSha: null, error: commit.error ?? "We could not create the commit." };
  }

  // 5. The branch pointing at it. A 422 here means the branch already exists —
  //    which is a real state worth naming, not a generic failure.
  const ref = await githubFetch<{ ref: string }>(
    credentials,
    `/repos/${input.repo}/git/refs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ref: `refs/heads/${input.newBranch}`,
        sha: commit.data.sha,
      }),
    },
  );

  if (ref.error) {
    if (ref.status === 422) {
      return {
        commitSha: null,
        error: `A branch called "${input.newBranch}" already exists. Push again with a different name.`,
      };
    }
    return { commitSha: null, error: ref.error };
  }

  return { commitSha: commit.data.sha, error: null };
}

