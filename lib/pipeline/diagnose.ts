/**
 * Work out which files are actually stopping the app from running.
 *
 * This exists because the repair button appeared to do nothing, and the reason
 * was a gap between two checks that were both correct on their own:
 *
 *   `validateSource` parses a file. Every one of the seven files in the broken
 *   project parsed cleanly, so the repair route computed an empty list of broken
 *   files, told the agent there was nothing to do, and the preview stayed broken
 *   through every click. The user saw a button that silently did nothing.
 *
 *   `checkImports` compares a file's imports against what its targets actually
 *   export. It was wired into the write path - so a *new* bad file is refused -
 *   but never into diagnosis, so *existing* bad data had no way out.
 *
 * Both are needed. Syntax catches a truncated file; imports catch the far more
 * common failure where the Interface Agent invents `getNotes` for a module that
 * exports `listNotes`. Neither alone is sufficient, and using only one is what
 * made the repair path a no-op.
 */

import { checkImports, exportedNames } from "@/lib/pipeline/exports";
import { validateSource } from "@/lib/pipeline/validate";

export interface Diagnosis {
  /** Files that must be rewritten, in dependency order (dependencies first). */
  broken: string[];
  /** One human-readable line per broken file, for the agent and for the panel. */
  reasons: string[];
}

/**
 * Diagnose a whole project.
 *
 * A file is reported when it fails to parse, or when it imports a name its
 * target does not export. `checkImports` needs the export list of every file in
 * the project, so the map is built once and reused - which also means a file
 * written earlier in the same run is visible to a later one.
 */
export async function diagnoseProject(
  files: { path: string; content: string }[],
): Promise<Diagnosis> {
  const available = new Map<string, string[]>();
  for (const file of files) available.set(file.path, exportedNames(file.content));

  // Every path in the project is "pending" for diagnosis purposes, because
  // diagnosis looks at the project as a whole: a file importing a sibling that
  // exists is correct, and treating it as a missing target would send the agent
  // to write a file that is already there.
  const pending = new Set(files.map((f) => f.path));

  const broken: string[] = [];
  const reasons: string[] = [];

  for (const file of files) {
    const parsed = await validateSource(file.path, file.content);
    if (!parsed.valid) {
      broken.push(file.path);
      reasons.push(`${file.path}: ${parsed.error}`);
      continue;
    }

    const importProblems = checkImports(file.path, file.content, available, pending);
    if (importProblems.length > 0) {
      broken.push(file.path);
      reasons.push(importProblems.join("\n"));
    }
  }

  return { broken, reasons };
}

/** Order files so a dependency is rewritten before whatever imports it. */
export function dependencyOrder(paths: string[], files: { path: string; content: string }[]): string[] {
  const imports = new Map<string, string[]>();
  for (const file of files) {
    const list: string[] = [];
    for (const match of file.content.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      const segments = file.path.split("/").slice(0, -1);
      for (const part of specifier.split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") segments.pop();
        else segments.push(part);
      }
      const base = segments.join("/");
      const target = [base, `${base}.tsx`, `${base}.ts`].find((c) =>
        files.some((f) => f.path === c),
      );
      if (target && target !== file.path) list.push(target);
    }
    imports.set(file.path, list);
  }

  const wanted = new Set(paths);
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (path: string, depth: number) => {
    if (seen.has(path) || depth > 20) return;
    seen.add(path);
    // Depth-first, dependencies first: rewriting lib/storage.ts before the
    // components that import it means the agent is not asked to reconcile two
    // files whose real contents it cannot both see.
    for (const dependency of imports.get(path) ?? []) {
      if (wanted.has(dependency)) visit(dependency, depth + 1);
    }
    if (wanted.has(path)) out.push(path);
  };

  for (const path of paths) visit(path, 0);
  return out;
}
