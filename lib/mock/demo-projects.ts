/**
 * MOCK: demo projects for the dashboard when Supabase is not configured.
 *
 * These are `Project` rows in the exact shape the database returns, so the
 * dashboard renders one code path whether the data is real or not — the only
 * difference is the "Demo" labelling in the page. A shape mismatch here would
 * mean the real dashboard only worked with a database, which is a lie about
 * what was built.
 *
 * Ids are readable on purpose: they are stable, so a reviewer can follow a
 * project into the builder and back out again.
 */

import type { Project } from "@/lib/supabase/types";

const NOW = Date.parse("2026-09-26T11:02:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

export const DEMO_PROJECTS: Project[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "demo-user",
    name: "Clinic booking",
    description:
      "Patients pick a day and time; the clinic gets an email for each appointment.",
    prompt:
      "A booking app for my clinic where patients pick a day and time, and I get an email for each appointment.",
    origin: "prompt",
    repo_full_name: null,
    repo_branch: "main",
    framework: "Next.js",
    visibility: "private",
    share_token: null,
    status: "deployed",
    accent: "volt",
    last_opened_at: daysAgo(0.2),
    created_at: daysAgo(12),
    updated_at: daysAgo(0.2),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: "demo-user",
    name: "Orders service",
    description: "Existing Node + Postgres orders API, imported to keep shipping on it.",
    prompt: null,
    origin: "import",
    repo_full_name: "acme/orders-service",
    repo_branch: "main",
    framework: "Next.js",
    visibility: "private",
    share_token: null,
    status: "building",
    accent: "volt",
    last_opened_at: daysAgo(1),
    created_at: daysAgo(6),
    updated_at: daysAgo(1),
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    owner_id: "demo-user",
    name: "Support inbox",
    description:
      "A shared inbox for three support agents, with a draft assistant that never sends without approval.",
    prompt:
      "A support inbox for my team where an assistant drafts replies but a person always presses send.",
    origin: "prompt",
    repo_full_name: null,
    repo_branch: "main",
    framework: "Next.js",
    visibility: "private",
    share_token: null,
    status: "ready",
    accent: "volt",
    last_opened_at: daysAgo(3),
    created_at: daysAgo(9),
    updated_at: daysAgo(3),
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    owner_id: "demo-user",
    name: "Portfolio site",
    description: "Personal site imported from a repository two years old and still in use.",
    prompt: null,
    origin: "import",
    repo_full_name: "relie/portfolio-site",
    repo_branch: "main",
    framework: "Next.js",
    visibility: "private",
    share_token: null,
    status: "draft",
    accent: "volt",
    last_opened_at: daysAgo(8),
    created_at: daysAgo(8),
    updated_at: daysAgo(8),
  },
];
