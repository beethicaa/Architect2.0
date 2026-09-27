/**
 * Deploy the project to Vercel, and read the deployment history.
 *
 * POST creates a deployment and returns immediately with the URL Vercel
 * assigned. The build finishes asynchronously, so the client polls this same
 * route until `state` settles - which is why the row is written before the
 * build completes and updated as it does.
 *
 * The deployment row is the durable record: it holds Vercel's own id, so a
 * reloaded page can resume polling an in-flight build instead of starting a
 * second one.
 */

import { NextResponse } from "next/server";

import { buildDeployment } from "@/lib/deploy/service";
import {
  FAILED_STATES,
  canonicalUrl,
  createDeployment,
  getDeployment,
  getProjectAlias,
} from "@/lib/deploy/vercel";
import { isSupabaseConfigured, isVercelConfigured, VERCEL_SETUP_HINT } from "@/lib/env";
import { createClient, getClaims } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

async function requireProject(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  return { supabase, project: data };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  if (!isVercelConfigured) {
    return NextResponse.json({ error: VERCEL_SETUP_HINT }, { status: 503 });
  }

  const claims = await getClaims();
  if (!claims) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { id } = await params;
  const { supabase, project } = await requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "That project was not found." }, { status: 404 });
  }

  const deployable = await buildDeployment(id, project.name);
  if (deployable.files.length === 0) {
    return NextResponse.json(
      { error: deployable.problem ?? "There is nothing to deploy yet." },
      { status: 422 },
    );
  }

  let created;
  try {
    created = await createDeployment({
      name: deployable.name,
      files: deployable.files,
      target: "production",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // The stable URL is the project's alias, not the deployment hostname.
  //
  // Two traps, both hit on a real deploy:
  //
  //   1. The hostname Vercel returns is per-build (`name-<hash>-<account>`). On an
  //      account where the name is taken it can resolve to a different app.
  //   2. Vercel truncates the alias host at 32 characters, so a long project name
  //      gets an alias that is not the name, and `https://<name>.vercel.app` 404s.
  //
  // `deploymentName` keeps the name inside that budget, and the poll below
  // re-reads the real alias so a stored link is always one Vercel serves.
  const url = canonicalUrl(created.name, created.url);
  const { data: row } = await supabase
    .from("deployments")
    .insert({
      project_id: id,
      state: "working",
      external_id: created.id,
      url,
      logs: [
        `Uploading ${deployable.files.length} file(s) to Vercel…`,
        `Deployment ${created.id} created.`,
      ],
    })
    .select("id")
    .single();

  return NextResponse.json({
    deploymentId: row?.id ?? null,
    externalId: created.id,
    url,
    readyState: created.readyState,
  });
}

/** Read the history, and refresh the newest deployment's state from Vercel. */
export async function GET(
  _request: Request,
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
  const { supabase } = await requireProject(id);

  const { data: rows, error } = await supabase
    .from("deployments")
    .select("id, state, url, external_id, error, logs, created_at, finished_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A build in flight is polled here rather than from a background job, which
  // would not survive a serverless invocation. Only the newest is refreshed:
  // older rows are settled and re-reading them would be noise.
  const inFlight = (rows ?? []).find((row) => row.state === "working");
  if (inFlight?.external_id && isVercelConfigured) {
    try {
      const status = await getDeployment(inFlight.external_id);

      // Correct the stored URL from the alias Vercel actually assigned.
      //
      // The URL written at create time is a guess derived from the project name,
      // and Vercel truncates the alias host at 32 characters - so the guess can
      // 404 while the deployment itself is perfectly healthy. Reading the real
      // alias repairs the link before the panel ever calls it "Live", and fixes
      // any row already stored with the wrong host.
      const alias = status.projectId
        ? await getProjectAlias(status.projectId)
        : null;
      const correctUrl = alias ?? inFlight.url;

      const done = status.readyState === "READY" ? "done" : "failed";
      if (FAILED_STATES.has(status.readyState) || status.readyState === "READY") {
        await supabase
          .from("deployments")
          .update({
            state: done,
            url: correctUrl,
            error: status.error ?? null,
            finished_at: new Date().toISOString(),
            logs:
              status.readyState === "READY"
                ? [...(inFlight.logs ?? []), `Build finished. The site is live at ${correctUrl}.`]
                : [...(inFlight.logs ?? []), `Build failed: ${status.readyState}`],
          })
          .eq("id", inFlight.id);
        inFlight.state = done;
        inFlight.url = correctUrl;
        inFlight.error = status.error ?? null;
      } else if (correctUrl !== inFlight.url) {
        // Still building, but the alias has already been assigned. Fix the link
        // now rather than at the end, so it is right the moment the panel says
        // Live rather than one refresh later.
        await supabase
          .from("deployments")
          .update({ url: correctUrl })
          .eq("id", inFlight.id);
        inFlight.url = correctUrl;
      }
    } catch {
      // A failed poll leaves the row "working" and the client tries again. The
      // alternative - marking it failed on a network blip - would be a lie.
    }
  }

  return NextResponse.json({ deployments: rows ?? [] });
}
