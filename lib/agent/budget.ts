/**
 * The rolling per-minute token budget.
 *
 * Groq's free tier caps every tool-calling model at 8,000 tokens per minute,
 * input and output combined, and the counter is **per model** — three models in
 * the pool means roughly three times the throughput, which is the only way a
 * seven-agent pipeline fits inside a free tier.
 *
 * Two behaviours matter here and both were learned the hard way:
 *
 *  1. **The window rolls, it does not reset on the minute.** Sleeping a fixed
 *     four seconds after a 429 is a guess; a 429 can mean the rolling 60-second
 *     window is still full. This tracks spend per timestamp and waits exactly
 *     until enough of it has aged out.
 *  2. **A 429 is not a failure.** It means "ask a different model, or wait".
 *     Treating it as fatal ended builds that were one turn from done.
 */

export interface SpendEntry {
  at: number;
  tokens: number;
}

export interface TokenBucket {
  /** Can this model afford `tokens` right now? */
  canAfford(tokens: number): boolean;
  /** Record spend against this model. */
  spend(tokens: number): void;
  /** Tokens still available in the rolling window. */
  remaining(): number;
  /**
   * How long until `tokens` will fit in the window, in ms.
   * 0 when it already fits.
   */
  waitFor(tokens: number): number;
  /** Park this model for the rest of a run after a hard 429. */
  park(until: number): void;
  isParked(): boolean;
}

const WINDOW_MS = 60_000;

/**
 * Per-model ceilings on a *single* response's output, measured against the live
 * API rather than assumed.
 *
 * This is a separate limit from the 8,000 tokens-per-minute window above, and
 * conflating the two is what produced a hard 429 that ended a build:
 *
 *   The window budget says "8,000 tokens per minute, input and output". That
 *   reads as "8,000 tokens of output is fine". It is not. Each model has its own
 *   ceiling on how large one response may be, and Groq rejects the request
 *   outright if `max_tokens` exceeds it - before the window is consulted at all.
 *
 * Measured by asking each model for progressively larger `max_tokens`:
 *
 *   qwen/qwen3.8-27b      accepts up to   800  (its window is 1,000/min output)
 *   openai/gpt-oss-120b   accepts 4,000+
 *   openai/gpt-oss-20b    accepts 4,000+
 *
 * The response headers do not expose this, so it is recorded here. An unknown
 * model gets the conservative default, because guessing high is what produced
 * "429 Request too large ... reduce max_tokens" in the middle of a build.
 */
const OUTPUT_CEILINGS: Record<string, number> = {
  "qwen/qwen3.8-27b": 800,
  "qwen/qwen3-32b": 800,
  "openai/gpt-oss-120b": 4_000,
  "openai/gpt-oss-20b": 4_000,
};

const DEFAULT_OUTPUT_CEILING = 2_000;

/** The largest single response this model will accept. */
export function outputCeiling(model: string): number {
  return OUTPUT_CEILINGS[model] ?? DEFAULT_OUTPUT_CEILING;
}

/**
 * Clamp a requested output budget to what this model can actually return.
 *
 * A turn that needs more than the ceiling gets the ceiling: the file is written
 * in more, smaller pieces, which the pipeline already handles. A turn rejected
 * outright gets nothing at all.
 */
export function clampOutput(model: string, requested: number): number {
  return Math.max(256, Math.min(requested, outputCeiling(model)));
}

export function createBudgetPool(
  models: string[],
  budgetPerModel: number,
): { bucketFor(model: string): TokenBucket; models: string[] } {
  const buckets = new Map<string, TokenBucket>();

  for (const model of models) {
    buckets.set(model, createBucket(model, budgetPerModel));
  }

  return {
    models,
    bucketFor(model: string) {
      let bucket = buckets.get(model);
      if (!bucket) {
        // A model chosen in the inspector that is not in the pool still gets a
        // bucket, rather than the run failing because of a UI default.
        bucket = createBucket(model, budgetPerModel);
        buckets.set(model, bucket);
      }
      return bucket;
    },
  };
}

function createBucket(model: string, budget: number): TokenBucket {
  const entries: SpendEntry[] = [];
  let parkedUntil = 0;

  function prune(now: number) {
    while (entries.length > 0 && now - entries[0].at >= WINDOW_MS) {
      entries.shift();
    }
  }

  function used(now: number): number {
    prune(now);
    let total = 0;
    for (const entry of entries) total += entry.tokens;
    return total;
  }

  return {
    canAfford(tokens) {
      return Date.now() >= parkedUntil && used(Date.now()) + tokens <= budget;
    },
    spend(tokens) {
      if (tokens > 0) entries.push({ at: Date.now(), tokens });
    },
    remaining() {
      return Math.max(0, budget - used(Date.now()));
    },
    waitFor(tokens) {
      const now = Date.now();
      if (now < parkedUntil) return parkedUntil - now;
      prune(now);

      let total = 0;
      for (const entry of entries) total += entry.tokens;

      if (total + tokens <= budget) return 0;

      // Oldest-first: walk forward until enough spend has aged out of the
      // window. That is the exact moment the request will fit.
      let dropped = 0;
      for (const entry of entries) {
        dropped += entry.tokens;
        if (total - dropped + tokens <= budget) {
          return Math.max(0, entry.at + WINDOW_MS - now);
        }
      }
      return WINDOW_MS;
    },
    park(until) {
      parkedUntil = Math.max(parkedUntil, until);
    },
    isParked() {
      return Date.now() < parkedUntil;
    },
  };
}

/** Translate Groq's HTTP status and body into something a person can act on. */
export interface ProviderFailure {
  kind: "budget" | "context" | "malformed" | "network" | "unknown";
  message: string;
  /** Retrying the identical request cannot help. */
  retryable: boolean;
}

export function classifyProviderError(status: number, body: string): ProviderFailure {
  const text = body.toLowerCase();

  // 413 is a per-minute budget rejection, NOT a context-window problem. The
  // distinction matters: Groq's own message mentions "context window", and
  // telling a user to "describe one change at a time" when the real fix is
  // mechanical sent them off to rewrite a prompt that was already fine.
  if (status === 413 || text.includes("tokens per minute")) {
    return {
      kind: "budget",
      message:
        "The free tier's 8,000 tokens-per-minute budget was reached. Waiting for the window to refill, then continuing — your files are already saved.",
      retryable: true,
    };
  }

  if (status === 429) {
    return {
      kind: "budget",
      message: "Rate limited by the provider. Retrying shortly.",
      retryable: true,
    };
  }

  if (text.includes("context window") || text.includes("maximum context")) {
    return {
      kind: "context",
      message:
        "This request is larger than the model's context window allows. The conversation has been trimmed - try describing one change at a time.",
      retryable: false,
    };
  }

  if (text.includes("failed_generation") || text.includes("failed to call a function")) {
    return {
      kind: "malformed",
      message:
        "The model produced a malformed response on this turn. Retrying on a different model.",
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      kind: "network",
      message: "The model provider had a problem. Retrying.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    message: body.slice(0, 300) || `The provider returned ${status}.`,
    retryable: false,
  };
}
