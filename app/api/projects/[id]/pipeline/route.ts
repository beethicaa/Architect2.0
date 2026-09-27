/**
 * The pipeline's HTTP surface.
 *
 * A single streaming NDJSON endpoint rather than a WebSocket, for one honest
 * reason: a run is a sequence of model calls that can take minutes and can be
 * paused for a free-tier budget refill, so a request that stays open is the
 * wrong shape. NDJSON over `fetch` streams fine, survives a proxy that buffers
 * chunked responses, and — because every step is also written to Postgres —
 * reconnects cleanly. If the connection drops mid-build the run continues on the
 * server and the client reattaches by reading `agent_runs` (Section 10's
 * reconnect requirement).
 *
 * Each line is a `RunEvent`, so the client applies the same reducer whether the
 * event arrived over the socket or from a reload.
 */

import { NextResponse } from "next/server";

import { runPipeline, type RunEvent } from "@/lib/pipeline/run";
import { createClient, getClaims } from "@/lib/supabase/server";
import { isGroqConfigured, GROQ_SETUP_HINT } from "@/lib/env";
import { isSupabaseConfigured } from "@/lib/env";

export const runtime = "nodejs";
/** A seven-agent run on a free tier can legitimately take several minutes. */
export const maxDuration = 300;

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

  if (!isGroqConfigured) {
    // Refuse honestly rather than simulate a build. A fake build that reports
    // success is worse than no build at all.
    return NextResponse.json({ error: GROQ_SETUP_HINT }, { status: 503 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    isRedirect?: boolean;
    framework?: string | null;
    /**
     * Continue a run that parked on an approval gate, without adding a turn to
     * the conversation.
     *
     * The gate endpoint has already written the decision into
     * `project_messages`, so the next agent reads it from the replayed history.
     * This exists because the only way to resume without a flag was to post a
     * placeholder message like "Continue the build." - which worked, and put
     * noise in the thread that the user never wrote and could not explain.
     */
    resume?: boolean;
  };

  const prompt = (body.prompt ?? "").trim();
  const resuming = body.resume === true;
  if (prompt.length < 3 && !resuming) {
    return NextResponse.json(
      { error: "Describe what you want in a sentence or two." },
      { status: 400 },
    );
  }

  // RLS decides whether this person may build in this project. There is no
  // ownership check in application code, because a forgotten one here would
  // bypass every policy below it.
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "That project was not found." }, { status: 404 });
  }

  await supabase
    .from("projects")
    .update({ status: "building" })
    .eq("id", id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const { runId } = await runPipeline(
          {
            projectId: id,
            // A resume carries no new prompt: the decision that unblocked it is
            // already in `project_messages` and is replayed as history, so adding
            // another turn here would only put a line in the thread that the user
            // never wrote.
            prompt: resuming ? "" : prompt,
            isRedirect: body.isRedirect,
            framework: body.framework,
          },
          send,
        );
        send({ type: "complete", runId, receipt: "" });
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "The build stopped unexpectedly.";
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "failed", error: message })}\n`),
        );
      } finally {
        await supabase.from("projects").update({ status: "ready" }).eq("id", id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
