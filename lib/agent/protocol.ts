/**
 * The file-writing protocol.
 *
 * Why this exists instead of a `write_file` tool
 * ----------------------------------------------
 * Writing files through tool-call JSON was the single largest source of failure
 * in this product. The whole file had to survive as a JSON string - every quote
 * escaped, every newline as `\n`, every backslash doubled - inside one
 * `arguments` field. Two things then went wrong, repeatedly and in front of the
 * user:
 *
 *   1. `Failed to parse tool call arguments as JSON`. Long escaped strings are
 *      exactly what language models produce least reliably.
 *   2. `Failed to call a function ... failed_generation`. When the arguments
 *      outran the response budget the JSON arrived cut off mid-string, and the
 *      provider rejected the entire turn. Nothing was written and the build
 *      ended with a message about JSON, which tells the user nothing.
 *
 * The fix is to stop hiding code inside JSON. Models are trained on an enormous
 * volume of fenced code blocks; writing one is native to them. So a file is
 * written as ordinary assistant text:
 *
 *     <architect:write path="app/page.tsx">
 *     ```tsx
 *     export default function Page() { ... }
 *     ```
 *     </architect:write>
 *
 * There is no escaping, so there is no escaping to get wrong. Two further
 * advantages over the tool call:
 *
 *   - Truncation degrades instead of destroying. A cut-off block is detected as
 *     incomplete and the rest of the turn's work still lands on disk.
 *   - It streams. The UI can render the code as it arrives, which a tool call
 *     cannot do because its arguments only become readable once complete.
 */

export interface WriteBlock {
  path: string;
  content: string;
  /** False when the closing tag never arrived, i.e. the response was cut off. */
  complete: boolean;
}

const OPEN = /<architect:write\s+path\s*=\s*"([^"]+)"\s*>/g;
const CLOSE = "</architect:write>";

/**
 * Strip the optional fence so the file does not end up containing ```tsx.
 *
 * Models wrap their output in a fence out of habit, and often leave the fence
 * language off. Both are accepted, because rejecting a good file over a cosmetic
 * detail would be absurd.
 */
function unfence(body: string): string {
  const lines = body.split("\n");

  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  if (lines.length > 0 && /^```[a-zA-Z0-9.+-]*\s*$/.test(lines[0].trim())) {
    lines.shift();
  }
  if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
    lines.pop();
  }

  return lines.join("\n");
}

/**
 * Every write block in a chunk of assistant text.
 *
 * Deliberately tolerant: the last block is returned as `complete: false` when
 * its closing tag is missing rather than being discarded. A cut-off file is
 * still most of a file, and the caller can decide whether to keep it and ask for
 * a smaller rewrite - which beats losing it.
 */
export function parseWriteBlocks(text: string): WriteBlock[] {
  const blocks: WriteBlock[] = [];
  const open = new RegExp(OPEN.source, "g");

  let match: RegExpExecArray | null;
  while ((match = open.exec(text)) !== null) {
    const path = match[1].trim();
    const bodyStart = match.index + match[0].length;
    const closeAt = text.indexOf(CLOSE, bodyStart);

    if (closeAt === -1) {
      blocks.push({ path, content: unfence(text.slice(bodyStart)), complete: false });
      break;
    }

    blocks.push({
      path,
      content: unfence(text.slice(bodyStart, closeAt)),
      complete: true,
    });
    open.lastIndex = closeAt + CLOSE.length;
  }

  return blocks;
}

/**
 * How many write blocks are fully closed so far.
 *
 * Used while streaming: when this number rises, one more file is safe to show.
 * Counting rather than re-parsing keeps the streaming path cheap.
 */
export function completedBlockCount(text: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const openAt = text.indexOf("<architect:write", from);
    if (openAt === -1) break;
    const closeAt = text.indexOf(CLOSE, openAt);
    if (closeAt === -1) break;
    count += 1;
    from = closeAt + CLOSE.length;
  }
  return count;
}

/** True when the text contains any write block at all. */
export function hasWriteBlock(text: string): boolean {
  return /<architect:write\s+path\s*=\s*"/.test(text);
}

/**
 * Replace each write block body with a one-line marker.
 *
 * Called once the blocks are safely on disk. The bodies must not stay in the
 * conversation: they are by far the largest thing in it, and re-sending them on
 * every subsequent turn is what pushed requests past the per-minute token budget
 * and produced "request too large" errors that had nothing to do with the user's
 * prompt. The marker keeps the fact that a file was written - which is all the
 * model needs to remember, since it can always `read_file` the real thing.
 */
export function summariseWriteBlocks(text: string, blocks: WriteBlock[]): string {
  if (blocks.length === 0) return text;

  let out = "";
  let cursor = 0;
  const open = new RegExp(OPEN.source, "g");

  let match: RegExpExecArray | null;
  while ((match = open.exec(text)) !== null) {
    const path = match[1].trim();
    const bodyStart = match.index + match[0].length;
    const closeAt = text.indexOf(CLOSE, bodyStart);
    const end = closeAt === -1 ? text.length : closeAt + CLOSE.length;

    out += text.slice(cursor, match.index);
    out += `[wrote ${path}]`;
    cursor = end;
    open.lastIndex = end;
  }

  out += text.slice(cursor);
  return out.trim();
}
