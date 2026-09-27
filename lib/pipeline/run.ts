/**
 * The seven-agent pipeline (Sections 4, 5, 9).
 *
 * Seven real model calls, in the fixed order declared in `./agents`, each with
 * one job and one inspectable artifact. Nothing here is scripted: the prompts
 * ask, the model answers, and whatever it returns IS the artifact the user
 * clicks into. A run that says "found 3 patterns" is a run where the Researcher
 * genuinely returned three patterns.
 *
 * Three properties this is built around:
 *
 *  1. **Each agent's turn is persisted independently.** `agent_runs.agents` is
 *     rewritten after every agent, so a refresh mid-build shows the real state of
 *     the real run rather than restarting it.
 *  2. **A redirect modifies the current run.** Typing "make it blue instead" while
 *     agents are working appends to the live conversation and the next agent sees
 *     it — it is not a separate request that looks unrelated.
 *  3. **An approval gate genuinely pauses.** The run stops with state
 *     `needs-you`, the decision is stored, and resuming continues from the same
 *     agent rather than starting the pipeline again.
 */

import {
  AGENTS,
  AGENT_KEYS,
  STAGE_FOR_AGENT,
  type AgentKey,
} from "@/lib/pipeline/agents";
import { createCheckpoint, getProjectFiles } from "@/lib/pipeline/checkpoints";
import { checkImports, disallowedPackages, exportedNames, packageAdvice } from "@/lib/pipeline/exports";
import { validateSource } from "@/lib/pipeline/validate";
import { writeFileToProject } from "@/lib/pipeline/workspace";
import { createProvider, MODELS, DEFAULT_MODEL, type ChatMessage } from "@/lib/agent/provider";
import { clampOutput, createBudgetPool, outputCeiling } from "@/lib/agent/budget";
import {
  GATE_PROMPT,
  INTERFACE_PROMPT,
  PLAN_PROMPT,
  RESEARCH_PROMPT,
  REVIEW_PROMPT,
  SCHEMA_PROMPT,
  SHIP_PROMPT,
  WIRING_PROMPT,
} from "@/lib/pipeline/prompts";
import { parseWriteBlocks, summariseWriteBlocks } from "@/lib/agent/protocol";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

/** Per-agent state and artifact, re-exported from the shared client-safe module. */
export type { AgentState, AgentStates, ApprovalGate, RunEvent } from "@/lib/pipeline/types";
import type { AgentState, AgentStates, ApprovalGate, RunEvent } from "@/lib/pipeline/types";

export interface StartRunInput {
  projectId: string;
  prompt: string;
  /** Set when the user redirects an in-flight run rather than starting one. */
  isRedirect?: boolean;
  /** The stack the Interface Agent should build in (Section 10). */
  framework?: string | null;
}

export interface RunHandle {
  runId: string;
}

/**
 * The artifact each agent returns, as prose with light structure.
 *
 * These are deliberately *text*, not JSON schemas. A schema is what the agent
 * would have to satisfy exactly, and on a free-tier model with an 8,000-token
 * budget that reliably produces either a parse failure or an empty artifact.
 * Prose renders perfectly in the inspector, and the two agents whose output
 * genuinely needs structure (the schema and the review) are asked for a fenced
 * block inside the prose, which this extracts.
 */
function extractBlock(text: string, language: string): string | null {
  const fence = new RegExp("```" + language + "\\s*\\n([\\s\\S]*?)```", "i");
  const match = fence.exec(text);
  return match ? match[1].trim() : null;
}


/**
 * The seven prompts.
 *
 * Kept in one file because they are the product's actual behaviour: the copy a
 * non-technical user indirectly relies on, and the instructions that decide
 * whether the generated app is specific to their request or a generic template.
 *
 * Three rules appear in more than one prompt on purpose:
 *  - **Specificity.** "Take every specific detail seriously" is the single
 *    highest-leverage line in the whole system. A model left alone drifts toward
 *    the average app; naming a subject, workflow or audience forces it to commit.
 *  - **No placeholders.** "Never Item 1 or Lorem ipsum" because a journal seeded
 *    with Item 1 looks broken even when every line of logic is correct.
 *  - **Exact scope.** Without it the model helpfully adds accounts, social feeds
 *    and admin panels, and the user asked for none of that.
 */


/** The prompt for each agent, keyed the same way as `AGENT_KEYS`. */
const PROMPTS: Record<AgentKey, string> = {
  planner: PLAN_PROMPT,
  researcher: RESEARCH_PROMPT,
  data_schema: SCHEMA_PROMPT,
  data_wiring: WIRING_PROMPT,
  interface: INTERFACE_PROMPT,
  reviewer: REVIEW_PROMPT,
  shipper: SHIP_PROMPT,
};

/* ------------------------------------------------------------ approval gates */

/**
 * Ask the model whether this step needs a human, and if so what to ask them.
 *
 * Section 4 is explicit that a gate must be structured UI, not prose, and that
 * a non-technical user must never have to learn anything technical to say no.
 * So the model is asked for a JSON object with real options, and the run is
 * parked with `state: "needs-you"` until `answerGate` is called.
 *
 * Returns null when no gate is warranted, which is the common case — a gate on
 * every step would train people to click through them, which defeats the point.
 */
/**
 * How many approval gates this project has already asked.
 *
 * Counted from `project_messages` rather than held in memory, because a gate ends
 * the run: answering it starts a *fresh* run with fresh local state. Any count
 * kept in a variable is therefore back to zero exactly when it matters, which is
 * how a build that asked two questions ended up asking them forever.
 *
 * Only pending and answered gates count - a gate that was raised and then
 * superseded is still a question the user was made to answer.
 */
async function countGates(projectId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("project_messages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("role", "gate");
    return count ?? 0;
  } catch {
    // If the count cannot be read, the safe direction is to allow the question.
    // Silently asking one extra is a smaller failure than silently deciding
    // something on the user's behalf.
    return 0;
  }
}

/** The cap on questions a single build may ask. */
const MAX_GATES_PER_BUILD = 2;

export async function requestApprovalGate(
  projectId: string,
  runId: string,
  agentKey: AgentKey,
  context: string,
): Promise<ApprovalGate | null> {
  const provider = createProvider(DEFAULT_MODEL);
  const response = await provider.stream(
    [
      { role: "system", content: GATE_PROMPT },
      { role: "user", content: context },
    ],
    [],
    () => undefined,
    1_200,
  );

  const json = extractBlock(response.text, "json");
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // A malformed gate is not a reason to stop the user's build. Skipping the
    // gate is the safe failure: the agent proceeds with its stated default.
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const question = typeof record.question === "string" ? record.question : null;
  const why = typeof record.why === "string" ? record.why : "";
  const rawOptions = Array.isArray(record.options) ? record.options : [];

  const options = rawOptions
    .map((option) => {
      if (typeof option !== "object" || option === null) return null;
      const entry = option as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.label !== "string") return null;
      return {
        id: entry.id,
        label: entry.label,
        detail: typeof entry.detail === "string" ? entry.detail : "",
      };
    })
    .filter((option): option is ApprovalGate["options"][number] => option !== null);

  // Fewer than two real options is not a decision, it is a confirmation with
  // extra steps. Skip it.
  if (!question || options.length < 2) return null;

  const gate: ApprovalGate = {
    agentKey,
    question,
    why,
    options,
    raisedAt: new Date().toISOString(),
  };

  await persistRun(runId, { state: "needs-you", gate: gate as unknown as Json });
  await appendMessage(projectId, {
    role: "gate",
    agentKey,
    body: question,
    technical: why,
    gateStatus: "pending",
    runId,
    meta: { gate: gate as unknown as Json },
  });

  return gate;
}

/**
 * Record the user's decision and un-park the run.
 *
 * A rejection is not a dead end: the choice is appended to the conversation as
 * the user's own message, so the next agent proceeds with the direction they
 * gave rather than retrying what they declined.
 *
 * The gate is read back from the run row rather than trusted from the request.
 * The client sends the option id; it must not be able to send an *option*, or
 * the gate would be decorative — a tampered payload could name any direction and
 * the agents would follow it. This is the one place in the product where that
 * matters, so it is checked rather than assumed.
 */
export async function answerGate(
  projectId: string,
  runId: string,
  optionId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("agent_runs")
    .select("gate, state, project_id")
    .eq("id", runId)
    .maybeSingle();

  // RLS already decided whether this person can see the run at all; the project
  // check stops a run id from one project being answered against another.
  if (!run || run.project_id !== projectId) {
    return { error: "That decision is no longer waiting." };
  }
  if (run.state !== "needs-you") {
    return { error: "That decision is no longer waiting." };
  }

  const gate = readGate(run.gate);
  if (!gate) return { error: "That decision is no longer waiting." };

  const chosen = gate.options.find((option) => option.id === optionId);
  if (!chosen) return { error: "That is not one of the options." };

  const rejected = optionId === REJECT;
  const body = rejected
    ? `No — ${chosen.label}. Do something else.`
    : `${chosen.label}. ${chosen.detail}`;

  await appendMessage(projectId, {
    role: "you",
    body,
    isRedirect: true,
    runId,
  });

  await supabase
    .from("project_messages")
    .update({ gate_status: rejected ? "rejected" : "approved" })
    .eq("project_id", projectId)
    .eq("run_id", runId)
    .eq("gate_status", "pending");

  await persistRun(runId, { state: "running", gate: null });
  return { error: null };
}

export { REJECT_OPTION } from "@/lib/pipeline/types";
import { REJECT_OPTION as REJECT } from "@/lib/pipeline/types";

/** Narrow a JSONB `gate` column back to a real gate, or null if it is not one. */
function readGate(value: unknown): ApprovalGate | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.question !== "string") return null;
  if (!Array.isArray(record.options)) return null;

  const options = record.options
    .map((option) => {
      if (typeof option !== "object" || option === null) return null;
      const entry = option as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.label !== "string") return null;
      return {
        id: entry.id,
        label: entry.label,
        detail: typeof entry.detail === "string" ? entry.detail : "",
      };
    })
    .filter((option): option is ApprovalGate["options"][number] => option !== null);

  if (options.length < 2) return null;

  return {
    agentKey: record.agentKey as AgentKey,
    question: record.question,
    why: typeof record.why === "string" ? record.why : "",
    options,
    raisedAt: typeof record.raisedAt === "string" ? record.raisedAt : new Date().toISOString(),
  };
}

/* --------------------------------------------------------------- the run loop */

/**
 * The agents whose decision point is worth a gate.
 *
 * Deliberately not every agent: a gate on every step would train people to click
 * through them, which defeats the point of having one.
 */
const GATED_AGENTS = new Set<AgentKey>(["data_schema", "data_wiring"]);

/**
 * Per-agent model overrides, read from `project_settings.agent_models`.
 *
 * **This is a functional consequence of the lens, not a cosmetic one.** A
 * non-technical user is never shown a model name, so letting one sit pinned in
 * the database would mean a setting they cannot see is silently steering their
 * build. Overrides are therefore honoured *only* in the Developer view; in
 * Simple every agent runs on the default, whatever is stored.
 *
 * The stored value is left untouched, so switching to Developer restores whatever
 * the developer configured rather than silently discarding it.
 */
async function modelOverrides(
  projectId: string,
  isDeveloper: boolean,
): Promise<Record<string, string>> {
  // Resolved here, server-side, rather than passed down from the browser. A
  // client cannot be trusted to say "this user is a developer", and the check
  // has to hold for the API route as well as the UI.
  if (!isDeveloper) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_settings")
    .select("agent_models")
    .eq("project_id", projectId)
    .maybeSingle();

  const raw = (data?.agent_models ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const model of MODELS) {
    const chosen = raw[model.id];
    if (typeof chosen === "string") out[model.id] = chosen;
  }
  return out;
}

/**
 * The account's lens, for the run.
 *
 * Read through the session so the pipeline behaves the same whether it was
 * started from the builder or by any other caller of the API route.
 */
async function runIsDeveloper(): Promise<boolean> {
  // `getClaims()` returns the payload directly, not a PostgREST-style `{ data }`
  // envelope - so a signed-in user with no profile row falls back to Simple,
  // which is the safe default: no unseen setting steering the build.
  const claims = await getClaims();
  const userId = (claims as { sub?: string } | null)?.sub;
  if (!userId) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("view_mode")
    .eq("id", userId)
    .maybeSingle();

  return (data as { view_mode?: string } | null)?.view_mode === "developer";
}

/**
 * Rewrite the run row. Called after every agent, so a refresh shows real state.
 *
 * Typed as the generated `Update` shape rather than `Record<string, unknown>`,
 * because a loose patch object silently accepts a column that does not exist and
 * fails at runtime with a Postgres error instead of at compile time.
 */
async function persistRun(
  runId: string,
  patch: Database["public"]["Tables"]["agent_runs"]["Update"],
) {
  const supabase = await createClient();
  const { error } = await supabase.from("agent_runs").update(patch).eq("id", runId);
  if (error) console.error("[architect] persistRun failed:", error.message);
}

/** The brief's chat thread. One row per turn, written as it happens. */
export async function appendMessage(
  projectId: string,
  message: {
    role: "you" | "agent" | "system" | "gate";
    agentKey?: AgentKey | null;
    body: string;
    technical?: string | null;
    meta?: Record<string, unknown>;
    gateStatus?: "pending" | "approved" | "rejected" | "modified" | null;
    isRedirect?: boolean;
    runId?: string | null;
  },
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_messages")
    .insert({
      project_id: projectId,
      role: message.role,
      agent_key: message.agentKey ?? null,
      body: message.body,
      technical: message.technical ?? null,
      meta: (message.meta ?? {}) as Json,
      gate_status: message.gateStatus ?? null,
      is_redirect: message.isRedirect ?? false,
      run_id: message.runId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[architect] appendMessage failed:", error.message);
    return null;
  }
  return data;
}

/** The conversation so far, in order, formatted for the model. */
async function conversation(projectId: string): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_messages")
    .select("role, body")
    .eq("project_id", projectId)
    .in("role", ["you", "agent"])
    .order("created_at", { ascending: true })
    .limit(40);

  const messages: ChatMessage[] = [];
  for (const row of data ?? []) {
    if (!row.body.trim()) continue;
    messages.push({
      role: row.role === "you" ? "user" : "assistant",
      content: row.body,
    });
  }
  return messages;
}

/** Everything an agent needs to know about the project so far. */
async function projectBrief(
  projectId: string,
  prompt: string,
  framework: string | null,
): Promise<string> {
  const files = await getProjectFiles(projectId);
  const index = files
    .map((file) => `- ${file.path} (${file.content.split("\n").length} lines)`)
    .join("\n");

  return [
    `THE REQUEST: ${prompt}`,
    framework ? `BUILD IT IN: ${framework}` : null,
    "",
    "FILES THAT EXIST SO FAR:",
    index || "none yet",
  ]
    .filter((line) => line !== null)
    .join("\n");
}


/**
 * Run the pipeline.
 *
 * Returns once the run has completed or failed. The caller streams progress
 * through `onEvent`; this function does not own transport, because the route
 * does.
 */
export async function runPipeline(
  input: StartRunInput,
  onEvent?: (event: RunEvent) => void,
): Promise<RunHandle> {
  const { projectId, prompt, framework } = input;
  const emit = (event: RunEvent) => onEvent?.(event);
  const supabase = await createClient();

  // 1. Create the run row. Everything after this updates it, so a browser
  //    refresh mid-build reattaches to a real run instead of losing it.
  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      project_id: projectId,
      prompt,
      state: "running",
      sequence: [...AGENT_KEYS],
    })
    .select()
    .single();

  if (error || !run) {
    throw new Error("We could not start the build. Try again in a moment.");
  }

  const runId = run.id;

  // 2. The user's request is the first chat message. A redirect is marked so the
  //    UI can show it modifying the current build rather than starting a new one.
  await appendMessage(projectId, {
    role: "you",
    body: prompt,
    isRedirect: input.isRedirect,
    runId,
  });

  // 3. Per-agent model overrides. This is what makes the inspector's model
  //    selector real rather than cosmetic: the value read here is the model that
  //    actually makes the call.
  // The lens gates behaviour here, not just presentation: per-agent model pins
  // are only honoured for a Developer account, because a Simple user is never
  // shown a model name and cannot be expected to manage one.
  const isDeveloper = await runIsDeveloper();
  const overrides = await modelOverrides(projectId, isDeveloper);
  // The model pool.
  //
  // A writer is only added to a writing agent's rotation if it can actually
  // write: its per-response ceiling has to be big enough for a real file. qwen
  // tops out at 800 output tokens, which is roughly a 40-line component - the
  // same size as the skeleton this build shipped. It stays in the pool for the
  // reading agents, where a short answer is all that is needed, and is excluded
  // for the two agents whose whole job is to write files.
  const allModels = [...MODELS.map((m) => m.id), DEFAULT_MODEL];
  const writingModels = allModels.filter((id) => outputCeiling(id) >= 2_000);

  const pool = createBudgetPool(allModels, 8_000);

  const brief = await projectBrief(projectId, prompt, framework ?? null);
  const history = await conversation(projectId);

  const agents: AgentStates = {};
  let totalTokens = 0;

  for (const spec of AGENTS) {
    const stage = STAGE_FOR_AGENT[spec.key];
    const model = overrides[spec.key] ?? DEFAULT_MODEL;
    // Writing agents draw only from models that can write a file in one
    // response. See the pool comment for why qwen is excluded here.
    const rotation = spec.writes ? writingModels : allModels;
    const started = Date.now();

    // An approval gate before the first agent that writes code.
    //
    // This is a functional difference between the lenses, and the reasoning is
    // worth stating because it is not obvious from the button that appears.
    //
    // A gate is a question with real trade-offs - a data model, a screen, a
    // destructive action. A developer is equipped to answer that: they can read
    // the schema, compare it to what they already run, and judge the cost. A
    // non-technical user cannot answer "which of these two shapes should your
    // records take?" without guessing, and the brief says they should *never have
    // to learn anything technical to say no*.
    //
    // So the gate fires for a Developer and not for a Simple user. What a Simple
    // user gets instead is a plain-language status line for the same decision, so
    // the moment is still visible - it just is not a technical choice dressed up
    // as an Approve button. This is the clearest case in the product of the lens
    // changing what happens rather than what is drawn.
    if (isDeveloper && GATED_AGENTS.has(spec.key)) {
      /*
       * At most two questions per build.
       *
       * A gate ends the run, so answering it starts a *new* run. The new run had
       * no memory that a question had already been asked, so it raised the next
       * one - and the build interrogated the user indefinitely, which is the
       * opposite of "asks you only when there is a real decision to make".
       *
       * The count is therefore read from the conversation, which survives across
       * runs, rather than from a local that each new run resets. Past the cap the
       * agent proceeds and says what it decided, so the moment stays visible
       * without demanding an answer.
       */
      const askedAlready = await countGates(projectId);
      if (askedAlready < MAX_GATES_PER_BUILD) {
        const gate = await requestApprovalGate(projectId, runId, spec.key, brief);
        if (gate) {
          emit({ type: "gate", gate });
          await persistRun(runId, { gate: gate as unknown as Json });
          // The run parks here. The client shows the choice and resumes with the
          // `resume` flag once it is answered.
          return { runId };
        }
      } else {
        emit({
          type: "agent-text",
          agentKey: spec.key,
          delta: `You have already answered ${MAX_GATES_PER_BUILD} questions in this build, so I have taken the next decision myself: ${brief}`,
        });
      }
    }

    const state: AgentState = {
      state: "running",
      model,
      plain: spec.working,
      technical: spec.technicalWorking,
      artifact: null,
      files: [],
      rejected: [],
      exports: {},
      tokens: 0,
      seconds: null,
      error: null,
    };
    agents[spec.key] = state;

    emit({ type: "agent-start", agentKey: spec.key, stage, model });
    await persistRun(runId, { agents: agents as unknown as Json });

    // Every agent sees its own prompt, the request, and the file index. File
    // *contents* travel only inside a write block, so a long run does not
    // resend the whole codebase on every turn.
    const messages: ChatMessage[] = [
      { role: "system", content: PROMPTS[spec.key] },
      { role: "system", content: brief },
      ...history,
    ];

    // A follow-up tells the agent to change rather than rebuild, which is what
    // makes "make it blue instead" cheap.
    if (history.length > 2) {
      messages.push({
        role: "user",
        content:
          "This is a change to the existing app. Make the smallest change that satisfies it, reusing what already exists.",
      });
    }

    let text = "";
    let agentTokens = 0;
    let failure: string | null = null;
    let activeModel = model;

    // How many times a writing agent may respond.
    //
    // This was 2, and that is the direct cause of the regression where builds
    // dropped from four or five files to one. The Interface Agent is expected to
    // produce a page plus several components, and the pipeline now rejects a
    // file whose imports do not line up. With two turns, a single rejection used
    // up half the budget, so the agent spent its first response guessing the
    // storage API, got told it was wrong, and used its last response correcting
    // one file. It then reported "done".
    //
    // The budget is paced per request by the token bucket, so extra turns cost
    // tokens rather than wall-clock, and a rejected turn usually costs nothing
    // because no completion came back. Six is enough for write, get corrected,
    // and continue; it does not let a broken agent loop.
    const maxTurns = spec.writes ? 6 : 1;


/**
 * The smallest an interface may be before the Interface Agent is sent back to work.
 *
 * Calibrated against real output rather than guessed. A skeleton that reported
 * itself "done" was one 43-line page plus a 128-line storage module - 171 lines in
 * total, and none of it an interface. Finished builds land between 300 and 900. 260
 * sits below every genuine build and above every stub, so it catches the failure
 * without rejecting a small but real app. Only files under app/ count; lib/storage.ts is
 * the Data Agent's and would otherwise satisfy the bar on its own.
 */
const MIN_UI_LINES = 240;

/**
 * The fewest files under app/ that count as a built interface.
 *
 * Lines alone were not enough. A single 260-line `page.tsx` satisfied the line
 * bar on its own while containing no components at all, and a seven-line file
 * satisfied neither. Real builds observed split into an entry plus two to four
 * components, so three is a floor that a single monolithic file cannot reach.
 */
const MIN_UI_FILES = 3;

/**
 * The smallest `app/page.tsx` that counts as a real screen.
 *
 * Measured against what actually happened: a build shipped a six-line entry file
 * beside a 295-line component, and every line of that component was invisible
 * because nothing imported it. The aggregate line count passed at 373 - the
 * total was dominated by a file the preview never rendered.
 *
 * 60 lines is the floor for a screen that composes components, holds page state
 * and renders real data. Below that it is a stub, whatever else exists beside it.
 */
const MIN_ENTRY_LINES = 60;

/**
 * How many times one request may be retried after the provider rejects it,
 * before the run gives up on that agent.
 *
 * Four, with a growing pause. A tool-choice rejection and a malformed
 * response are the model misbehaving rather than the request being wrong, and
 * both are usually not reproducible - the same request succeeds moments later.
 * Without a bound this would spin; with the old bound of one it died on the
 * second failure.
 */
const MAX_API_ATTEMPTS = 4;

    for (let turn = 0; turn < maxTurns; turn++) {
      let bucket = pool.bucketFor(activeModel);
      const wanted = 4_000;
      // Retries for a request the provider rejected. Deliberately separate from
      // `turn`: a rejected request is not an attempt at the job, so it must not
      // eat the agent's small budget for actually doing the work.
      let apiAttempts = 0;

      if (!bucket.canAfford(wanted)) {
        const waitMs = bucket.waitFor(wanted);
        const alternative = rotation.find((id) => pool.bucketFor(id).canAfford(wanted));

        if (alternative && alternative !== activeModel) {
          activeModel = alternative;
          bucket = pool.bucketFor(activeModel);
          state.model = activeModel;
          emit({
            type: "model-switch",
            from: model,
            to: activeModel,
            reason: "the original model's free-tier budget was used this minute",
          });
        } else {
          emit({
            type: "waiting",
            reason: "waiting for the free-tier budget to refill",
            resumeAt: waitMs,
          });
          await sleep(Math.min(waitMs, 65_000));
          bucket = pool.bucketFor(activeModel);
        }
      }

      const provider = createProvider(activeModel);
      // Clamped twice: by what the window can still afford, and by what this model
      // will accept for a single response. The two are different limits - qwen
      // allows 8,000 tokens per minute but rejects any single response over 800.
      const maxTokens = clampOutput(activeModel, Math.max(1_200, Math.min(4_000, bucket.remaining() - 800)));

      try {
        const result = await provider.stream(
          messages,
          [],
          (delta) => {
            text += delta;
            emit({ type: "agent-text", agentKey: spec.key, delta });
          },
          maxTokens,
        );

        agentTokens += result.usage.input + result.usage.output;
        bucket.spend(result.usage.input + result.usage.output);
        totalTokens += result.usage.input + result.usage.output;

        // 4. Writing agents: turn assistant text into real file rows.
        if (spec.writes) {
          const blocks = parseWriteBlocks(result.text);
          const rejected: string[] = [];

          // What every existing project file exports, so an import can be
          // checked against reality before the file is saved. Rebuilt per block
          // so a file written earlier in this same turn is visible to a later
          // one.
          const available = new Map<string, string[]>();
          for (const record of await getProjectFiles(projectId)) {
            available.set(record.path, exportedNames(record.content));
          }



          // Every path in the response counts, including one whose block was cut off
          // by the token ceiling.
          //
          // Previously only complete blocks were listed, which set off a cascade: a
          // truncated component was not in `pending`, so the page importing it was
          // rejected as importing a file that did not exist - and that page was the
          // only real UI. One truncated component could delete the whole interface.
          // The truncated file is discarded either way, but it must not take the
          // page with it.
          const pending = new Set(blocks.map((b) => b.path));


          for (const block of blocks) {
            if (!block.complete) {
              // A block with no closing tag was cut off by the token ceiling.
              // Skipping it is right, and saying so is better than a silent
              // drop that looks like the agent ignored the request.
              rejected.push(
                `${block.path}: your response ended before the closing </architect:write> tag, so it was not saved.`,
              );
              continue;
            }

            // Parse before persisting. A truncated file that reaches the
            // database becomes a blank preview the user cannot diagnose, and the
            // agent never learns it happened. Rejecting here turns it into a
            // message the agent can act on.
            const check = await validateSource(block.path, block.content);
            if (!check.valid) {
              rejected.push(
                `${check.error} — the file was NOT saved. Fix that line and write the whole file again.`,
              );
              continue;
            }

            // An import of a name the target does not export is the same class
            // of defect as a syntax error — the file cannot run — so it is
            // caught here rather than three surfaces later in the preview.
            // A package that is not installed. This is the single most expensive
            // silent failure there is: `import { format } from "date-fns"` resolves to
            // an empty module, the call returns undefined, React throws while
            // rendering, and the user gets a blank white screen with no error
            // anywhere - even though every file around it was complete and good.
            const forbidden = disallowedPackages(block.content);
            if (forbidden.length > 0) {
              rejected.push(
                packageAdvice(forbidden) + " The file was NOT saved - rewrite it with no such import.",
              );
              continue;
            }

            const importProblems = checkImports(block.path, block.content, available, pending);
            if (importProblems.length > 0) {
              rejected.push(
                `${importProblems.join("\n")} The file was NOT saved.`,
              );
              continue;
            }

            const write = await writeFileToProject(projectId, block.path, block.content);
            if (write.ok && write.path) {
              state.files.push(write.path);
              // The export list is captured here, from the text that was actually
              // written, and handed to the next agent. That hand-off is the whole
              // fix: the next agent was inventing function names because nothing
              // ever told it what the previous one had produced.
              const names = exportedNames(block.content);
              state.exports[write.path] = names;
              available.set(write.path, names);
              emit({
                type: "file-written",
                path: write.path,
                language: write.language ?? "text",
              });
            }
          }

          // Replace file bodies with one-line receipts before the next turn.
          // Re-sending them is what blew the budget on long builds.
          messages.push({
            role: "assistant",
            content: summariseWriteBlocks(result.text, blocks),
          });

          // A rejection is fed back as a turn, so the agent repairs its own work
          // rather than leaving the user with a broken build.
          if (rejected.length > 0) {
            messages.push({
              role: "user",
              content: rejected.join("\n"),
            });
            state.rejected.push(...rejected);
          }
        }

        if (spec.writes && state.files.length === 0 && turn < maxTurns - 1) {
          messages.push({
            role: "user",
            content:
              "You replied with text, not code. Nothing was saved and the user is looking at an empty screen.\n\n" +
              "Your reply must contain at least one <architect:write path=\"...\"> block containing a fenced code block. " +
              "Start your reply with that tag - do not explain, do not plan, do not summarise. " +
              "Write the first file now.",
          });
          continue;
        }

        // A build that is too small to be the app the user asked for.
        //
        // The only previous check was "did it write anything", and that passed a
        // 43-line page.tsx with nine class names: technically a file, completely
        // not an app. The user saw a text-filled box and called the agents a
        // joke, correctly - the run reported every agent as "done" while shipping
        // a skeleton.
        //
        // So the Interface Agent is held to a real bar before its turn is allowed
        // to end. The threshold is deliberately low: it exists to catch a stub,
        // not to grade the design. The prompt tells the model exactly how far
        // short it fell, because "keep going" without a number gets one more
        // 40-line file.
        if (
          spec.key === "interface" &&
          !input.isRedirect &&
          turn < maxTurns - 1
        ) {
          const written = await getProjectFiles(projectId);
          // Only the interface counts. `lib/storage.ts` is the Data Agent's work
          // and is typically 120-190 lines on its own, so including it let a
          // 130-line page pass a 260-line bar - which is precisely the skeleton
          // this check exists to reject.
          const uiFiles = written.filter((f) => f.path.startsWith("app/"));
          const uiLines = uiFiles.reduce(
            (sum, file) => sum + file.content.split("\n").length,
            0,
          );

          // The entry file, checked on its own.
          //
          // This is the white screen. A build produced a 295-line transaction
          // list, a 58-line sidebar and a real 225-line storage module - and a
          // SIX-LINE `app/page.tsx` that rendered nothing. The aggregate check
          // passed comfortably at 373 lines across 4 files, because the total was
          // dominated by a component the entry point never imported. Every good
          // file in the project was invisible at runtime.
          //
          // Nothing below this line runs unless the entry file renders it, so the
          // entry file is the thing that has to be real.
          const entry =
            written.find((f) => f.path === "app/page.tsx") ??
            written.find((f) => /^app\/[^/]+\/page\.tsx$/.test(f.path));
          const entryLines = entry ? entry.content.split("\n").length : 0;

          if (
            uiLines < MIN_UI_LINES ||
            uiFiles.length < MIN_UI_FILES ||
            entryLines < MIN_ENTRY_LINES
          ) {
            const problems: string[] = [];
            if (uiLines < MIN_UI_LINES) {
              problems.push(`only ${uiLines} lines of interface (needs ${MIN_UI_LINES})`);
            }
            if (uiFiles.length < MIN_UI_FILES) {
              problems.push(`only ${uiFiles.length} files (needs ${MIN_UI_FILES})`);
            }
            if (entryLines < MIN_ENTRY_LINES) {
              problems.push(
                `app/page.tsx is only ${entryLines} lines - this is the file the preview renders, ` +
                  `and nothing built in app/components/ is visible unless this file imports and uses it`,
              );
            }

            messages.push({
              role: "user",
              content:
                `The build is not finished: ${problems.join("; ")}.\n\n` +
                `This is the most important thing to fix. app/page.tsx is the entry point the preview ` +
                `actually renders. Right now the other files exist but nothing displays them.\n\n` +
                `Rewrite app/page.tsx so that it:\n` +
                `- is at least ${MIN_ENTRY_LINES} lines and builds the real screen\n` +
                `- imports the components you wrote and renders them\n` +
                `- passes them the data they need, and holds the page state\n\n` +
                `Style it with Tailwind classes, not inline styles. Write it now.`,
            });
            continue;
          }
        }

        // A writing agent that ends with nothing.
        //
        // This is the bug behind "the agents do nothing". Builds reported
        // `state: done` for every agent while the Interface Agent had written zero
        // files and rejected zero files - it had produced prose instead of write
        // blocks, run out of turns, and been recorded as a success. The run then
        // looked complete and the preview stayed empty.
        //
        // Reporting it as a failure was right, but *stopping the whole build* was
        // wrong, and that is what produced the white screen. The chain was:
        //
        //   Data Agent writes lib/storage.ts -> one bad line -> file rejected
        //   -> zero files -> build aborted -> Interface Agent never runs
        //   -> no UI was ever generated -> blank preview
        //
        // A data layer is not a prerequisite for a visible interface. The
        // Interface Agent can build the screens and its own local state, and the
        // user gets something they can see, click and judge - which is
        // immeasurably more useful than a blank page. The data agent's failure is
        // still reported, in the thread, in its own words.
        if (spec.writes && state.files.length === 0) {
          const note =
            `${spec.name} could not finish its file, so this part of the build is missing. ` +
            `The rest of the team is continuing so you get something usable.`;
          state.state = "failed";
          state.error = note;
          emit({ type: "agent-failed", agentKey: spec.key, error: note });
          await appendMessage(projectId, {
            role: "agent",
            agentKey: spec.key,
            body: `Stopped: ${note}`,
            technical: state.rejected[0] ?? note,
            runId,
            meta: { error: true },
          });
        }

        break;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        // A malformed or budget response is retried on a different model rather
        // than ending the run. gpt-oss-20b fails roughly one turn in three, and
        // ending a build on that is indefensible.
        //
        // "Tool choice is none, but model called a tool" is in this list because
        // it arrived as a hard stop on the Interface Agent: the model emitted a
        // tool call on a turn with no tools, Groq rejected the whole request, and
        // the build died with a message about tooling rather than about the UI
        // the user asked for. The provider now omits tool configuration entirely
        // when there are no tools, which removes the cause; this pattern is the
        // belt to that braces, because the same failure can surface from a
        // replayed history that still contains tool calls.
        if (/tokens per day|TPD|daily token/i.test(message)) {
            // The free tier is capped per DAY as well as per minute, and the
            // headers only report the minute. Hitting the daily cap ends a build
            // with a generic 429 that looks identical to a rate blip, so the user
            // is left thinking the agents are at fault. They are not.
            failure =
              "Groq's free tier allows 200,000 tokens per day and that quota is used up. " +
              "The agents stopped mid-build because there is nothing left to spend, not because of " +
              "anything wrong with your app. It resets at midnight UTC. " +
              "For real projects, add a payment method on the Groq console and the cap rises sharply.";
            state.state = "failed";
            state.error = failure;
            emit({ type: "agent-failed", agentKey: spec.key, error: failure });
            await persistRun(runId, {
              state: "failed",
              agents: agents as unknown as Json,
              error: failure,
              tokens: totalTokens,
              finished_at: new Date().toISOString(),
            });
            await appendMessage(projectId, {
              role: "agent",
              agentKey: spec.key,
              body: `Stopped: ${failure}`,
              technical: message,
              runId,
              meta: { error: true },
            });
            return { runId };
          }

          if (/413|429|failed_generation|failed to call|malformed|rate|tool choice|called a tool|tool_calls/i.test(message)) {
          const alternative = rotation.find(
            (id) => id !== activeModel && pool.bucketFor(id).canAfford(wanted),
          );
          if (alternative) {
            emit({
              type: "model-switch",
              from: activeModel,
              to: alternative,
              reason: "that model produced an unusable response",
            });
            activeModel = alternative;
            state.model = alternative;
            bucket = pool.bucketFor(alternative);
            continue;
          }

          // No other model is free right now.
          //
          // This retries the identical request WITHOUT consuming a content turn.
          //
          // That distinction is the whole fix. `turn` is the agent's budget for
          // doing its job - write a file, read it back, repair it - and a writer
          // only gets two. Spending one on a transport hiccup meant a single
          // transient "Tool choice is none, but model called a tool" left the
          // Interface Agent one attempt, and if that errored too the run died
          // with a message about tooling rather than about the app the user
          // asked for. The agent was being marked "done" for work it never did.
          //
          // A rejected request is not an attempt at the job. It gets its own
          // budget, resets on every success, and the user is told what is
          // happening so a wait does not look like a hang.
          // A rejected request is not an attempt at the job, so it gets its own
          // budget and does not consume a turn. The user is told what is
          // happening so a wait does not look like a hang.
          const recoverable =
            /tool choice|called a tool|tool_calls|failed to call|malformed|failed_generation/i.test(
              message,
            );
          if (recoverable && apiAttempts < MAX_API_ATTEMPTS) {
            apiAttempts += 1;
            // Growing pause, so a repeatedly unhappy model is not hammered, and
            // long enough that a rolling per-minute window has partly refilled.
            const waitMs = Math.min(
              2_000 * apiAttempts,
              Math.max(bucket.waitFor(wanted), 2_000),
            );
            emit({
              type: "waiting",
              reason: `the model returned an unusable response - retrying (attempt ${apiAttempts + 1} of ${MAX_API_ATTEMPTS})`,
              resumeAt: Date.now() + waitMs,
            });
            await sleep(waitMs);
            continue;
          }

          // Out of turns, or the failure is one waiting cannot fix.
          if (/413|429|rate/i.test(message)) {
            const waitMs = Math.min(bucket.waitFor(wanted), 65_000);
            if (waitMs > 0) {
              emit({
                type: "waiting",
                reason: "waiting for the token budget to refill",
                resumeAt: Date.now() + waitMs,
              });
              await sleep(waitMs);
              continue;
            }
          }
        }
        failure = message;
        break;
      }
    }


    state.seconds = Math.round((Date.now() - started) / 1000);
    state.tokens = agentTokens;

    if (failure) {
      state.state = "failed";
      state.error = failure;
      emit({ type: "agent-failed", agentKey: spec.key, error: failure });
      await persistRun(runId, {
        state: "failed",
        agents: agents as unknown as Json,
        error: failure,
        tokens: totalTokens,
        finished_at: new Date().toISOString(),
      });
      await appendMessage(projectId, {
        role: "agent",
        agentKey: spec.key,
        body: `Stopped: ${failure}`,
        technical: failure,
        runId,
        meta: { error: true },
      });
      return { runId };
    }

    // 5. Store the agent's own words as its artifact. This is what the inspector
    //    renders, so the user reads exactly what the model produced rather than a
    //    summary written about it.
    const sql = spec.key === "data_schema" ? extractBlock(text, "sql") : null;
    state.artifact = sql
      ? ({ sql, prose: text.replace(sql, "").trim() } as unknown as Json)
      : (text as unknown as Json);

    state.state = "done";
    // A done status line is the agent's real outcome, not a canned string.
    state.plain = firstSentence(text) || spec.working;

    emit({
      type: "agent-done",
      agentKey: spec.key,
      files: state.files,
      seconds: state.seconds,
      tokens: agentTokens,
    });

    await appendMessage(projectId, {
      role: "agent",
      agentKey: spec.key,
      body: state.plain,
      technical: `${spec.name} — ${spec.technicalWorking} (${activeModel})`,
      runId,
      meta: { files: state.files, model: activeModel, seconds: state.seconds },
    });

    await persistRun(runId, { agents: agents as unknown as Json, tokens: totalTokens });

    // A checkpoint after every agent that actually changed something.
    //
    // There used to be exactly one checkpoint per run, written at the very end -
    // so seven specialists produced a single history entry, and "go back one
    // step" meant losing the whole build. The brief asks for "any previous
    // checkpoint at any time", which a one-entry timeline cannot offer.
    //
    // The label is the agent's own first sentence, so the row says what happened
    // rather than which agent happened. Reading agents are skipped: they change
    // nothing, and a timeline full of entries that altered no files is noise.
    if (state.files.length > 0) {
      try {
        // The result is checked, not just awaited: `createCheckpoint` signals a
        // rejected insert by *returning* an error rather than throwing, so
        // awaiting it alone discards the only evidence that a version was lost.
        const saved = await createCheckpoint({
          projectId,
          runId,
          label: checkpointLabel(spec, text, state.files),
          modelSummary: { [spec.key]: activeModel },
        });
        if (saved.error) {
          console.error(
            `[architect] CHECKPOINT FAILED after ${spec.key}:`,
            saved.error,
            "- this change cannot be undone",
          );
        }
      } catch (error) {
        // A failed checkpoint must not lose the build. The files are already
        // written and the run continues; the timeline is simply one entry short,
        // and the final checkpoint below still lands.
        console.error("[architect] checkpoint after agent failed:", error);
      }
    }

    // Later agents read what earlier ones produced. Only the summary, never the
    // file contents, so the conversation stays small as the run grows.
    history.push({
      role: "assistant",
      content: summariseForNextAgent(spec.key, text, state.files, state.exports),
    });
  }

  // 6. The Reviewer writes a plain-language outcome as the last line of its
  //    output. That is the checkpoint label — generated, never typed by hand.
  const receipt = extractReceipt(agents.reviewer?.artifact) ?? "The build finished.";

  const modelSummary: Record<string, string> = {};
  for (const spec of AGENTS) {
    const used = agents[spec.key]?.model;
    if (used) modelSummary[spec.key] = used;
  }

  // 7. A real checkpoint, so this build can be rolled back later.
  await createCheckpoint({
    projectId,
    runId,
    label: receipt,
    modelSummary,
  });

  await persistRun(runId, {
    state: "done",
    agents: agents as unknown as Json,
    receipt,
    tokens: totalTokens,
    finished_at: new Date().toISOString(),
  });

  emit({ type: "complete", runId, receipt });
  return { runId };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** First sentence of the model's output, trimmed to something a status line can hold. */
function firstSentence(text: string): string | null {
  const clean = text
    .replace(/<architect:write[\s\S]*?<\/architect:write>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const match = /^[^.!?]*[.!?]/.exec(clean);
  return (match ? match[0] : clean.slice(0, 140)).trim();
}

/**
 * A checkpoint label that says what changed.
 *
 * `firstSentence` is the right source when the agent explained itself in prose.
 * But a writing agent frequently returns *only* write blocks - no commentary at
 * all - and then stripping the blocks leaves nothing, so the label fell back to
 * "Data Agent finished." That is a title that tells the user nothing, on the one
 * screen whose whole job is to tell them what just happened.
 *
 * So when there is no sentence, the label is built from what the agent actually
 * did: how many files, and which ones. Naming the file is more useful than naming
 * the agent, because it is the thing the user would recognise.
 */
function checkpointLabel(
  spec: { name: string; key: AgentKey },
  text: string,
  files: string[],
): string {
  const said = firstSentence(text);
  if (said) return said;

  if (files.length === 1) {
    const name = files[0].split("/").pop() ?? files[0];
    return `${spec.name} added ${name}.`;
  }
  if (files.length > 1) {
    const names = files.slice(0, 2).map((f) => f.split("/").pop() ?? f);
    const rest = files.length - names.length;
    return rest > 0
      ? `${spec.name} added ${names.join(" and ")}, and ${rest} more file${rest === 1 ? "" : "s"}.`
      : `${spec.name} added ${names.join(" and ")}.`;
  }
  return `${spec.name} finished.`;
}

/** The Reviewer's closing line, which the prompt asks it to write as a plain outcome. */
function extractReceipt(artifact: unknown): string | null {
  if (typeof artifact !== "string") return null;
  const lines = artifact
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/^[-*\d.\s]+/, "").trim();
    if (line.length > 20 && line.length < 240 && !line.includes("```")) return line;
  }
  return null;
}

/**
 * A compact hand-off, so the next agent knows what changed without the code.
 *
 * The export list is the important part. The previous version said only
 * "data_wiring: wrote lib/storage.ts", and the Interface Agent — which cannot
 * see that file — invented `getNotes`, `setNotes` and `getQuizzes` rather than
 * the `listNotes` and `addNote` that actually existed. Fourteen build errors
 * followed. Naming the exports is the contract between agents.
 */
function summariseForNextAgent(
  key: AgentKey,
  text: string,
  files: string[],
  exports: Record<string, string[]> = {},
): string {
  if (files.length > 0) {
    const written = files
      .map((path) => {
        const names = exports[path];
        // A file with no exports is still worth naming; an empty list would
        // read as "unknown", so say so.
        if (!names) return path;
        if (names.length === 0 || names.includes("*")) {
          return `${path} (exports not enumerable)`;
        }
        return `${path} exports: ${names.join(", ")}`;
      })
      .join("\n");
    return `${key} wrote:\n${written}`;
  }
  const summary = firstSentence(text);
  return summary ? `${key}: ${summary}` : `${key}: done.`;
}


