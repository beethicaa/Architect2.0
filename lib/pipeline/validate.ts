/**
 * Parse a generated file before it is written.
 *
 * Split into its own module for one concrete reason: it must be runnable by
 * `npm run env:check` as a standalone probe, and `workspace.ts` imports the
 * Supabase server client, which cannot be loaded outside a Next request. A check
 * nobody can run is a check nobody runs.
 *
 * The failure this prevents: a response cut off by the token ceiling still
 * produced an invalid file, which was written anyway and surfaced as a blank
 * preview with `Expected ">" but found end of file`. The agent never found out,
 * because nothing told it. Rejecting here turns that into a message the agent
 * can act on — it is given the exact line and writes the file again.
 */

import { transform } from "esbuild";

/** Languages esbuild can parse. Anything else is accepted unchecked. */
const PARSED_LANGUAGES = new Set(["ts", "tsx", "js", "jsx"]);

function loaderFor(path: string): "tsx" | "ts" | "jsx" | "js" | null {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  return null;
}

export async function validateSource(
  path: string,
  content: string,
  options: { inlineStyles?: "reject" | "warn" } = {},
): Promise<{ valid: true; warning?: string } | { valid: false; error: string }> {
  const loader = loaderFor(path);
  // CSS, markdown, SQL and JSON cannot be truncated into a syntax error that
  // matters here, and esbuild has no loader for several of them anyway.
  if (!loader || !PARSED_LANGUAGES.has(loader)) return { valid: true };

  // Inline styles instead of the utility classes the preview compiles.
  //
  // The preview builds its CSS by scanning the files for Tailwind classes. A
  // file written with `style={{ ... }}` therefore contributes no CSS at all, and
  // the result is a seven-line "app" that renders unstyled - which is exactly
  // what a build produced:
  //
  //     <div style={{ minHeight: '100vh', backgroundColor: '#0F172A' }}>
  //       <h1 style={{ fontSize: '2rem' }}>Welcome</h1>
  //
  // It parses perfectly, so the syntax check passed it. But the prompt requires
  // Tailwind, the styles do not exist in the compiled stylesheet, and the screen
  // comes out looking like an unstyled document. Rejecting it sends the model
  // back to use the classes it was told to use.
  //
  // `mode` exists because that reasoning only applies to code the model just
  // wrote. An imported repository is the user's own work, and it is not the
  // agent's to rewrite. Refusing it there swapped fourteen working components for
  // stubs and filled the panel with fourteen near-identical warnings — the user
  // lost their whole screen to a rule written for generated files. So the
  // default depends on the caller: `reject` for the agent's own output, `warn`
  // for a preview of something that already exists.
  const inline = findInlineStyle(path, content);
  if (inline) {
    // `warn` is for a preview of code that already exists, where refusing the
    // file would replace working UI with a placeholder.
    if (options.inlineStyles === "warn") return { valid: true, warning: inline };
    return { valid: false, error: inline };
  }

  try {
    await transform(content, {
      loader,
      jsx: "automatic",
      // A parse, not a build. Keeping it to a single transform makes it cheap
      // enough to run on every write, and an import that does not resolve yet is
      // not mistaken for a syntax error.
    });
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `${path}: ${tidy(message)}` };
  }
}

/**
 * Reject hand-written inline styles in a UI file.
 *
 * Only JSX component files are checked. A `style` object is legitimate in a
 * computed position (an element's height, a transform driven by state), so this
 * is a soft rule with a soft target: it fires on `style={{` because that is the
 * shape a model reaches for when it is not really building a screen, not on the
 * rarer `style={someVariable}`.
 */
function findInlineStyle(path: string, content: string): string | null {
  if (!path.endsWith(".tsx") && !path.endsWith(".jsx")) return null;
  if (!content.includes("style={{")) return null;

  return (
    `${path} uses inline styles (style={{...}}). The preview compiles Tailwind from ` +
    `the class names in your code, and an inline style contributes no CSS at all, so the ` +
    `screen will render unstyled. Replace every style={{...}} with Tailwind utility classes.`
  );
}

/**
 * esbuild's errors are good but verbose: a location header, a line, a caret and
 * a code frame. The model needs the sentence and the line number, not the art.
 */
function tidy(message: string): string {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}
