/**
 * MOCK: Time Machine — the build timeline with rollback.
 *
 * The original addition beyond the assignment's feature list, chosen because the
 * #1 reason people abandon agentic builders is *"I don't trust what it just did
 * and I can't undo it."* Prompting again is the only recovery today, which is
 * exactly when trust disappears.
 *
 * It is also the clearest expression of the 2.0 thesis — one feature, two
 * readings:
 *   Simple    — "Go back to before it looked like this."
 *   Developer — the agent run, the files it touched, a revert that maps to a commit.
 *
/**
 * MOCK: Time Machine - the build timeline with rollback.
 *
 * The original addition beyond the assignment's feature list, chosen because the
 * #1 reason people abandon agentic builders is *"I don't trust what it just did
 * and I can't undo it."*
 *
 * It is also the clearest expression of the 2.0 thesis - one feature, two
 * readings:
 *   Simple    - "Go back to before it looked like this."
 *   Developer - the agent run, the files it touched, a revert that maps to a commit.
 *
 * Justification is also in docs/product-vision.md and lib/mock/README.md.
 *
 * Still a mock: the checkpoints below are illustrative. The real rollback data
 * is the version column on project_files, which the agent increments on every
 * write - see lib/agent/tools.ts.
 */

import type { Version } from "@/lib/types/domain";

const BASE: Omit<Version, "files" | "receipt" | "summary">[] = [
  {
    id: "v1",
    label: "First working version",
    createdAt: "2026-09-24T12:06:09.000Z",
    agentRun: "run_2026_09_24_01 - 8 steps - 31,940 tokens",
    screens: 4,
  },
  {
    id: "v2",
    label: "Second pass",
    createdAt: "2026-09-24T12:41:55.000Z",
    agentRun: "run_2026_09_24_02 - 4 steps - 18,220 tokens",
    screens: 4,
  },
  {
    id: "v3",
    label: "Sign in with Google",
    createdAt: "2026-09-25T08:15:20.000Z",
    agentRun: "run_2026_09_25_01 - 6 steps - 24,900 tokens",
    screens: 4,
  },
  {
    id: "v4",
    label: "Scheduled follow-up",
    createdAt: "2026-09-26T11:02:00.000Z",
    agentRun: "run_2026_09_26_01 - 5 steps - 15,440 tokens",
    screens: 4,
  },
];

/**
 * Plain-language receipts.
 *
 * The receipt is the whole point of the simple lens: it is the one place a
 * non-technical user reads what an agent did, so it is written in the language
 * of the request rather than as a diffstat.
 */
const RECEIPTS: Record<string, { v1: string; v2: string; v3: string; v4: string }> = {
  journal: {
    v1: "Your journal went from an empty folder to four screens you can click through.",
    v2: "Entries can now be saved with a date and a mood, instead of typed in by hand. Both are checked before saving.",
    v3: "People can now sign in with Google. Entries only show for the person who wrote them.",
    v4: "A gentle reminder arrives each evening. It is sent by a scheduled job, not by the app you are using.",
  },
  generic: {
    v1: "Your app went from an empty folder to four screens you can click through.",
    v2: "Records can now be created and edited, with the fields checked before saving.",
    v3: "People can now sign in with Google. Records only show for the person who owns them.",
    v4: "A scheduled job handles the routine work, so the app stays quick when you use it.",
  },
};

/** The app kind, so the receipts can be written for the right subject. */
function kindOf(prompt: string): "journal" | "generic" {
  const text = prompt.toLowerCase();
  return /journal|diary|journall|gratitude/.test(text) ? "journal" : "generic";
}

/** The Time Machine timeline for a project. */
export function versionsFor(prompt: string): Version[] {
  const receipts = RECEIPTS[kindOf(prompt)];
  const files = [
    "app/page.tsx",
    "lib/types/domain.ts",
    "supabase/migrations/0002_schema.sql",
  ];
  const summaries = [
    "4 screens - 3 tables - deployed",
    "3 screens changed - 1 library added",
    "2 screens changed - 1 data model changed",
    "1 new flow - 1 background job",
  ];

  return BASE.map((version, index) => ({
    ...version,
    receipt: receipts[version.id as keyof typeof receipts],
    summary: summaries[index],
    files: index === 0 ? files : index === 1 ? files.slice(0, 2) : files.slice(-1),
  }));
}

/** What the simple lens sees in the timeline's restore button. */
export const RESTORE_COPY = {
  simple: "Go back to this",
  developer: "Revert to this commit",
} as const;

export function versionById(id: string, prompt: string): Version | undefined {
  return versionsFor(prompt).find((version) => version.id === id);
}
