/**
 * The agent loop.
 *
 * This is the heart of Architect 2.0, and it is the piece the earlier version
 * faked. It is a standard tool-use loop:
 *
 *   1. Send the conversation plus the project's current files to the model
 *   2. The model streams prose (shown live) and may emit tool calls
 *   3. Execute those tools against Postgres, streaming each result to the UI
 *   4. Append the tool results and go back to 1
 *   5. Stop when the model calls finish, or the iteration cap is hit
 *
 * Step 4 is what makes this an agent rather than a one-shot generator: the model
 * can read back what it wrote, notice it is wrong, and fix it in the next turn.
 * It is the same shape as the loop an AI coding assistant runs.
 *
 * Every event is pushed through an `emit` callback and streamed to the browser
 * as NDJSON, so the UI shows work happening rather than a spinner.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createProvider, MODELS, type ChatMessage } from "@/lib/agent/provider";
import {
  parseWriteBlocks,
  summariseWriteBlocks,
} from "@/lib/agent/protocol";
import {
  applyWriteBlocks,
  listFiles,
  runTools,
  TOOL_DEFINITIONS,
  type ToolOutcome,
} from "@/lib/agent/tools";
import type { Database } from "@/lib/supabase/types";

/** Everything the route streams to the browser. */
export type AgentEvent =
  | {
      type: "start";
      provider: string;
      model: string;
      existingFiles: number;
      maxTurns: number;
    }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; ok: boolean; detail: string }
  | { type: "file"; path: string; added: number; removed: number }
  | { type: "turn"; index: number; usage: { input: number; output: number } }
  | { type: "model"; model: string }
  | { type: "done"; summary: string; nextSteps: string[]; turns: number; files: number }
  | { type: "error"; message: string };

export type Emit = (event: AgentEvent) => void;

/**
 * The system prompt.
 *
 * This is where "not generic" is actually enforced. An earlier version of this
 * app had a classifier that mapped a prompt onto one of eight canned app types,
 * so every journalling request produced the same journalling app. That is gone -
 * the model decides the app. But the model drifts toward the mainstream unless
 * the prompt says what *not* to do, so it does.
 *
 * Kept tight on purpose. Groq's free tier allows 8,000 tokens per minute across
 * input and output, and the prompt is re-sent on every turn of the loop - so
 * every token here is paid for five or six times over.
 */
export function systemPrompt(projectName: string, fileCount: number): string {
  return `You are the build agent inside Architect 2.0. You turn one person's description into a working web app by writing real files.

Building: **${projectName}**. The workspace holds ${fileCount} file${fileCount === 1 ? "" : "s"}.

## What already exists

The project is already set up: React, TypeScript and Tailwind are installed and working. Do not create \`package.json\`, \`tailwind.config.js\`, \`next.config.js\`, \`tsconfig.json\`, \`README.md\` or anything else at the repo root. Write only inside \`app/\`, \`lib/\` or \`supabase/\`.

Start with \`app/page.tsx\`. Add other files only when the app genuinely needs them.

## Build for this person, not for everyone

The usual failure is the most average possible app: a generic title, "Lorem ipsum", features nobody asked for. Do not do that.

- Every specific detail in the request must be visible in the app. Their words are the spec.
- Write real copy in their voice. Invent plausible content. Never "Item 1", "Lorem ipsum", or "Your data here".
- Build exactly the scope they asked for. Do not add accounts, social feeds, admin panels, dark modes or settings pages because a typical app has them. A focused tool beats a bloated one.
- Choose concrete details yourself where they were silent: a colour scheme that suits the subject, sensible field names, one obvious primary action.
- Follow-ups ("add dark mode", "let me search") change the existing app in place. Read the file first.

## How you work

1. \`list_files\`, then \`read_file\` anything you will change.
2. Write the fewest files that make a genuinely working app. Few good files beat many thin ones.
3. \`finish\` with a plain-language summary.

## How you write files

There is no \`write_file\` tool. You write files as blocks in your reply text, in exactly this shape:

    <architect:write path="app/page.tsx">
    import { useState } from "react";

    export default function Page() {
      return <main className="p-6">Hello</main>;
    }
    </architect:write>

Rules, and they matter:

- The tag is exactly \`<architect:write path="...">\` with a quoted path, closed with \`</architect:write>\`.
- Write the complete file, not a fragment and not a diff.
- One file per block. You may emit several blocks in a single reply.
- Write real code as text. Do not describe the file.

Because files are plain text you can write a long file safely. Still keep \`app/page.tsx\` short: if it passes about 120 lines, split the piece you are in the middle of into its own file under \`app/components/\` and import it.

**Read ranges, not whole files.** Use \`start_line\`/\`end_line\` on \`read_file\` and read only the part you are about to change.

## What "working" means

Real state the user can change: add, edit, delete or complete something. A form that validates. An empty state and a loaded state. No network calls, no external CDNs, no API keys.

Keep data in the browser (\`localStorage\` or in-memory). If the app would need a server later, say so in \`finish\` rather than faking an API.

## Code conventions

- \`app/page.tsx\` is the entry screen and should stay short - under about 120 lines. Put each meaningful piece in its own file under \`app/components/\` and import them.
- Tailwind utilities are the only styling. No \`<style>\` block, no CSS framework.
- No packages beyond React. No lucide-react - use inline SVG or text.
- No \`next/image\`, no server actions, no API routes. This runs in the browser.
- TypeScript. Avoid \`any\`.

## Finishing

Call \`finish\` once, only when the app genuinely works. Summarise what the user can now do, not what you wrote. Never describe code you have not written, and never \`finish\` before writing at least one file.`;
}

/**
 * Rough token estimate.
 *
 * Four characters per token is close enough for a budget decision, and being
 * slightly pessimistic is the safe direction. The alternative - a real
 * tokenizer - would mean shipping a dependency to shave a few percent off a
 * number we only use to stay under a cap.
 */
function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += (message.content ?? "").length;
    for (const call of message.tool_calls ?? []) {
      chars += call.function.name.length + call.function.arguments.length;
    }
  }
  return Math.ceil(chars / 4);
}

/** The tool schemas are re-sent every request, so they are part of the cost. */
const TOOL_SCHEMA_TOKENS = 750;

/** Headroom for provider-side framing, safety and rounding. */
const SAFETY_MARGIN = 600;

/** Never ask for less than this, or a file cannot be emitted at all. */
const MIN_OUTPUT = 1_200;

/**
 * Decide how many tokens the model may generate this turn.
 *
 * The failure this fixes: a fixed `max_tokens` is wrong in both directions. Set
 * high, a long conversation plus a large output exceeds the per-minute budget
 * and fails with a 413. Set low, a file is truncated mid-JSON and fails to
 * parse. So the allowance is whatever is left after the input is counted.
 */
function outputAllowance(inputTokens: number, budget: number): number {
  const room = budget - inputTokens - TOOL_SCHEMA_TOKENS - SAFETY_MARGIN;
  return Math.max(MIN_OUTPUT, Math.min(6_000, room));
}

/**
 * Drop the oldest tool results when the conversation outgrows the budget.
 *
 * Tool *results* are the safe thing to drop: they are receipts ("Updated
 * app/page.tsx, 120 lines"), and the file itself still lives in the workspace
 * behind `read_file`. The assistant turns stay, because they carry the
 * tool_call ids the protocol requires, and dropping them would make the message
 * sequence invalid.
 */
function shedHistory(messages: ChatMessage[], target: number): boolean {
  if (estimateTokens(messages) <= target) return false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "tool") {
      messages[i] = {
        ...messages[i],
        content: "(earlier result trimmed to fit the token budget)",
      };
    }
    if (estimateTokens(messages) <= target) return true;
  }
  return false;
}


/**
 * Replace the payload of tool calls that have already been applied.
 *
 * This is the fix for the two errors that made long builds impossible:
 * "This request was larger than the model's context window allows" and
 * "Failed to parse tool call arguments as JSON".
 *
 * Both had the same cause, and it was not the provider. Every `write_file` call
 * carries the entire file as JSON arguments, and the API requires that call to be
 * replayed on every subsequent turn - so a four-file app re-sent roughly 10,000
 * tokens of file content that was already sitting in Postgres. The input alone
 * blew the free tier's 8,000-per-minute budget, and via `outputAllowance` it also
 * shrank the response budget until a file no longer fit, which is exactly how
 * truncated - and therefore unparseable - JSON arguments happen.
 *
 * `shedHistory` could not help. It trims tool *results*, which are one-line
 * receipts, so it freed almost nothing.
 *
 * The content is safe to drop. The protocol requires the call to exist with a
 * valid id and valid JSON arguments - not to retain the original payload - and
 * the file itself is on disk, reachable with `read_file`. So the arguments keep
 * their schema shape (a `lines` array of strings) and lose the text.
 */
function compactAppliedCalls(messages: ChatMessage[]): void {
  for (const message of messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;

    for (const call of message.tool_calls) {
      if (call.function.name !== "write_file") continue;

      const args = parseArguments(call.function.arguments);
      if (!args || typeof args.path !== "string") continue;

      const lineCount = Array.isArray(args.lines)
        ? args.lines.length
        : typeof args.content === "string"
          ? args.content.split("\n").length
          : 0;

      // Nothing worth reclaiming, or already compacted.
      if (lineCount === 0) continue;

      call.function.arguments = JSON.stringify({
        path: args.path,
        lines: [
          `(the ${lineCount} lines written to ${args.path} are on disk and omitted here to save tokens - read_file returns them)`,
        ],
      });
    }
  }
}

/**
 * A per-minute token budget, mirroring the provider's own rolling window.
 *
 * This is the difference between a product that works on the free tier and one
 * that fails every few turns. A single file write is roughly 2,500-3,000 tokens
 * of input and output, and the free tier allows 8,000 per *minute* - so only two
 * or three writes fit before the window is full. Retrying after four seconds does
 * not help, because the budget refills on a rolling sixty seconds, not instantly.
 *
 * So the loop reserves its own spend before each request and waits when the
 * window is full. The build is slower and it finishes.
 */
function createTokenBucket(budget: number) {
  const spent: { at: number; tokens: number }[] = [];
  const WINDOW_MS = 60_000;
  // Leave room so the provider's own framing does not tip us over the line.
  const ceiling = budget * 0.9;

  const total = () => {
    const cutoff = Date.now() - WINDOW_MS;
    while (spent.length > 0 && spent[0].at < cutoff) spent.shift();
    return spent.reduce((sum, entry) => sum + entry.tokens, 0);
  };

  return {
    /**
     * Reserve `tokens` if they are available right now.
     *
     * Returns the wait in milliseconds, or `null` when the request would have to
     * sit. The pool uses that to try another model before it ever waits.
     */
    tryReserve(tokens: number): number | null {
      const wanted = Math.min(tokens, ceiling);
      const used = total();
      if (used + wanted <= ceiling) {
        spent.push({ at: Date.now(), tokens: wanted });
        return 0;
      }
      return null;
    },

    /**
     * Reserve `tokens`. Resolves once there is room; returns ms waited.
     */
    async reserve(tokens: number): Promise<number> {
      const wanted = Math.min(tokens, ceiling);
      const used = total();
      if (used + wanted <= ceiling) {
        spent.push({ at: Date.now(), tokens: wanted });
        return 0;
      }

      // Wait until enough of the oldest spend has aged out of the window.
      const overflow = used + wanted - ceiling;
      let freed = 0;
      let waitUntil = Date.now() + WINDOW_MS;
      for (const entry of spent) {
        freed += entry.tokens;
        if (freed >= overflow) {
          waitUntil = entry.at + WINDOW_MS;
          break;
        }
      }

      const wait = Math.max(0, waitUntil - Date.now());
      await new Promise((resolve) => setTimeout(resolve, wait));

      spent.push({ at: Date.now(), tokens: wanted });
      return wait;
    },

    /**
     * Replace the last reservation with what the request actually cost.
     *
     * The reservation has to be made before the request - you cannot ask the
     * provider for permission - so it is an estimate, and the estimate is wrong
     * in both directions: `estimateTokens` counts characters, and it cannot know
     * how long the model's reply will run.
     *
     * Left uncorrected, an over-estimate is what produced the long stalls the
     * user noticed: the bucket believed the minute was full when a third of it
     * was still free. Provider usage is exact, so reconcile as soon as the stream
     * reports it. `Math.max` keeps the higher of the two, because the tokens were
     * genuinely spent either way and under-counting buys a 429.
     */
    reconcile(actual: number) {
      const last = spent[spent.length - 1];
      if (!last || actual <= 0) return;
      last.tokens = Math.min(ceiling, Math.max(last.tokens, actual));
    },
  };
}


export interface ProviderError {
  /** True when the request was too large or the account is rate limited. */
  rateLimited: boolean;
  /** A message written for the person using the product, not for a log file. */
  message: string;
}

/** The provider's own message, whatever shape the SDK threw it in. */
function rawOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; error?: { message?: unknown } };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error?.message === "string") return record.error.message;
  }
  return String(error);
}

/** HTTP status if the SDK exposed one; 0 when it did not. */
function statusOf(error: unknown): number {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (Number.isFinite(status)) return status;
  }
  return 0;
}

/**
 * Turn a provider failure into something a user can act on.
 *
 * Groq returns a 413 or 429 wrapped in a wall of text about tier upgrades.
 * Showing that verbatim is how this product ended up telling someone to upgrade
 * a plan when the real problem was that we were asking for more output tokens
 * than the budget had room for.
 */
function explain(error: unknown): ProviderError {
  const raw = rawOf(error);
  const status = statusOf(error);

  if (status === 413 || /request too large|413/i.test(raw)) {
    /*
     * Groq's 413 is almost never a context-window problem, and saying so sends
     * the user off to write shorter prompts when the real cause is the per-minute
     * token budget: one turn's input plus its requested output exceeded 8,000.
     *
     * The two are told apart by looking for the budget wording Groq actually
     * uses ("tokens per minute", "TPM"). When it is present this is a rate
     * problem, and the honest message says so - and says the build continues.
     */
    const isBudget = /tokens per minute|\bTPM\b|rate limit/i.test(raw);

    return {
      rateLimited: true,
      message: isBudget
        ? "That turn needed more tokens than the free tier allows in one minute (input plus output). Your files are saved - sending again will go through, and the build will pick up where it stopped."
        : "This request was larger than the model's context window allows. The conversation has been trimmed - try describing one change at a time.",
    };
  }
  if (status === 429 || /rate limit|429/i.test(raw)) {
    return {
      rateLimited: true,
      message:
        "Groq's free tier allows 8,000 tokens per minute per model and the limit was reached. Wait a few seconds and try again - the files already written are saved.",
    };
  }

  /*
   * The single most misleading error this product produced.
   *
   * It reads like the application is broken, and it is not: the model tried to
   * emit one `write_file` whose JSON arguments were longer than the response
   * budget, so the arguments arrived truncated, the provider rejected the whole
   * request, and the run died before writing anything. The files on disk are
   * fine and untouched.
   *
   * The underlying cause is a too-large single file, so the message says that,
   * and says what to do next - rather than surfacing provider wording about
   * JSON that gives the user nothing to act on.
   */
  if (/parse tool call arguments|invalid.*json|unterminated string/i.test(raw)) {
    return {
      rateLimited: false,
      message:
        "The agent tried to write one file that was too large to send in a single response, so the request was cut off and nothing was changed. Nothing is broken - your existing files are safe. Ask for a smaller piece of work, for example \"split the page into three components\", and it will continue.",
    };
  }

  return { rateLimited: false, message: raw };
}

/**
 * Which models this run may use.
 *
 * The user's choice goes first, then every other model we know handles tool
 * calling. Groq meters each one separately, so the extra models are not a
 * fallback in the apologetic sense - they are extra capacity, and a build that
 * needs four files moves between them instead of stalling.
 */
function poolModelIds(preferred?: string): string[] {
  const base = MODELS.map((m) => m.id);
  const configured = (process.env.GROQ_MODEL ?? "").trim();
  const chosen = preferred ?? (configured || undefined);
  if (!chosen) return base;
  return [chosen, ...base.filter((id) => id !== chosen)];
}


/**
 * A pool of models, each with its own token budget.
 *
 * Groq meters rate limits **per model, per organisation** - verified by reading
 * `x-ratelimit-remaining-tokens` on three models in the same minute and getting
 * three different numbers. That makes pooling a real technique rather than a
 * trick: three coding models on the free tier is ~24,000 tokens per minute
 * instead of 8,000, which is the difference between a build that stalls every
 * third file and one that finishes.
 *
 * Strategy: prefer the model the user picked, use it until its window is full,
 * then hand the turn to the next one rather than idling. A model that returns a
 * hard 429 is parked for the rest of the run, because retrying it immediately
 * would just fail again.
 */
function createModelPool(modelIds: string[], budget: number) {
  const order = [...modelIds];
  const buckets = new Map(order.map((id) => [id, createTokenBucket(budget)]));
  const parked = new Set<string>();

  return {
    order,
    /** True when nothing is left and the caller should stop the run. */
    get exhausted() {
      return order.every((id) => parked.has(id));
    },

    /**
     * Claim budget on the best model that has room right now.
     *
     * Returns null when every model would have to wait; the caller then waits on
     * the preferred one rather than spinning.
     */
    claim(wanted: number, preferred: string): { id: string; bucket: ReturnType<typeof createTokenBucket> } | null {
      const sequence = [preferred, ...order.filter((id) => id !== preferred)];
      for (const id of sequence) {
        if (parked.has(id)) continue;
        const bucket = buckets.get(id);
        if (!bucket) continue;
        if (bucket.tryReserve(wanted) !== null) return { id, bucket };
      }
      return null;
    },

    /** Wait out the window on the preferred model. */
    async wait(wanted: number, preferred: string): Promise<void> {
      const bucket = buckets.get(preferred) ?? buckets.get(order[0]);
      if (bucket) await bucket.reserve(wanted);
    },

    /** Correct a model's reservation once its real usage is known. */
    reconcile(id: string, actual: number) {
      buckets.get(id)?.reconcile(actual);
    },

    /** Give up on a model for the rest of this run. */
    park(id: string) {
      parked.add(id);
    },
  };
}

/** Balance quotes, braces and brackets on a string the model ran out of room for. */
function closeTruncated(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const char of text) {
    out += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") stack.pop();
  }

  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, "");
  if (out.endsWith(":")) out = out.slice(0, -1);
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/**
 * Parse a tool call's arguments, repairing the ways a streaming model most often
 * gets them slightly wrong.
 *
 * Returns null when the value is not recoverable, which the caller reports back
 * to the model as a tool_result so it can send the call again. That turns a hard
 * stop into a retry, which is the difference between a lost build and a slightly
 * slower one.
 */
function parseArguments(raw: string): Record<string, unknown> | null {
  const text = (raw ?? "").trim();
  if (text === "") return {};

  const attempts: string[] = [
    text,
    text.replace(/,\s*([}\]])/g, "$1"),
    text.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t"),
    closeTruncated(text),
    text.replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":'),
  ];

  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Try the next repair.
    }
  }
  return null;
}


/** How many model turns one request may take. */
const MAX_TURNS = 12;

export interface RunOptions {
  supabase: SupabaseClient<Database>;
  projectId: string;
  projectName: string;
  /** What the user asked for, or "" to build from the project's own prompt. */
  instruction: string;
  emit: Emit;
  /** Overridable so the cap can be lowered in a test. */
  maxTurns?: number;
  /**
   * Which model to use; defaults to the configured one.
   *
   * A single model, not a list: the pool already contains every model it is
   * allowed to use, and this names the one to try first.
   */
  model?: string;
}

/**
 * Run the agent to completion.
 *
 * Never throws: every failure becomes an `error` event, because this runs inside
 * a streaming response and an exception there leaves the client hanging on a
 * half-open body with no explanation.
 */
export async function runAgent({
  supabase,
  projectId,
  projectName,
  instruction,
  emit,
  maxTurns = MAX_TURNS,
  model,
}: RunOptions): Promise<void> {
  /*
   * The pool.
   *
   * `createProvider` is called once per model, and each gets its own token
   * bucket, because Groq meters each model separately. The user's pick goes
   * first; the rest are there to take over when its minute fills up.
   */
  let pool: ReturnType<typeof createModelPool>;
  let providers: Map<string, ReturnType<typeof createProvider>>;
  try {
    const ids = poolModelIds(model);
    providers = new Map(ids.map((id) => [id, createProvider(id)]));
    pool = createModelPool(ids, providers.get(ids[0])?.budget ?? 8_000);
  } catch (error) {
    emit({ type: "error", message: explain(error).message });
    return;
  }

  const limit = Math.min(Math.max(maxTurns, 1), MAX_TURNS);
  const preferred = model ?? pool.order[0];

  try {
    const existing = await listFiles(supabase, projectId);
    emit({
      type: "start",
      provider: "Groq",
      model: preferred,
      existingFiles: existing.length,
      maxTurns: limit,
    });

    const opening = instruction.trim()
      ? "Build or change this app:\n\n" + instruction.trim()
      : "Build the app described in my project: " + projectName + ".";

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(projectName, existing.length) },
      { role: "user", content: opening },
    ];

    let summary = "";
    let nextSteps: string[] = [];
    let turns = 0;
    let wroteSomething = false;
    let stalled = 0;
    let lastModel = preferred;

    for (let turn = 1; turn <= limit; turn += 1) {
      turns = turn;

      /*
       * Only the file *index* goes in the prompt - paths and sizes, never
       * contents.
       *
       * Re-sending every file's text on every turn is N x M tokens over an
       * M-file build, which on Groq's free tier exhausts an 8,000 token budget
       * by the second turn. Content reaches the model exactly once, in the
       * assistant's own tool_call arguments, and it reads anything else with
       * read_file.
       */
      const files = await listFiles(supabase, projectId);
      const index =
        files.length === 0
          ? "The workspace is empty."
          : "Files on disk (read one with read_file before editing it):\n" +
            files
              .map(
                (f) =>
                  "- " +
                  f.path +
                  " (" +
                  f.content.split("\n").length +
                  " lines, v" +
                  f.version +
                  ")",
              )
              .join("\n");

      messages.push({ role: "user", content: index });

      /*
       * Fit the request to the per-minute budget, then ask for whatever output
       * is left over. A fixed allowance is wrong in both directions: too high
       * and a long conversation exceeds the budget; too low and a file is
       * truncated mid-JSON.
       */
      /*
       * One turn, across the pool.
       *
       * Budget is claimed before the request, not after a 429: each model has its
       * own window, so when the preferred one is full the turn simply moves to
       * the next rather than stalling. Only if *every* model is full does the
       * build wait, and it says so in the thread so nobody thinks it has hung.
       */
      const ask = async (allowance: number) => {
        const wanted = estimateTokens(messages) + TOOL_SCHEMA_TOKENS + allowance;

        const claim = pool.claim(wanted, preferred);
        if (claim) {
          if (claim.id !== lastModel) {
            lastModel = claim.id;
            emit({ type: "model", model: claim.id });
          }
          return providers.get(claim.id)!.stream(
            messages,
            TOOL_DEFINITIONS,
            (delta) => emit({ type: "text", delta }),
            allowance,
          );
        }

        emit({
          type: "text",
          delta:
            "\n\n_(all the models in the pool have used their free-tier allowance for this minute - waiting for the next one. Your files are saved; this usually clears within a minute.)_",
        });
        await pool.wait(wanted, preferred);
        return providers.get(preferred)!.stream(
          messages,
          TOOL_DEFINITIONS,
          (delta) => emit({ type: "text", delta }),
          allowance,
        );
      };

      const budget = providers.get(preferred)?.budget ?? 8_000;
      type StreamResult = Awaited<ReturnType<ReturnType<typeof createProvider>["stream"]>>;

      /*
       * Retry a turn that failed to generate, on a different model.
       *
       * Measured, not assumed: `openai/gpt-oss-20b` failed the same streaming
       * tool call 1 time in 3 with "Failed to parse tool call arguments as JSON",
       * while `openai/gpt-oss-120b` did not fail once in 9 attempts across the
       * same turns. It is a flaky model, not a broken request - the identical
       * payload succeeds on the next call, and the pool already exists precisely
       * so a turn can move somewhere else.
       *
       * So these are retried, and the model that failed is parked so the retry
       * does not land on the same one. Without this, a 1-in-3 flake ends the
       * user's build with a message about JSON that has nothing to do with
       * anything they did.
       */
      const GENERATION_FAILURE =
        /failed_generation|failed to call a function|parse tool call arguments|invalid.*json|unterminated string/i;

      /*
       * Run one turn, shrinking the request until it fits.
       *
       * A 413 on the free tier means input + requested output exceeded 8,000 for
       * that minute. It used to end the run, which is indefensible: the fix is
       * mechanical (ask for less output, drop old receipts, use another model),
       * and the user's files are already safe. So the turn is retried, and each
       * attempt makes the request strictly smaller - capped, so a genuinely
       * hopeless request fails once with a clear message rather than looping.
       */
      const streamOnce = async (): Promise<StreamResult> => {
        // Starts at the derived allowance and is halved on each retry.
        let allowance = outputAllowance(estimateTokens(messages), budget);
        let lastError: unknown;

        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            return await ask(allowance);
          } catch (error) {
            lastError = error;
            const failure = explain(error);

            if (failure.rateLimited) {
              // The window we thought had room did not. Park that model so the
              // retry is routed to a different one rather than the same one.
              pool.park(lastModel);
            }

            const isOversized = statusOf(error) === 413 || /too large|413/i.test(rawOf(error));

            if (isOversized) {
              // Drop the oldest receipts: they are the only large, disposable
              // part of the conversation.
              shedHistory(messages, Math.floor(budget * 0.25));
              // And ask for less, down to a floor that can still emit a file.
              allowance = Math.max(1_000, Math.floor(allowance / 2));
              emit({
                type: "text",
                delta: `\n\n_(that turn was over the free tier's per-minute budget - retrying with a smaller request)_`,
              });
              continue;
            }

            if (failure.rateLimited) {
              await pool.wait(budget, preferred);
              continue;
            }

            throw error;
          }
        }

        throw lastError;
      };

      let result: StreamResult;
      try {
        result = await streamOnce();
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (!GENERATION_FAILURE.test(raw)) throw error;

        // Park the flaky model so `ask` routes the retry to a different one.
        pool.park(lastModel);
        emit({
          type: "text",
          delta: `\n\n_(the ${lastModel} model produced a malformed response - retrying this step on another model)_`,
        });

        result = await streamOnce();
      }

      /*
       * Files arrive as fenced text blocks, not as tool-call arguments.
       *
       * See `protocol.ts` for why. Order matters here: the assistant message is
       * appended with its full text first, because that is what the model
       * actually said, and only then - once the bodies are safely on disk - are
       * they replaced by one-line markers. That keeps the model's memory of "I
       * wrote these files" while removing the single largest thing in the
       * conversation, which is what every later turn would otherwise re-send.
       */
      const blocks = parseWriteBlocks(result.text ?? "");

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.text || null,
        ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
      };
      messages.push(assistantMessage);

      emit({ type: "turn", index: turn, usage: result.usage });

      let applied: ToolOutcome | null = null;

      if (blocks.length > 0) {
        applied = await applyWriteBlocks(supabase, projectId, blocks);

        for (const event of applied.events) {
          emit({
            type: "tool",
            name: event.name,
            ok: event.ok,
            detail: event.detail,
          });
        }
        for (const file of applied.files) {
          wroteSomething = true;
          emit({
            type: "file",
            path: file.path,
            added: file.added,
            removed: file.removed,
          });
        }

        assistantMessage.content =
          summariseWriteBlocks(assistantMessage.content ?? "", blocks) || null;
      }

      if (result.toolCalls.length === 0) {
        /*
         * A turn that wrote files and called no tools is progress, not a stall.
         *
         * There is no `tool_call` to attach the receipt to, so it goes back as a
         * user message. That is the only channel available, and the model needs
         * the confirmation - without it, it cannot tell a successful write from
         * one that silently failed.
         */
        if (applied && applied.files.length > 0) {
          stalled = 0;
          messages.push({
            role: "user",
            content: `${applied.results.join("\n")}\n\nKeep going. Read a file back with read_file if you need to check it, and call finish once the app is complete and working.`,
          });
          continue;
        }

        stalled += 1;
        if (stalled >= 2) {
          summary =
            result.text ||
            "I ran out of steps before finishing. Your files are saved - tell me what to do next and I will carry on.";
          break;
        }
        messages.push({
          role: "user",
          content:
            'You replied without changing anything. Write each file as a block like this, then call finish when the app is complete:\n\n<architect:write path="app/page.tsx">\n```tsx\n...the whole file...\n```\n</architect:write>',
        });
        continue;
      }

      stalled = 0;


      const parsed = result.toolCalls.map((call) => ({
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      }));

      const usable = parsed
        .filter(
          (call): call is { name: string; input: Record<string, unknown> } =>
            call.input !== null,
        )
        .map(({ name, input }) => ({ name, input }));

      const outcome = await runTools(supabase, projectId, usable);

      for (const event of outcome.events) {
        emit({ type: "tool", name: event.name, ok: event.ok, detail: event.detail });
      }
      for (const file of outcome.files) {
        wroteSomething = true;
        emit({
          type: "file",
          path: file.path,
          added: file.added,
          removed: file.removed,
        });
      }

      /*
       * One `tool` message per `tool_call`, in order, or the next request is
       * rejected. Unparseable calls are reported back so the model retries
       * instead of the run dying.
       */
      let resultIndex = 0;
      for (let i = 0; i < result.toolCalls.length; i += 1) {
        const call = result.toolCalls[i];
        if (parsed[i]?.input === null) {
          emit({
            type: "tool",
            name: call.function.name || "tool",
            ok: false,
            detail: "arguments were not valid JSON - retrying",
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content:
              "Your arguments were not valid JSON, so nothing changed. Send the call again. For write_file use the lines array, one string per line, with no escaped newlines.",
          });
          continue;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: outcome.results[resultIndex] ?? "Done.",
        });
        resultIndex += 1;
      }

      /*
       * Compact before the next turn is measured.
       *
       * Placed here, after the results are recorded and before the loop repeats,
       * because this is the last moment the write is provably done. Everything
       * downstream - the input estimate, the output allowance and the bucket
       * reservation - then sees the small conversation rather than the large one.
       */
      compactAppliedCalls(messages);

      if (outcome.finished) {
        summary = outcome.finished.summary;
        nextSteps = outcome.finished.nextSteps;
        break;
      }

      if (turn === limit) {
        summary =
          "I reached the step limit for this run and stopped there. Your files are saved - tell me what to do next and I will carry on.";
      }
    }

    if (!wroteSomething && !summary) {
      summary =
        "I did not get as far as writing anything. Try telling me again what the app should do.";
    }

    const finalFiles = await listFiles(supabase, projectId);
    emit({
      type: "done",
      summary,
      nextSteps,
      turns,
      files: finalFiles.length,
    });
  } catch (error) {
    emit({ type: "error", message: explain(error).message });
  }
}
