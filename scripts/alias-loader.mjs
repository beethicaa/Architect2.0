/**
 * Resolves the `@/` path alias for plain Node, so `npm run env:check` can import
 * the real application modules instead of re-implementing their rules.
 *
 * Next and tsconfig both understand `@/* -> ./lib/*`; bare Node does not. This
 * keeps the check honest: if the alias ever stops resolving, env:check fails
 * loudly rather than quietly testing a stale copy of the logic.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(process.cwd() + "/").href;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = root + specifier.slice(2) + ext;
      if (existsSync(new URL(candidate))) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}