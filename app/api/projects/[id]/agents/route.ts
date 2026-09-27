/**
 * Per-agent model overrides.
 *
 * Section 5 requires that the model selector "must actually change which model
 * backs that agent's calls, not be cosmetic". It does: `runPipeline` reads
 * `project_settings.agent_models` once before the loop and uses the chosen value
 * for that agent's `createProvider` call, so a change here is the difference
 * between two different models answering.
 *
 * Simple mode has no access to this at all — the inspector hides the control
 * entirely, so the lens rule holds structurally rather than by convention.
 */

import { NextResponse } from "next/server";

import { MODELS } from "@/lib/agent/provider";
import { isSupabaseConfigured } from "@/lib/env";
import { AGENT_KEYS, type AgentKey } from "@/lib/pipeline/agents";
import { createClient, getClaims } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

const VALID_AGENTS = new Set<string>(AGENT_KEYS);

/**
 * Set (or clear) the model for one agent.
 *
 * The whole map is read, one key changed, and the map written back. Postgres
 * has no "update one key of a JSONB object" here that would avoid a lost update,
 * and a read-modify-write inside a single request is the honest amount of
 * complexity for seven keys.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    agentKey?: string;
    model?: string | null;
  };

  if (!body.agentKey || !VALID_AGENTS.has(body.agentKey)) {
    return NextResponse.json({ error: "That is not one of the agents." }, { status: 400 });
  }

  // The model is validated against the catalogue rather than trusted, so a
  // hand-edited request cannot make the pipeline call an arbitrary model id.
  if (body.model !== null && !MODELS.some((entry) => entry.id === body.model)) {
    return NextResponse.json({ error: "That model is not available." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("project_settings")
    .select("agent_models")
    .eq("project_id", id)
    .maybeSingle();

  const map = { ...((current?.agent_models ?? {}) as Record<string, unknown>) };

  if (body.model === null || body.model === undefined) {
    // Clearing means "use the pool default", so the key is removed rather than
    // set to an empty string — otherwise the run would try to call "".
    delete map[body.agentKey];
  } else {
    map[body.agentKey] = body.model;
  }

  // RLS decides whether this person may edit the project. A read-only member
  // gets an error rather than a silent no-op that looks like it saved.
  const { error } = await supabase
    .from("project_settings")
    .update({ agent_models: map as Json })
    .eq("project_id", id);

  if (error) {
    return NextResponse.json(
      { error: "We could not save that. You may only view this project." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, agentKey: body.agentKey as AgentKey, agentModels: map });
}
