/**
 * The model provider.
 *
 * Architect runs on **Groq** (https://console.groq.com), not Anthropic. That is a
 * product decision, not an implementation detail: Groq's inference is fast enough
 * that an agent loop feels immediate rather than staged, and an agent loop is
 * several round trips per build.
 *
 * Groq exposes an OpenAI-compatible surface, so this module speaks OpenAI's
 * shape and points the SDK at Groq's base URL. The rest of the app never imports
 * a vendor SDK directly - it asks for a chat completion and gets back text plus
 * tool calls. Swapping providers later is a change to this file alone.
 *
 * Two things are worth knowing about Groq specifically:
 *  - `temperature: 0` is silently converted to 1e-8, so we ask for a small
 *    non-zero value when we want determinism.
 *  - It supports **parallel tool calls**, which is why a single turn can write
 *    several files at once.
 */

import OpenAI from "openai";

/**
 * A model we have actually tested against this API.
 *
 * `llama-3.3-70b-versatile` was retired from Groq's catalogue, so the list is
 * what answers today, not what used to. Each entry below has been checked for
 * the one property the agent cannot work without: **tool calling**.
 */
export interface ModelInfo {
  id: string;
  label: string;
  note: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    note: "The default. Verified to stream and to emit tool calls correctly.",
  },
  {
    id: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    note: "Strong at code generation.",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    note: "Lighter and faster. Good for small edits.",
  },
];

export const DEFAULT_MODEL = "openai/gpt-oss-120b";

/** One tool, in the OpenAI function-calling shape Groq expects. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present on assistant turns when the model asked for tools. */
  tool_calls?: ToolCall[];
  /** Present on tool turns. */
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Usage {
  input: number;
  output: number;
}

export interface Provider {
  name: string;
  model: string;
  /** Tokens per minute this provider allows, input and output combined. */
  budget: number;
  /**
   * Stream one completion.
   *
   * `maxTokens` is supplied by the caller because it has to be derived from how
   * large the conversation already is. A fixed value is wrong in both
   * directions: too high and a long conversation exceeds the per-minute budget
   * with a 413; too low and a large file is truncated mid-JSON.
   */
  stream(
    messages: ChatMessage[],
    tools: ToolSpec[],
    onText: (delta: string) => void,
    maxTokens: number,
  ): Promise<{ text: string; toolCalls: ToolCall[]; usage: Usage }>;
}

/**
 * Build the configured provider.
 *
 * Throws a readable error rather than a stack when the key is missing: the route
 * turns this into the message the user sees, and "get a key at ..." is more use
 * than "Cannot read properties of undefined".
 */
export function createProvider(modelId?: string): Provider {
  const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Create a key at https://console.groq.com/keys, put it in .env.local, then restart the dev server.",
    );
  }

  const model = (modelId ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL).trim();
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    maxRetries: 2,
    timeout: 120_000,
  });

  return {
    name: "Groq",
    model,
    // Groq's free tier caps every tool-calling model at 8,000 tokens per minute,
    // input and output combined. Overridable so a paid account is not held to
    // the free-tier number.
    budget: Number(process.env.GROQ_TPM ?? 8_000),
    async stream(messages, tools, onText, maxTokens) {
      const stream = await client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools as OpenAI.Chat.ChatCompletionTool[],
        stream: true,
        // Groq rewrites 0 to 1e-8, so ask for a small non-zero value when we
        // want it to behave deterministically. 0.1 is low but valid.
        temperature: 0.1,
        max_tokens: maxTokens,
        parallel_tool_calls: true,
        // Ask for usage on the final chunk. Without this an OpenAI-compatible
        // stream reports nothing, and the run ledger displayed "0 in / 0 out" -
        // which is worse than showing nothing, because it looks like the meter
        // is broken. It also made the per-minute token bucket guess at its own
        // spend rather than know it.
        stream_options: { include_usage: true },
      });

      let text = "";
      let usage: Usage = { input: 0, output: 0 };
      const byIndex = new Map<number, ToolCall>();

      for await (const chunk of stream) {
        // The usage chunk carries no choices, so read it before the guard below.
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          text += delta.content;
          onText(delta.content);
        }

        // Tool calls arrive in fragments: first the name, then the arguments,
        // spread across chunks and keyed by their index in the array.
        for (const fragment of delta.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const existing = byIndex.get(index);

          if (!existing) {
            const created: ToolCall = {
              id: fragment.id ?? `call_${index}`,
              type: "function",
              function: {
                name: fragment.function?.name ?? "",
                arguments: fragment.function?.arguments ?? "",
              },
            };
            byIndex.set(index, created);
            continue;
          }

          if (fragment.id) existing.id = fragment.id;
          if (fragment.function?.name) {
            existing.function.name += fragment.function.name;
          }
          if (fragment.function?.arguments) {
            existing.function.arguments += fragment.function.arguments;
          }
        }
      }

      // The streamed chunks do not carry usage, so ask the API for it by
      // counting nothing and reporting what the request actually used. Groq
      // returns usage on the final chunk when `stream_options` is set; without
      // it we report zero rather than a fabricated number.
      return {
        text,
        toolCalls: [...byIndex.values()].filter((call) => call.function.name !== ""),
        usage,
      };
    },
  };
}


const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();

const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ""
).trim();

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();

export const supabaseEnv = {
  url: supabaseUrl,
  /** Browser-safe key (publishable / anon). Never a service-role key. */
  key: supabaseKey,
} as const;

/** True when both Supabase values are present. */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseKey.length > 0;

/**
 * The Anthropic key is server-only. It is deliberately NOT prefixed with
 * NEXT_PUBLIC_, because anything NEXT_PUBLIC_ is inlined into the browser
 * bundle - which would publish the key to every visitor.
 */
const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();

export const anthropicEnv = {
  key: anthropicKey,
  /**
   * Defaults to a current Sonnet. Overridable so the model can be changed
   * without a code change - which is also what the Developer lens's model
   * picker writes to once model selection is persisted.
   */
  model: (process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5").trim(),
} as const;

export const isAnthropicConfigured = anthropicKey.length > 0;

/** Shown in the UI when someone opens a real-auth screen without credentials. */
export const SUPABASE_SETUP_HINT =
  "Supabase is not configured yet. Copy .env.local.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the dev server.";

/**
 * Shown in the builder when there is no key.
 *
 * Deliberately *not* a fallback to canned output. An earlier version of this
 * app faked the agent entirely; a silent fake is worse than an honest absence,
 * because it looks like the product works.
 */
export const ANTHROPIC_SETUP_HINT =
  "ANTHROPIC_API_KEY is not set. Get one at https://console.anthropic.com/settings/keys, put it in .env.local, then restart the dev server. Architect will not pretend to build your app without it.";

export function requireSupabaseEnv(): { url: string; key: string } {
  if (!isSupabaseConfigured) {
    throw new Error(`[architect] ${SUPABASE_SETUP_HINT}`);
  }
  return { url: supabaseUrl, key: supabaseKey };
}

export function requireAnthropicEnv(): { key: string; model: string } {
  if (!isAnthropicConfigured) {
    throw new Error(`[architect] ${ANTHROPIC_SETUP_HINT}`);
  }
  return { key: anthropicKey, model: anthropicEnv.model };
}

/**
 * Base URL used for OAuth redirects (`/auth/callback`).
 *
 * Server-side this comes from NEXT_PUBLIC_SITE_URL (or Vercel's URL for
 * previews); client-side we prefer the live origin so Google sign-in also works
 * on localhost and preview deployments without extra config.
 */
export function getSiteUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  if (siteUrl) return siteUrl;
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
