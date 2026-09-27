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
    agentRun: "planner -> researcher -> data_schema -> data_wiring -> interface - 5 agents - 18,220 tokens",
    screens: 4,
  },
  {
    id: "v3",
    label: "Saves as you go",
    createdAt: "2026-09-25T08:15:20.000Z",
    agentRun: "data_wiring -> interface - 2 agents - 24,900 tokens",
    screens: 4,
  },
  {
    id: "v4",
    label: "Reviewer's pass",
    createdAt: "2026-09-26T11:02:00.000Z",
    agentRun: "reviewer -> interface - 2 agents - 15,440 tokens",
    screens: 4,
  },
];

/**
 * Plain-language receipts.
 *
 * The receipt is the whole point of the simple lens: it is the one place a
 * non-technical user reads what an agent did, so it is written in the language
 * of the request rather than as a diffstat.
 *
 * These describe *the shape* of a build rather than one particular app. They used
 * to be written around a journalling example, which was a mistake on a marketing
 * page: a visitor who came to build something else reads "your journal went from
 * an empty folder" and concludes the product only does journals. The subject is
 * now the user's own app, referred to as "your app".
 */
const RECEIPTS: Record<string, { v1: string; v2: string; v3: string; v4: string }> = {
  journal: {
    v1: "Your app went from an empty folder to four screens you can click through.",
    v2: "Records can now be created and edited, with the fields checked before saving.",
    v3: "Nothing is lost if you close the tab. Your work is kept on this device and picked up where you left it.",
    v4: "A reviewer looked for ways to break it, and the interface agent fixed what it found before you had to ask.",
  },
  generic: {
    v1: "Your app went from an empty folder to four screens you can click through.",
    v2: "Records can now be created and edited, with the fields checked before saving.",
    v3: "Nothing is lost if you close the tab. Your work is kept on this device and picked up where you left it.",
    v4: "A reviewer looked for ways to break it, and the interface agent fixed what it found before you had to ask.",
  },
};

/**
 * The app kind, so the receipts can be written for the right subject.
 *
 * Only the builder's own timeline passes a prompt. The marketing page calls
 * `versionsFor()` with nothing, which returns the subject-neutral receipts -
 * a page for visitors who may be building anything must not read as though it
 * only builds journals.
 */
function kindOf(prompt: string): "journal" | "generic" {
  const text = prompt.toLowerCase();
  return /journal|diary|journall|gratitude/.test(text) ? "journal" : "generic";
}

/** The Time Machine timeline for a project. */
export function versionsFor(prompt = ""): Version[] {
  const receipts = RECEIPTS[kindOf(prompt)];
  const files = [
    "app/page.tsx",
    "lib/types/domain.ts",
    "supabase/migrations/0002_schema.sql",
  ];
  const summaries = [
    "4 screens - 3 tables - deployed",
    "3 screens changed - 1 library added",
    "1 screen changed - storage added",
    "1 flow reviewed - issues fixed",
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
