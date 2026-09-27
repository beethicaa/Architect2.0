/**
 * Answer a parked approval gate.
 *
 * The run is sitting at `needs-you` with a gate stored on it. This records the
 * decision and un-parks the run, appending the answer as the user's own message
 * so the next agent proceeds in the direction they gave rather than retrying
 * what they declined.
 *
 * A separate route from the pipeline stream because a gate answer is a discrete
 * user action, not part of a long-lived response — and because the original
 * request is long gone by the time they answer it.
 */

import { NextResponse } from "next/server";

import { answerGate, type ApprovalGate } from "@/lib/pipeline/run";
import { getClaims } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(
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
    runId?: string;
    gate?: ApprovalGate;
    optionId?: string;
  };

  if (!body.runId || !body.optionId) {
    return NextResponse.json(
      { error: "That decision did not come through. Try again." },
      { status: 400 },
    );
  }

  // Only the run id and the chosen option id cross the wire. The gate itself is
  // read back from the run row server-side, so a tampered payload cannot inject
  // an option the agent never offered.
  const result = await answerGate(id, body.runId, body.optionId);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
