import { MODELS } from "@/lib/agent/provider";
import { runAgent, type AgentEvent } from "@/lib/agent/run";
import { requireSupabaseEnv, isGroqConfigured, GROQ_SETUP_HINT } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/projects/[id]/agent - run the build agent.
 *
 * Streams NDJSON, one `AgentEvent` per line. NDJSON rather than SSE because the
 * browser reads it with `fetch` + a `ReadableStream`, which works identically in
 * dev and in a Server Action boundary and needs no event-parser dependency.
 *
 * Authorisation: the project is loaded with the caller's own cookie-bound
 * Supabase client and the RLS policies on `projects` and `project_files` decide
 * what is visible. There is no separate permission check here to drift out of
 * sync with the database.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Fail fast, and with an instruction rather than a stack trace. This is the
  // one place the product refuses to pretend: with no key there is no agent.
  if (!isGroqConfigured) {
    return json({ type: "error", message: GROQ_SETUP_HINT } satisfies AgentEvent);
  }

  let instruction = "";
  let model: string | undefined;
  let maxTurns: number | undefined;
  try {
    const body = (await request.json()) as {
      instruction?: unknown;
      model?: unknown;
      maxTurns?: unknown;
    };
    instruction = typeof body.instruction === "string" ? body.instruction : "";
    // Model selection is per request, so a developer can switch models without
    // a deploy. It is validated against the known list rather than passed
    // straight through, because an arbitrary string here would be an
    // unvalidated path to the provider.
    if (typeof body.model === "string" && MODELS.some((m) => m.id === body.model)) {
      model = body.model;
    }
    if (typeof body.maxTurns === "number" && Number.isFinite(body.maxTurns)) {
      maxTurns = Math.floor(body.maxTurns);
    }
  } catch {
    instruction = "";
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    requireSupabaseEnv();
    supabase = await createClient();
  } catch (error) {
    return json({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies AgentEvent);
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, prompt")
    .eq("id", id)
    .maybeSingle();

  if (projectError) {
    return json({ type: "error", message: projectError.message } satisfies AgentEvent);
  }
  if (!project) {
    return json({
      type: "error",
      message: "That project does not exist, or you do not have access to it.",
    } satisfies AgentEvent);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runAgent({
          supabase,
          projectId: project.id,
          projectName: project.name,
          // An explicit follow-up wins; otherwise fall back to the project's
          // original description so "Build it" works with an empty message.
          instruction: instruction || (project.prompt ?? ""),
          emit: send,
          ...(model ? { model } : {}),
          ...(maxTurns !== undefined ? { maxTurns } : {}),
        });
      } catch (error) {
        // runAgent already swallows its own errors; this is the last net, so a
        // failure here still closes the stream cleanly rather than hanging it.
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx or a preview proxy buffering the stream into one blob,
      // which would defeat the whole point of showing work as it happens.
      "X-Accel-Buffering": "no",
    },
  });
}

function json(event: AgentEvent) {
  return new Response(`${JSON.stringify(event)}\n`, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
