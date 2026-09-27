/**
 * What a generated file actually exports, and what its importers ask for.
 *
 * This exists because of a concrete failure, and it was not a syntax error:
 *
 *   The Data Agent wrote `lib/storage.ts` exporting
 *     addNote, addSubject, deleteNote, deleteSubject, listNotes, listSubjects,
 *     updateNote
 *
 *   The Interface Agent then wrote four components importing
 *     getNotes, setNotes, getQuizzes, setQuizzes, getSubjects, Note, Quiz,
 *     generateQuiz, generateFlashcards
 *
 *   The build failed with fourteen "No matching export" errors and the preview
 *   could not run. The Interface Agent had **guessed** the API: the hand-off
 *   between the two agents said only "wrote lib/storage.ts" — it never said what
 *   that file exported, so the next agent invented names.
 *
 * So the contract between agents is now carried explicitly. What each file
 * exports is extracted when it is written, handed to the next agent, and an
 * import of a name nobody exports is rejected at write time rather than
 * surfacing later as a dead preview.
 *
 * Pure and dependency-free, so `npm run env:check` can exercise it directly.
 */

const DECLARATION =
  /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

/** `export { a, b as c }`. */
const LISTED = /export\s*\{([^}]*)\}/g;

/** `export default function Thing()`. */
const DEFAULT_NAMED = /export\s+default\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g;

/**
 * `export default Thing;` - the other common form.
 *
 * This is the single most important line in the file for correctness rather than
 * completeness. A file written as `function SubjectList() {}` followed by
 * `export default SubjectList;` is completely idiomatic, and missing this form
 * made the import checker report every `import Foo from "./Foo"` as an unknown
 * export - which would have rejected valid code.
 */
const DEFAULT_IDENTIFIER = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/g;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The `@/` and `@app/` aliases. Models use them constantly, and they resolve
 * from the project root rather than the importing file. */
const ALIAS_PREFIXES = ["@/", "@app/"];

/**
 * Folders that mean "the project's own source" when they appear at the start of
 * a bare specifier.
 *
 * Models write `from "lib/storage"` and `from "app/components/TripCard"` as
 * readily as they write a relative path, treating the project root as a package
 * root. Those imports were being skipped entirely by the checker - a bare
 * specifier was assumed to be a dependency - so a page could import a component
 * that did not exist, and a guess at a function name went unchecked. Both were
 * saved, and the app rendered with `undefined` components.
 *
 * The prefixes are deliberately narrow. A real package name never starts with
 * "app/" or "lib/", so nothing that is genuinely installable is captured here.
 */
const PROJECT_ROOTS = ["app/", "lib/", "components/", "src/", "pages/"];

/** True when a file re-exports everything from another module. */
export function hasStarReExport(content: string): boolean {
  return /export\s+\*\s+from/.test(content);
}

/**
 * Packages the preview can actually run.
 *
 * This list is short on purpose. The preview bundles from this app's own
 * `node_modules`, so a generated file may only import something genuinely
 * present there. The model does not respect that, and the failure is invisible
 * until runtime:
 *
 *     import { format } from "date-fns";     // not installed
 *
 * resolves to an empty stub, `format(...)` returns undefined, React throws
 * during render, and the user gets a blank white screen with no message. The
 * code around it was fine - the project even had four complete files - and the
 * whole thing died on one import.
 *
 * So it is refused at write time with the fix attached, rather than discovered
 * as a blank page. Formatting dates, generating ids and linking routes all have
 * plain-JavaScript answers, and the agent knows them.
 */
const ALLOWED_PACKAGES = new Set(["react", "react-dom", "react/jsx-runtime"]);

const PACKAGE_ADVICE: Record<string, string> = {
  "date-fns":
    "format dates with the built-in Intl API: new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(iso)).",
  dayjs: "use the built-in Intl.DateTimeFormat instead.",
  moment: "use the built-in Intl.DateTimeFormat instead.",
  lodash: "use plain JavaScript - map, filter, reduce and Object.entries cover almost everything.",
  uuid: "generate an id with crypto.randomUUID(), or Date.now().toString(36) if that is unavailable.",
  "next/link": "use a plain <a href=...> element. This is a standalone preview, not a Next.js app.",
  "next/image": "use a plain <img> element.",
  "next/navigation": "this is a standalone preview with no router; use React state to switch views.",
  recharts: "draw charts with plain SVG elements, or lay the data out as a simple bar or list.",
  "chart.js": "draw charts with plain SVG elements.",
  "@heroicons/react": "use inline SVG or a text label instead of an icon package.",
  "lucide-react": "use inline SVG or a text label instead of an icon package.",
  clsx: "build the class string with a template literal and a plain conditional.",
};

/** Bare (non-relative, non-project) imports a file requires, minus the allowed set. */
export function disallowedPackages(content: string): string[] {
  const bad = new Set<string>();
  for (const match of content.matchAll(IMPORT_FROM)) {
    const specifier = match[2];
    if (specifier.startsWith(".")) continue;
    if (isProjectSpecifier(specifier)) continue;
    if (ALLOWED_PACKAGES.has(specifier)) continue;
    // A subpath of an allowed package, e.g. react/jsx-runtime.
    if ([...ALLOWED_PACKAGES].some((pkg) => specifier.startsWith(pkg + "/"))) continue;
    bad.add(specifier);
  }
  return [...bad].sort();
}

/** The sentence handed back to the agent for each forbidden package. */
export function packageAdvice(names: string[]): string {
  return names
    .map((name) => {
      const key = Object.keys(PACKAGE_ADVICE).find(
        (pkg) => name === pkg || name.startsWith(pkg + "/"),
      );
      return key
        ? `${name} is not available in this preview. ${PACKAGE_ADVICE[key]}`
        : `${name} is not available in this preview. Only "react" and "react-dom" are. ` +
          `Rewrite that part with plain JavaScript - no import.`;
    })
    .join(" ");
}


/**
 * Every name a module makes available to an importer.
 *
 * A `export * from` yields "*", which callers treat as "cannot verify" — being
 * unable to check a re-export is not the same as the import being wrong, and
 * inventing an error there would reject valid code.
 */
export function exportedNames(content: string): string[] {
  const names = new Set<string>();

  // `export default function NotesSection() {}` exports `default`. The name
  // `NotesSection` is only that function's local binding - it is NOT a named
  // export, and `import { NotesSection }` from it fails to link.
  //
  // This was a real, silent hole. The declaration pattern matched the name and
  // recorded it as an export, so the import checker approved files that esbuild
  // then rejected with "No matching export ... for import NotesSection" - the
  // guard reported a clean build on a build that could not possibly link. Every
  // React component written the idiomatic way was invisible to it.
  const defaultName = (match: RegExpExecArray | null): string | null =>
    match ? match[1] : null;

  const defaultNamed = DEFAULT_NAMED.exec(content);
  DEFAULT_NAMED.lastIndex = 0;
  const defaultIdentifier = DEFAULT_IDENTIFIER.exec(content);
  DEFAULT_IDENTIFIER.lastIndex = 0;
  const hidden = new Set(
    [defaultName(defaultNamed), defaultName(defaultIdentifier)].filter(
      (name): name is string => Boolean(name),
    ),
  );

  for (const match of content.matchAll(DECLARATION)) {
    if (!IDENTIFIER.test(match[1])) continue;
    if (hidden.has(match[1])) continue;
    names.add(match[1]);
  }
  for (const match of content.matchAll(LISTED)) {
    for (const part of match[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      // `a as b` — the module exports `a`; `b` is only the local alias.
      const source = cleaned.split(/\s+as\s+/)[0].trim();
      if (IDENTIFIER.test(source)) names.add(source);
    }
  }
  if (defaultNamed || defaultIdentifier) names.add("default");
  if (hasStarReExport(content)) names.add("*");

  return [...names].sort();
}

/** A relative import as it appears in source. */
export interface ImportRef {
  /** The specifier exactly as written, e.g. "./components/Header". */
  specifier: string;
  /** Named bindings requested, with aliases resolved to the source name. */
  names: string[];
  /** True when a default binding was requested. */
  wantsDefault: boolean;
  /** `import * as X` — nothing specific is required of the module. */
  namespace: boolean;
}

/** True for a specifier the platform resolves itself, rather than node_modules. */
export function isProjectSpecifier(specifier: string): boolean {
  if (specifier.startsWith(".")) return true;
  if (ALIAS_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return true;
  return PROJECT_ROOTS.some((root) => specifier.startsWith(root));
}

/**
 * Every relative or bare import in a file, as `from "..."` clauses.
 *
 * Shared by the relative checker and the package checker so the two cannot
 * disagree about what counts as an import.
 */
const IMPORT_FROM = /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /import\s*["']([^"']+)["']/g;

/** Every relative import in a file, with the bindings it asks for. */
export function relativeImports(content: string): ImportRef[] {
  const out: ImportRef[] = [];

  for (const match of content.matchAll(IMPORT_FROM)) {
    const specifier = match[2];
    if (!isProjectSpecifier(specifier)) continue;

    const clause = match[1];
    const names: string[] = [];
    let wantsDefault = false;
    let namespace = false;

    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const cleaned = part.trim().replace(/^type\s+/, "");
        if (!cleaned) continue;
        const source = cleaned.split(/\s+as\s+/)[0].trim();
        if (IDENTIFIER.test(source)) names.push(source);
      }
    }

    const beforeBrace = braces ? clause.slice(0, clause.indexOf("{")) : clause;
    if (/\*\s+as\s/.test(beforeBrace)) namespace = true;
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(beforeBrace.trim())) wantsDefault = true;

    out.push({ specifier, names, wantsDefault, namespace });
  }

  // A side-effect import has no `from` clause, so the first pattern cannot see
  // it. It requires no bindings, but the target still has to exist.
  for (const match of content.matchAll(BARE_IMPORT)) {
    if (isProjectSpecifier(match[1])) {
      out.push({ specifier: match[1], names: [], wantsDefault: false, namespace: false });
    }
  }

  return out;
}

/**
 * Resolve a project specifier to its base path.
 *
 * `./x` is relative to the importing file; `@/x` is absolute from the project
 * root. They are handled separately because getting that wrong turns every alias
 * import into a path that does not exist - and an unresolved import becomes an
 * empty module, so the component arrives at render time as `undefined` and React
 * reports "element type is invalid" with nothing pointing at the real cause.
 */
export function resolveProjectPath(importer: string, specifier: string): string | null {
  const [rawPath] = specifier.split("?");

  for (const prefix of ALIAS_PREFIXES) {
    if (rawPath.startsWith(prefix)) return rawPath.slice(prefix.length) || null;
  }
  // A bare project path is already absolute from the root, so it is used as-is.
  if (PROJECT_ROOTS.some((root) => rawPath.startsWith(root))) return rawPath;
  if (!rawPath.startsWith(".")) return null;

  const segments = importer.split("/").slice(0, -1);
  for (const part of rawPath.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/") || null;
}

/** The candidate paths a relative specifier could resolve to, in bundler order. */
export function resolveCandidates(importer: string, specifier: string): string[] {
  const base = resolveProjectPath(importer, specifier);
  if (!base) return [];
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
}

/**
 * Check one file's relative imports against what its targets actually export,
 * and against what actually exists.
 *
 * `available` maps a resolved project path to that file's exported names.
 *
 * The existence check is the important half, and it was missing. The Interface
 * Agent writes a page and its components in one response, and it routinely
 * imported a component it had not yet produced:
 *
 *     import TripCard from "app/components/TripCard";   // never written
 *
 * A missing import is not a warning - it compiles to an empty module, the
 * component arrives as `undefined`, and the app renders blank or throws
 * "element type is invalid". Worse, the model reacts to not knowing the storage
 * API by writing probe code:
 *
 *     const maybeGetter = (storage as any).getTravelPlans;
 *     if (typeof maybeGetter === "function") { ... }
 *
 * which is both broken and unreadable. So a file importing something that does
 * not exist is refused, and the agent is told to write the target first.
 *
 * `pending` is the set of paths the same turn is about to create. Those are
 * allowed, because the order within a response is not a guarantee but the set of
 * files is.
 */
export function checkImports(
  path: string,
  content: string,
  available: Map<string, string[]>,
  pending?: Set<string>,
): string[] {
  const problems: string[] = [];

  for (const reference of relativeImports(content)) {
    const candidates = resolveCandidates(path, reference.specifier);
    if (candidates.length === 0) continue;

    const target =
      candidates.find((c) => available.has(c)) ?? candidates[0];

    if (!available.has(target)) {
      // Written elsewhere in this same response: allowed. Every candidate is
      // checked, not just the bare one - `pending` holds "app/components/X.tsx"
      // while the resolved target is "app/components/X", so comparing only the
      // bare form would reject a file that is legitimately on its way.
      if (pending && candidates.some((c) => pending.has(c))) continue;

      problems.push(
        `${path} imports ${target}, which does not exist. ` +
          `Either write ${target} first, or remove that import. ` +
          `Only import files listed under FILES THAT EXIST SO FAR, plus files you create in this same response.`,
      );
      continue;
    }

    const exports = available.get(target)!;
    // A re-exporting module cannot be verified, and a namespace import takes
    // whatever it likes. Neither is evidence of a mistake.
    if (exports.includes("*") || reference.namespace) continue;

    const missing = reference.names.filter((name) => !exports.includes(name));
    if (reference.wantsDefault && !exports.includes("default")) missing.push("default");
    if (missing.length === 0) continue;

    const real = exports.filter((name) => name !== "*");
    problems.push(
      `${path} imports { ${missing.join(", ")} } from ${target}, but that file does not export them. ` +
        `It exports: ${real.join(", ") || "nothing"}. ` +
        `Use those exact names, or read ${target} first, or define the missing function inside ${path}. ` +
        `Never guess at the API and never probe for it with a typeof check - ` +
        `use the names listed in the summary above.`,
    );
  }

  return problems;
}

