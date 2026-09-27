/**
 * A short id for the running build.
 *
 * Hashed over every source file, not from a timestamp.
 *
 * The first version read the mtime of one file - this one. That was wrong in a
 * way that mattered: the id only changed when the *footer* was edited, so
 * every fix anywhere else in the app left the id frozen. A stale server and a
 * current one showed the same label, which is precisely the ambiguity this
 * exists to remove. A signal that does not move when the thing you care about
 * moves is worse than none, because it looks like evidence.
 *
 * Reading all sources at module load is fine here: it happens once per server
 * start, and a dev server must be restarted to pick up a change anyway.
 *
 * Why it is worth having at all: a long stretch of "I fixed it, and you are
 * still seeing the old thing" turned out to be an un-restarted dev server. With
 * no signal on the page, that and a fix that did not work are indistinguishable
 * from the outside.
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components", "lib", "hooks"];
const SKIP = new Set(["node_modules", ".next", ".git", "public", "scripts"]);

function collect(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
    } else if (/\.(tsx?|css|sql)$/.test(entry.name)) {
      try {
        out.push(`${entry.name}:${statSync(full).mtimeMs}`);
      } catch {
        // A file that vanished mid-walk is simply not part of this build.
      }
    }
  }
}

function stamp(): string {
  // `process.cwd()` is the project root under `next dev` and `next start`.
  // If any of this fails the id degrades to "dev" rather than taking the whole
  // app down over a diagnostic label.
  try {
    const files: string[] = [];
    for (const root of ROOTS) collect(join(process.cwd(), root), files);
    files.push(`env:${process.env.NEXT_PUBLIC_SITE_URL ?? ""}`);
    return createHash("sha1").update(files.sort().join("|")).digest("hex").slice(0, 5);
  } catch {
    return "dev";
  }
}

export const BUILD_ID = stamp();
