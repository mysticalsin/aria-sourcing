// /api/swarm/roster — swarm agent roster control plane (Rock 8).
//
// GET  → runtime roster view (agents + live counts) for the current workspace.
// POST → { action: "seed" } seeds the default six-agent roster (disabled), or
//        { action: "update", ... } toggles one agent's enable/caps.
//
// Authority lives in the DB: seed_swarm_roster / set_swarm_agent are
// authenticated RPCs that enforce workspace-admin in SQL; get_swarm_runtime is
// service-role and is only reached after requireAdmin. Agents seed DISABLED and
// nothing dispatches until sourcing_loop_controls.swarm_enabled is turned on by
// an admin — this route cannot flip that switch.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { swarmRequestBoundary } from "@/lib/api/swarm-request-boundary";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateSchema = z.object({
  action: z.literal("update"),
  agentId: z.string().uuid(),
  enabled: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(8),
  reviewRequired: z.boolean(),
  standingMission: z.string().trim().min(1).max(2000).nullable().optional(),
}).strict();

const SeedSchema = z.object({ action: z.literal("seed") }).strict();

const BodySchema = z.discriminatedUnion("action", [SeedSchema, UpdateSchema]);

export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  const service = getServiceSupabase();
  if (!session || !service) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-roster"), { windowMs: 60_000, max: 30 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const { data: workspaceId, error: workspaceError } = await session.rpc("current_workspace_id");
  if (workspaceError || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace unresolved." }, { status: 403 });
  }
  const { data, error } = await service.rpc("get_swarm_runtime", { p_workspace_id: workspaceId });
  if (error) {
    return NextResponse.json({ ok: false, error: "Runtime read failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, runtime: data });
}

export async function POST(req: NextRequest) {
  // Request boundary first — before authentication, parsing or any side effect.
  const boundary = swarmRequestBoundary(req);
  if (boundary) return boundary;
  const session = await getServerSupabase();
  const admin = await requireAdmin(session);
  if (!admin.ok) return admin.response;
  if (!session) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-roster-write"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const body = await validateBody(req, BodySchema, { maxBytes: 8_000 });
  if (!body.ok) return body.response;

  if (body.data.action === "seed") {
    const { data, error } = await session.rpc("seed_swarm_roster");
    if (error) {
      return NextResponse.json({ ok: false, error: "Seed failed." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  const { data, error } = await session.rpc("set_swarm_agent", {
    p_agent_id: body.data.agentId,
    p_enabled: body.data.enabled,
    p_max_concurrent: body.data.maxConcurrent,
    p_review_required: body.data.reviewRequired,
    p_standing_mission: body.data.standingMission ?? null,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "Update failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, result: data });
}
