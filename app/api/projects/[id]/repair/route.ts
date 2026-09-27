/**
 * Repair specific files.
 *
 * The dead end this removes: a build whose *entry* file is broken cannot render
 * a preview, and every other screen is therefore unreachable. The user is left
 * staring at "Build failed with 1 error" with no way forward except typing a
 * request in prose and hoping the agent rewrites the right thing.
 *
 * So this is the same pipeline, started with a precise instruction and the real
 * compile error attached. It is deliberately not a separate code path: a repair
 * run is an ordinary run, which means it is budgeted, checkpointed, streamed and
 * inspectable exactly like any other.
 */

import { NextResponse } from "next/server";

import { runPipeline } from "@/lib/pipeline/run";
import { isGroqConfigured, GROQ_SETUP_HINT, isSupabaseConfigured } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";
import { dependencyOrder, diagnoseProject } from "@/lib/pipeline/diagnose";

export const runtime = "nodejs";
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
    return NextResponse.json({ error: GROQ_SETUP_HINT }, { status: 503 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    paths?: string[];
    error?: string;
  };

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "That project was not found." }, { status: 404 });
  }

  // Which files are actually broken is recomputed here rather than trusted from
  // the request: the client is asking for help, and it may be out of date.
  //
  // It must be a full diagnosis - parse *and* imports. Using only the parse
  // check computed an empty list for a project whose every file parsed cleanly
  // and whose only fault was importing names nobody exported, so the repair run
  // had nothing to do and the preview never recovered.
  const { data: files } = await supabase
    .from("project_files")
    .select("path, content, language")
    .eq("project_id", id)
    .order("path", { ascending: true });

  const all = (files ?? []).map((f) => ({ path: f.path, content: f.content }));
  const { broken: computed, reasons } = await diagnoseProject(all);
  // Dependencies first, so the agent rewrites a module before the files that
  // import it rather than trying to reconcile both at once.
  const broken = dependencyOrder(computed, all);

  // The requested paths are intersected with the computed ones. A client asking
  // to "repair" a file that is fine would otherwise spend a model call to be
  // told everything is already correct.
  const wanted = (body.paths ?? []).filter((path) => broken.includes(path));
  const targets = wanted.length > 0 ? wanted : broken;

  if (targets.length === 0) {
    return NextResponse.json({
      error: "Nothing is broken — every file compiles right now.",
    });
  }

  const prompt = [
    "The build stopped because some files do not compile. Rewrite the following files completely, from scratch, so they parse:",
    "",
    ...targets.map((path) => `- ${path}`),
    "",
    "The compiler reported:",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "Write each file again in full using the <architect:write path=...> format. Do not write partial files, and do not stop until every listed file is complete.",
  ].join("\n");

  await supabase.from("projects").update({ status: "building" }).eq("id", id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const { runId } = await runPipeline({ projectId: id, prompt }, send);
        send({ type: "complete", runId, receipt: "" });
      } catch (caught) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "failed",
              error: caught instanceof Error ? caught.message : "The repair run failed.",
            })}\n`,
          ),
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
