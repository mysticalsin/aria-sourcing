import { NextResponse } from "next/server";

import {
  buildHermesUpstreamPath,
  getHermesBaseUrl,
  hermesUpstreamHeaders,
  HERMES_PROXY_TIMEOUT_MS,
  resolveHermesProfilePrefix,
} from "@/lib/api/hermes-proxy";
import { evaluateHermesWorkspaceBinding } from "@/lib/api/hermes-runtime-isolation";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only mirror of MSourcing loop cron routes (Fly worker + Vercel backstop). */
const LOOP_CRON_JOBS = [
  { id: "dispatch-outbound", path: "/api/cron/dispatch-outbound", schedule: "daily backstop", description: "Drain approved outbound messages" },
  { id: "generate-outreach-draft", path: "/api/cron/generate-outreach-draft", schedule: "loop worker", description: "Hermes/cloud outreach draft generation" },
  { id: "classify-inbound-reply", path: "/api/cron/classify-inbound-reply", schedule: "loop worker", description: "Hermes/cloud inbound reply classify" },
  { id: "propose-calendar-book", path: "/api/cron/propose-calendar-book", schedule: "loop worker", description: "Pre-call and first-interview dry-run propose" },
  { id: "interview-prep-dispatch", path: "/api/cron/interview-prep-dispatch", schedule: "loop worker", description: "Post-booking interviewer prep + candidate confirmation drafts" },
  { id: "parse-inbound-need", path: "/api/cron/parse-inbound-need", schedule: "loop worker", description: "Requisition parse from inbound email" },
  { id: "run-sourcing-batch", path: "/api/cron/run-sourcing-batch", schedule: "loop worker", description: "Multi-provider sourcing batch" },
  { id: "recruiting-graph-stage", path: "/api/cron/recruiting-graph-stage", schedule: "loop worker", description: "LangGraph stage checkpoint validation" },
  { id: "autopilot-send-outreach", path: "/api/cron/autopilot-send-outreach", schedule: "loop worker", description: "REI autopilot first-touch send after critics-green draft" },
  { id: "ignite-sourcing-loop", path: "/api/cron/ignite-sourcing-loop", schedule: "scheduled", description: "Enqueue loop tick per workspace" },
  { id: "poll-provider-run", path: "/api/cron/poll-provider-run", schedule: "loop worker", description: "Async provider poll completion" },
  { id: "renew-graph-subscriptions", path: "/api/cron/renew-graph-subscriptions", schedule: "scheduled", description: "Microsoft Graph subscription renew (deferred)" },
] as const;

async function fetchHermesRuntimeJobs(workspaceId: string): Promise<unknown[] | null> {
  const baseResult = getHermesBaseUrl("web");
  if (!baseResult.ok) return null;
  const bearer = (process.env.HERMES_API_KEY ?? "").trim();
  if (!bearer) return null;

  const profilePrefix = resolveHermesProfilePrefix(workspaceId);
  const upstreamPath = buildHermesUpstreamPath("/api/cron/jobs", profilePrefix);
  const upstreamUrl = `${baseResult.baseUrl}${upstreamPath}`;

  try {
    const res = await fetch(upstreamUrl, {
      method: "GET",
      headers: hermesUpstreamHeaders({ bearerToken: bearer }),
      redirect: "manual",
      signal: AbortSignal.timeout(HERMES_PROXY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as { jobs?: unknown[] }).jobs)) {
      return (data as { jobs: unknown[] }).jobs;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, jobs: LOOP_CRON_JOBS, source: "msourcing_loop" });
  }
  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
  }
  const [{ data: userData }, { data: workspaceId, error: workspaceError }, { data: role }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("current_workspace_id"),
    supabase.rpc("current_profile_role"),
  ]);
  if (!userData.user) {
    return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
  }
  if (workspaceError || typeof workspaceId !== "string" || !workspaceId) {
    return NextResponse.json({ ok: false, reason: "Workspace not available." }, { status: 403 });
  }
  if (!can(role as Role, "manage_settings")) {
    return NextResponse.json({ ok: false, reason: "Admins only." }, { status: 403 });
  }

  const production = process.env.NODE_ENV === "production";
  const binding = evaluateHermesWorkspaceBinding({
    production,
    supabaseEnabled,
    workspaceId,
    boundWorkspaceId: process.env.HERMES_RUNTIME_WORKSPACE_ID,
  });

  let hermesJobs: unknown[] | null = null;
  if (binding.ok) {
    hermesJobs = await fetchHermesRuntimeJobs(workspaceId);
  }

  return NextResponse.json({
    ok: true,
    jobs: LOOP_CRON_JOBS,
    hermesJobs,
    source: hermesJobs ? "msourcing_loop+hermes_runtime" : "msourcing_loop",
    hermesRuntimeNote: hermesJobs
      ? "Hermes runtime cron jobs mirrored from upstream (H7)."
      : "Upstream Hermes cron jobs unavailable — configure HERMES_WEB_URL and HERMES_API_KEY.",
  });
}
