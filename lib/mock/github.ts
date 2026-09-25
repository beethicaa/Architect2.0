/**
 * MOCK: GitHub connect, repo picker, commit history.
 *
 * The one integration in the product that is *still* a mock, and deliberately
 * so: wiring the real GitHub OAuth flow and push API is a separate piece of
 * work from proving the agent, and claiming otherwise would be a lie.
 *
 * The payloads are shaped like the real API's (full_name, default_branch, sha,
 * authored_at) so a reviewer can see this is an integration waiting for a token
 * rather than a UI drawn around nothing. See docs/real-vs-dummy.md.
 */

import type { GitHubCommit, GitHubRepo } from "@/lib/types/domain";

export const GITHUB_ACCOUNT = {
  login: "relie",
  name: "Beethica Rath",
  /** scopes the connect screen asks for, in plain English for each lens */
  scopes: [
    { scope: "repo", why: "Read the repository you import and push your changes." },
    { scope: "read:user", why: "Show your name next to commits and in the team list." },
    { scope: "workflow", why: "Let a deploy start when a branch changes." },
  ],
  connectedAt: "2026-09-18T09:20:00.000Z",
};

/**
 * The repositories a developer could import.
 *
 * Deliberately fixed, and deliberately varied: one private product repo, one
 * public personal site, one non-TypeScript service, one throwaway spike. A repo
 * picker showing six identical Next.js starters would prove nothing about the
 * flow. These have nothing to do with any prompt.
 */
export const GITHUB_REPOS: GitHubRepo[] = [
  {
    id: "r1",
    fullName: "relie/clinic-booking",
    description: "Patient booking for Northside Clinic",
    language: "TypeScript",
    private: true,
    updatedAt: "2026-09-22T14:02:00.000Z",
    stars: 3,
    defaultBranch: "main",
  },
  {
    id: "r2",
    fullName: "relie/portfolio-site",
    description: "Personal site, Next.js App Router",
    language: "TypeScript",
    private: false,
    updatedAt: "2026-09-11T18:44:00.000Z",
    stars: 12,
    defaultBranch: "main",
  },
  {
    id: "r3",
    fullName: "acme/orders-service",
    description: "Internal orders API (Node + Postgres)",
    language: "JavaScript",
    private: true,
    updatedAt: "2026-08-30T08:10:00.000Z",
    stars: 41,
    defaultBranch: "develop",
  },
  {
    id: "r4",
    fullName: "relie/scratchpad",
    description: "Spike: agent graph layout experiments",
    language: "TypeScript",
    private: true,
    updatedAt: "2026-07-02T11:00:00.000Z",
    stars: 0,
    defaultBranch: "main",
  },
];


/**
 * Commit history for a project the agent built.
 *
 * The repo *list* above is fixed because it describes the developer's real
 * accounts. This one is a fixed sample of the shape a real push would take - it
 * is part of the mocked GitHub integration, not something read from history.
 */
export const AGENT_COMMITS: GitHubCommit[] = [
  {
    sha: "9f3ca21b",
    message: "feat: app/page.tsx - first working screen",
    author: "Interface Agent",
    authoredAt: "2026-09-24T12:05:20.000Z",
    byAgent: true,
    agentName: "ui",
    filesChanged: 14,
  },
  {
    sha: "7b21e0c4",
    message: "fix: validate input before saving",
    author: "Reviewer",
    authoredAt: "2026-09-24T12:06:02.000Z",
    byAgent: true,
    agentName: "review",
    filesChanged: 1,
  },
  {
    sha: "3d5aa890",
    message: "chore: scaffold data model with RLS",
    author: "Data Agent",
    authoredAt: "2026-09-24T12:04:41.000Z",
    byAgent: true,
    agentName: "schema",
    filesChanged: 2,
  },
  {
    sha: "1a04ffde",
    message: "initial commit",
    author: "Beethica Rath",
    authoredAt: "2026-08-02T10:12:00.000Z",
    byAgent: false,
    filesChanged: 22,
  },
];

/** Kept for callers that passed a prompt; the sample no longer varies by app. */
export function commitsFor(): GitHubCommit[] {
  return AGENT_COMMITS;
}


/** A deterministic preview branch name for a project. */
export function previewBranch(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `architect/${slug || "preview"}`;
}

/** The fake Vercel URL a deploy "lands" on. */
export function deploymentUrl(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("-")
    .slice(0, 28);
  return `https://${slug || "app"}.vercel.app`;
}
