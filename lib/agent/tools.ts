/**
 * The agent's tools.
 *
 * This is the part that makes Architect an agent rather than a completion. The
 * model does not return an app as a string; it returns *tool calls*, this
 * module executes them against the project's real file table, and the results
 * are fed back so the model can look at what it just wrote and correct itself.
 *
 * The same loop an AI coding assistant runs:
 *
 *     model  ->  "I'll write app/page.tsx and app/list.tsx"
 *     tools  ->  two rows land in project_files
 *     model  ->  "let me read app/page.tsx and check the handler"
 *     ...     ->  repeat until the model calls finish
 *
 * Every tool is narrow and boring on purpose. `write_file` is an upsert, not a
 * shell, so a mistake costs one row and the previous version is still readable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WriteBlock } from "@/lib/agent/protocol";
import type { ToolSpec } from "@/lib/agent/provider";
import type { Database } from "@/lib/supabase/types";

type ProjectFileRow = Database["public"]["Tables"]["project_files"]["Row"];

/** Folders the agent may write into. Anything else is rejected. */
const ALLOWED_ROOTS = [
  "app",
  "src",
  "public",
  "supabase",
  "components",
  "lib",
  "db",
  "api",
];

/** Extensions the agent may write. Keeps arbitrary uploads out. */
const ALLOWED_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md", ".sql", ".txt", ".svg",
];

export interface FileRecord {
  path: string;
  content: string;
  language: string;
  /** Lines before this write, for a real +/- count. */
  prevLines: number;
  version: number;
}

export function languageOf(path: string): string {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".svg")) return "svg";
  return "text";
}

/**
 * Reject anything outside the workspace.
 *
 * The model can hallucinate a path like "../../.env" or "/etc/passwd". This is
 * a string check rather than a real sandbox - the database has no filesystem
 * access to abuse - but it keeps the table clean and makes the constraint
 * explicit in one readable place.
 */
export function validatePath(path: string): string | null {
  const cleaned = path.trim().replace(/^\.?\//, "");
  if (!cleaned) return "path is empty";
  if (cleaned.includes("..")) return "paths may not contain '..'";
  if (cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned)) {
    return "paths must be relative to the project root";
  }
  const root = cleaned.split("/")[0];
  if (!ALLOWED_ROOTS.includes(root)) {
    return `"${root}" is not a writable folder. Allowed: ${ALLOWED_ROOTS.join(", ")}`;
  }
  const ext = cleaned.slice(cleaned.lastIndexOf("."));
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `${ext} files are not allowed`;
  }
  return null;
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split("\n").length;
}

/**
 * Coerce whatever arrived as file content into a real string.
 *
 * Models send content three ways, and all three have shown up in practice:
 * a plain string, an array of lines (reliable, and what the schema asks for on
 * a good day), or a single string with literal `\n` sequences and no real
 * newlines - which happens when a model escapes its own escape. Accepting all
 * three means a slightly-wrong call still produces a correct file instead of a
 * one-line disaster.
 */
function normaliseContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((line) => (typeof line === "string" ? line : String(line))).join("\n");
  }

  if (typeof value !== "string") return value == null ? "" : String(value);

  // A single physical line that is full of literal backslash-n is an escaping
  // accident, not a one-line file. Only convert when there are no real
  // newlines, so a genuine one-liner is left alone.
  if (!value.includes("\n") && value.includes("\\n")) {
    return value.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
  }

  return value;
}

/* ------------------------------------------------------------------ reads */

export async function listFiles(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<FileRecord[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select("path, content, language, prev_lines, version")
    .eq("project_id", projectId)
    .order("path");

  if (error) throw new Error(`list_files: ${error.message}`);

  return ((data ?? []) as ProjectFileRow[]).map((row) => ({
    path: row.path,
    content: row.content,
    language: row.language,
    prevLines: row.prev_lines,
    version: row.version,
  }));
}

export async function readFile(
  supabase: SupabaseClient<Database>,
  projectId: string,
  path: string,
): Promise<FileRecord | null> {
  const { data, error } = await supabase
    .from("project_files")
    .select("path, content, language, prev_lines, version")
    .eq("project_id", projectId)
    .eq("path", path)
    .maybeSingle();

  if (error) throw new Error(`read_file: ${error.message}`);
  if (!data) return null;

  const row = data as ProjectFileRow;
  return {
    path: row.path,
    content: row.content,
    language: row.language,
    prevLines: row.prev_lines,
    version: row.version,
  };
}

/* ----------------------------------------------------------------- writes */

export interface WriteResult {
  path: string;
  created: boolean;
  added: number;
  removed: number;
  version: number;
}

/**
 * Write (or overwrite) one file.
 *
 * The line count of the *previous* content is stashed in `prev_lines` before the
 * upsert, which is what lets the UI show a real `+n -m` without keeping a second
 * history table. Good enough for a diff badge; the Time Machine is the thing
 * that gives a real rollback.
 */
export async function writeFile(
  supabase: SupabaseClient<Database>,
  projectId: string,
  path: string,
  content: string,
): Promise<WriteResult> {
  const invalid = validatePath(path);
  if (invalid) throw new Error(invalid);

  const existing = await readFile(supabase, projectId, path);
  const prevLines = existing ? countLines(existing.content) : 0;
  const nextLines = countLines(content);
  const language = languageOf(path);

  const row = {
    project_id: projectId,
    path,
    content,
    language,
    prev_lines: prevLines,
    version: (existing?.version ?? 0) + 1,
  };

  const { error } = await supabase
    .from("project_files")
    .upsert(row, { onConflict: "project_id,path" });

  if (error) throw new Error(`write_file: ${error.message}`);

  return {
    path,
    created: existing === null,
    added: Math.max(nextLines - prevLines, 0),
    removed: Math.max(prevLines - nextLines, 0),
    version: row.version,
  };
}

export async function deleteFile(
  supabase: SupabaseClient<Database>,
  projectId: string,
  path: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("project_files")
    .delete()
    .eq("project_id", projectId)
    .eq("path", path)
    .select("path")
    .maybeSingle();

  if (error) throw new Error(`delete_file: ${error.message}`);
  return data !== null;
}


/* ------------------------------------------------------- tool definitions */

/**
 * The tool schemas handed to the model, in Groq's OpenAI-compatible shape.
 *
 * `finish` is the load-bearing one: without an explicit way out the loop is
 * unbounded, and a model asked to "build an app" will keep polishing until it
 * hits the iteration cap - burning tokens and making the user wait for nothing.
 *
 * The descriptions are the only place the model learns how these tools behave,
 * so they say the things that are otherwise only true in this file: that
 * `write_file` replaces a whole file, that `list_files` is the first call, and
 * that every path is relative.
 */
export const TOOL_DEFINITIONS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List every file in this project with its path and line count. Call this first if you are not sure what already exists.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a file. Pass start_line/end_line to read only a slice - strongly preferred for large files, because the whole workspace plus the conversation has to fit the model's context window. Read the range you are about to change, not the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative path, for example app/page.tsx",
          },
          start_line: {
            type: "number",
            description: "First line to return, 1-based. Omit to start at the top.",
          },
          end_line: {
            type: "number",
            description: "Last line to return, inclusive. Omit to read to the end.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or replace a whole file. Best for files under about 150 lines. For anything larger, write it as a text block instead: <architect:write path=\"app/page.tsx\"> followed by a fenced code block, because long JSON arguments get truncated.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative path, for example app/page.tsx",
          },
          content: {
            type: "string",
            description: "The complete new contents of the file.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Remove a file from the project.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Call this when the app is complete and genuinely working. Summarise what the user can now do with it, in plain language, not what you wrote. Never call it while work remains, and never before you have written at least one file.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "2 to 4 sentences a non-technical person would understand",
          },
          next_steps: {
            type: "array",
            items: { type: "string" },
            description: "Short ideas the user might ask for next",
          },
        },
        required: ["summary"],
      },
    },
  },
];



/**
 * Normalise a write_file payload into file text.
 *
 * `lines` is the shape we ask for: an array of strings, one per line. A JSON
 * array is far more reliable than a multi-line escaped string - models produce
 * valid arrays of short strings almost every time, whereas a big `content`
 * string needs every newline and quote escaped and is exactly where streaming
 * models go wrong.
 *
 * `content` is still accepted because a model occasionally reaches for it, and
 * because the literal two-character sequence `\n` sometimes survives where a real
 * newline does not. Refusing those calls would fail the turn over a recoverable
 * formatting slip.
 */
function readLines(input: Record<string, unknown>): string {
  const { lines, content } = input;

  if (Array.isArray(lines)) {
    return lines
      .map((line) => {
        const text = typeof line === "string" ? line : String(line ?? "");
        // A model that writes one array entry containing the whole file as a
        // single escaped string still gets a correct file.
        return text.includes("\\n") ? text.replace(/\\n/g, "\n") : text;
      })
      .join("\n");
  }

  if (typeof content === "string") return content.replace(/\\n/g, "\n");

  return "";
}


/* ---------------------------------------------------------------- executor */

/* -------------------------------------------------------- write protocol */

/**
 * Apply fenced write blocks from assistant text.
 *
 * Files are written as ordinary assistant text rather than as tool-call
 * arguments, for the reasons documented at the top of `protocol.ts`. Everything
 * else about the write is unchanged: it goes through `writeFile`, so the same
 * path validation, version bump and `prev_lines` diff accounting apply.
 *
 * A block whose closing tag never arrived is written **and** reported as
 * incomplete. A truncated file is still most of a file, and having it on disk
 * means the next turn can repair it with `read_file` plus a smaller write -
 * which beats discarding the work and starting again.
 */
export async function applyWriteBlocks(
  supabase: SupabaseClient<Database>,
  projectId: string,
  blocks: WriteBlock[],
): Promise<ToolOutcome> {
  const events: ToolEvent[] = [];
  const results: string[] = [];
  const files: WrittenFile[] = [];

  for (const block of blocks) {
    if (!block.path) continue;

    try {
      const written = await writeFile(supabase, projectId, block.path, block.content);

      files.push({
        path: written.path,
        added: written.added,
        removed: written.removed,
      });

      events.push({
        name: written.created ? "write_file" : "write_file",
        ok: true,
        detail: `${written.created ? "created" : "updated"} ${written.path} (+${block.content.split("\n").length} lines)`,
      });

      results.push(
        block.complete
          ? `${written.created ? "Created" : "Updated"} ${written.path} (${written.path.split("/").pop()}, ${block.content.split("\n").length} lines, v${written.version}).`
          : `IMPORTANT: your output was cut off partway through ${written.path}, so it was saved incomplete. Read it with read_file, then rewrite it in smaller pieces.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.push({ name: "write_file", ok: false, detail: message });
      results.push(`Could not write ${block.path}: ${message}`);
    }
  }

  return { events, results, files, finished: null };
}

export interface ToolEvent {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WrittenFile {
  path: string;
  added: number;
  removed: number;
}

export interface ToolOutcome {
  events: ToolEvent[];
  /**
   * One string per tool call, positionally aligned with the calls passed in.
   *
   * The OpenAI tool protocol requires exactly one `tool` message per
   * `tool_call`, in the same order, or the next request is rejected. A single
   * joined string cannot satisfy that, which is why this is an array.
   */
  results: string[];
  files: WrittenFile[];
  /** Set when the model called finish. */
  finished: { summary: string; nextSteps: string[] } | null;
}

/**
 * Run one batch of tool calls.
 *
 * Every call is executed even if an earlier one threw: a rejected write should
 * not abandon the rest of the model's plan, because the model needs to see the
 * failures in order to decide what to do next.
 */
export async function runTools(
  supabase: SupabaseClient<Database>,
  projectId: string,
  calls: { name: string; input: Record<string, unknown> }[],
): Promise<ToolOutcome> {
  const events: ToolEvent[] = [];
  const results: string[] = [];
  const files: WrittenFile[] = [];
  let finished: ToolOutcome["finished"] = null;

  for (const call of calls) {
    try {
      switch (call.name) {
        case "list_files": {
          const all = await listFiles(supabase, projectId);
          events.push({
            name: call.name,
            ok: true,
            detail: `${all.length} file${all.length === 1 ? "" : "s"}`,
          });
          results.push(
            all.length === 0
              ? "The project is empty."
              : all
                  .map(
                    (f) =>
                      `- ${f.path} (${countLines(f.content)} lines, v${f.version})`,
                  )
                  .join("\n"),
          );
          break;
        }

        case "read_file": {
          const path = String(call.input.path ?? "");
          const file = await readFile(supabase, projectId, path);
          if (!file) {
            events.push({
              name: call.name,
              ok: false,
              detail: `${path}: not found`,
            });
            results.push(`${path} does not exist.`);
            break;
          }

          // Ranged reads. Re-sending a 300-line file costs a few thousand tokens,
          // and the model's own `write_file` arguments already contain most of
          // that text earlier in the same conversation - so a full re-read is
          // close to paying for the file twice. Reading the range about to change
          // is both cheaper and, in practice, what the edit actually needs.
          const allLines = file.content.split("\n");
          const start = Math.max(1, Math.trunc(Number(call.input.start_line ?? 1)));
          const end =
            call.input.end_line === undefined || call.input.end_line === null
              ? allLines.length
              : Math.min(allLines.length, Math.trunc(Number(call.input.end_line)));
          const slice = allLines.slice(start - 1, Math.max(start, end));

          const partial = start > 1 || end < allLines.length;
          const header = partial
            ? `${path} (lines ${start}-${end} of ${allLines.length}):`
            : `${path}:`;

          events.push({
            name: call.name,
            ok: true,
            detail: partial
              ? `${path} (${start}-${end} of ${allLines.length})`
              : `${path} (${countLines(file.content)} lines)`,
          });
          results.push(`${header}\n\`\`\`\n${slice.join("\n")}\n\`\`\``);
          break;
        }

        case "write_file": {
          const path = String(call.input.path ?? "");
          const content = readLines(call.input);
          const written = await writeFile(supabase, projectId, path, content);
          events.push({
            name: call.name,
            ok: true,
            detail: `${written.created ? "created" : "updated"} ${path} (+${written.added} -${written.removed})`,
          });
          files.push({
            path: written.path,
            added: written.added,
            removed: written.removed,
          });
          // A short receipt, and deliberately *not* the file contents.
          //
          // The file is already in the conversation: the assistant's own
          // tool_call arguments contain it, and the API requires those to be
          // replayed on the next request. Echoing the content back here sent
          // every file twice, which is what pushed a three-turn build past the
          // per-minute token budget.
          results.push(
            `${written.created ? "Created" : "Updated"} ${path}, ${countLines(content)} lines, v${written.version}.`,
          );
          break;
        }

        case "write_file": {
          /*
           * Kept working alongside the text-block protocol, deliberately.
           *
           * I removed this tool once, to push the model toward text blocks. That
           * was a mistake: a model that had already learned the tool kept calling
           * it, and Groq rejects a call to an undefined function with a hard 400
           * that kills the whole run. Off-boarding a tool has to be a prompt
           * change, never a schema change. So both paths write for real, and the
           * text block stays the recommended one for large files.
           */
          const path = String(call.input.path ?? "");
          const content = normaliseContent(call.input.content);

          if (!path) {
            events.push({ name: call.name, ok: false, detail: "no path given" });
            results.push("write_file needs a path.");
            break;
          }

          const written = await writeFile(supabase, projectId, path, content);
          const lineCount = content.split("\n").length;

          files.push({ path: written.path, added: written.added, removed: written.removed });
          events.push({
            name: call.name,
            ok: true,
            detail: `${written.created ? "created" : "updated"} ${written.path} (+${lineCount} lines)`,
          });
          results.push(
            `${written.created ? "Created" : "Updated"} ${written.path} (${lineCount} lines, v${written.version}).`,
          );
          break;
        }

        case "delete_file": {
          const path = String(call.input.path ?? "");
          const removed = await deleteFile(supabase, projectId, path);
          events.push({
            name: call.name,
            ok: removed,
            detail: removed ? `deleted ${path}` : `${path} was not there`,
          });
          results.push(removed ? `Deleted ${path}.` : `${path} was not there.`);
          break;
        }

        case "finish": {
          finished = {
            summary: String(call.input.summary ?? "Done."),
            nextSteps: Array.isArray(call.input.next_steps)
              ? (call.input.next_steps as unknown[]).map(String)
              : [],
          };
          events.push({ name: call.name, ok: true, detail: "finished" });
          results.push("Finished. Handing the work back to the user.");
          break;
        }

        default:
          events.push({ name: call.name, ok: false, detail: "unknown tool" });
          results.push(`Unknown tool "${call.name}".`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      events.push({ name: call.name, ok: false, detail });
      results.push(`${call.name} failed: ${detail}`);
    }
  }

  return { events, results, files, finished };
}

