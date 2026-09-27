/**
 * Working out which source file a clicked element came from.
 *
 * The brief asks for "click any element, say what to change, and have the agents
 * update just that". The hard half of that is not the chat box, it is the step
 * from a DOM node to a file: React throws away the component that rendered an
 * element, and the preview is a bundle with no component tree to walk.
 *
 * There is no exact answer available in the browser, so this scores candidates
 * instead of claiming certainty. The scoring is deliberately *self-calibrating*:
 * a class name or a line of text is evidence in proportion to how rare it is
 * across the workspace. `bg-white` appearing in thirty files proves nothing;
 * `case-card` appearing in exactly one file is very strong evidence. That way
 * there is no list of "utility classes" to maintain, and no unusual naming
 * scheme can defeat it.
 *
 * Pure and dependency-free, so `npm run env:check` can exercise it directly.
 */

export interface ElementDescriptor {
  tag: string;
  /** The full class attribute as the browser reports it. */
  className?: string;
  /** Visible text, trimmed, capped by the caller. */
  text?: string;
  role?: string | null;
  /** Index path from the root, e.g. "0/2/1". Used only as a tiebreak. */
  path?: string;
}

export interface SourceFile {
  path: string;
  content: string;
}

/**
 * The utility class names the compiled stylesheet actually contains.
 *
 * This is the oracle the matcher needs, and it is free: the preview has already
 * run Tailwind over the project's own code, so the generated CSS is a complete and
 * exact list of which classes are *framework* classes. A class the stylesheet has
 * a rule for is a utility; a class it does not is the project's own.
 *
 * The first version of this tried to infer that from frequency — "a class in only
 * one file must be a project class" — and it was wrong about 60% of the useful
 * cases. In a real 53-file React workspace, 98 of 164 class tokens appeared in
 * exactly one file, and nearly all of them were Tailwind utilities that simply
 * were not used twice: `pt-4`, `border-t`, `whitespace-pre-wrap`. Maintaining a
 * list of utility names by hand would be worse still, and would rot the first time
 * Tailwind shipped a class I had not heard of.
 */
export interface UtilityIndex {
  has(name: string): boolean;
  size: number;
}

/** Build the index from the compiled stylesheet's class selectors. */
export function utilitiesFromCss(css: string): UtilityIndex {
  const names = new Set<string>();
  // `.foo`, `.foo:hover`, `.-mt-2`, `.w-1\/2` — everything the compiler emitted.
  for (const match of css.matchAll(/\.((?:\\.|[-\w])+)/g)) {
    const name = match[1].replace(/\\(.)/g, "$1");
    if (name) names.add(name);
  }
  return {
    has: (name) => names.has(name),
    size: names.size,
  };
}

/** An index that knows nothing, used when no stylesheet is available. */
const NO_UTILITIES: UtilityIndex = { has: () => false, size: 0 };

export interface ElementMatch {
  path: string;
  score: number;
  /** Short, human-readable reasons, so the UI can say why it chose this file. */
  because: string[];
}

const MIN_TOKEN = 4;

/** Files that can render an element at all. */
const RENDERABLE = /\.(tsx|jsx|ts|js|html)$/i;

/** Text too common to be evidence of anything. */
const GENERIC_TEXT = new Set([
  "", "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "click", "edit", "delete", "add", "save", "cancel", "close", "open", "back",
  "next", "submit", "loading", "error", "home", "more", "less", "yes", "no",
  "new", "all", "none", "search", "settings", "profile", "logout", "login",
]);

function normalise(value: string | undefined | null): string {
  return (value ?? "").toLowerCase();
}

function classTokens(className: string | undefined): string[] {
  return (className ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN);
}

/** How many files contain this token. */
function occurrences(token: string, files: SourceFile[]): number {
  let count = 0;
  for (const file of files) {
    if (file.content.toLowerCase().includes(token)) count += 1;
  }
  return count;
}

/**
 * Rank the files that could have rendered a clicked element.
 *
 * The bar here is deliberately high, and the reasoning is worth recording
 * because the first version got it wrong. Scoring shared class names produced two
 * confidently incorrect answers against a real repository: a nav tab matched a
 * random component because both used `px-4 py-2`, and a table row matched a
 * stylesheet. Frequency alone cannot separate a project class from a Tailwind
 * utility, because a utility used twice is "rare" by the same measure as a
 * project's only class.
 *
 * So only *exclusive* evidence counts: a class that appears in exactly one file,
 * or a distinctive run of text that appears in exactly one file. Anything weaker
 * is discarded rather than ranked, and the caller shows the alternatives and asks.
 * Returning the wrong file confidently is far worse than returning none, because
 * the agent then rewrites code the user never pointed at.
 */
export function matchElementToFiles(
  element: ElementDescriptor,
  files: SourceFile[],
  utilities: UtilityIndex = NO_UTILITIES,
): ElementMatch[] {
  if (files.length === 0) return [];

  const text = normalise(element.text).replace(/\s+/g, " ").trim();

  // Distinctive text: long enough to mean something, and not a button label.
  const textIsEvidence =
    text.length >= 4 && !GENERIC_TEXT.has(text) && !/^[0-9.,%$#\s-]+$/.test(text);

  const candidates = new Map<string, { score: number; because: string[] }>();

  const add = (path: string, score: number, reason: string) => {
    const entry = candidates.get(path) ?? { score: 0, because: [] };
    entry.score += score;
    entry.because.push(reason);
    candidates.set(path, entry);
  };

  // Only files that can render an element are candidates at all. A stylesheet or
  // a manifest never drew the thing the user clicked.
  //
  // There is deliberately no fallback to `files` when nothing is renderable: a
  // workspace of nothing but CSS has no answer, and returning the stylesheet
  // would be a confident non-answer. The first version fell back, and the check
  // written for this caught it immediately.
  const pool = files.filter((file) => RENDERABLE.test(file.path));
  if (pool.length === 0) return [];

  for (const token of classTokens(element.className)) {
    // A class the stylesheet has a rule for is a Tailwind utility, and utilities
    // are shared across the whole app. They carry no information about which file
    // drew this element. Only the project's own class names are evidence.
    if (utilities.has(token)) continue;

    const needle = normalise(token);
    const owner = pool.find((f) => f.content.toLowerCase().includes(needle));
    if (!owner) continue;

    // Exclusive only. See the note above on why "shared" is not evidence.
    if (occurrences(needle, pool) === 1) {
      add(owner.path, 60, `the class "${token}" appears only in this file`);
    }
  }

  if (textIsEvidence) {
    const owner = pool.find((f) => f.content.toLowerCase().includes(text));
    if (owner && occurrences(text, pool) === 1) {
      add(owner.path, 45, `the text "${truncate(text)}" appears only in this file`);
    }
  }

  return [...candidates.entries()]
    .map(([path, entry]) => ({ path, score: entry.score, because: entry.because }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/**
 * The single best file, or null when nothing cleared the bar.
 *
 * A tie at the top counts as no answer. Guessing wrong sends the agent to rewrite
 * the wrong file, which is worse than asking.
 */
export function bestFileFor(
  element: ElementDescriptor,
  files: SourceFile[],
  utilities: UtilityIndex = NO_UTILITIES,
): ElementMatch | null {
  const ranked = matchElementToFiles(element, files, utilities);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0];
}

function truncate(value: string, max = 40): string {
  return value.length <= max ? value : value.slice(0, max - 1) + "…";
}
