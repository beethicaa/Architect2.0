/**
 * The persisted chat thread.
 *
 * The server already writes every turn to `project_messages` as the run
 * progresses, so this only has to read it back. That is deliberate: the browser
 * keeps no second copy of the conversation, which is what would otherwise drift
 * from the database the moment a page was refreshed or a run resumed on another
 * device.
 *
 * Each row carries both audiences — `body` for Simple mode, `technical` for the
 * per-message inline switch — so the two readings can never disagree.
 */

import { NextResponse } from "next/server";

import { getClaims } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const supabase = await createClient();

  // RLS restricts this to people who can see the project, so a wrong id returns
  // an empty thread rather than someone else's conversation.
  const { data, error } = await supabase
    .from("project_messages")
    .select("id, role, agent_key, body, technical, meta, gate_status, is_redirect, run_id, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "We could not load this conversation." }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}
