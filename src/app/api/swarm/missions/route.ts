// /api/swarm/missions — mission (SwarmBrief) control plane (Rock 8).
//
// GET  → list this workspace's missions (authenticated member RPC).
// POST → { action: "create", ... } creates a mission and, when assignments are
//        supplied, plans the decomposition atomically (≤12 items, ordinal
//        depends_on DAG). { action: "cancel", ... } cancels a mission.
//
// The DB is the gate: plan_swarm_assignments rejects greenlight_category
// 'external-send' outright (drafts only — the outreach approval authority is
// the ONLY send path), and dispatch stays frozen until an admin enables
// sourcing_loop_controls.swarm_enabled. Creating and planning a mission here
// dispatches NOTHING by itself.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { swarmRequestBoundary } from "@/lib/api/swarm-request-boundary";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AssignmentSchema = z.object({
  agentSlug: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  task: z.string().trim().min(1).max(32_000),
  rationale: z.string().trim().min(1).max(2000).optional(),
  expectedOutput: z.string().trim().min(1).max(2000).optional(),
  dependsOn: z.array(z.number().int().min(0).max(11)).max(12).optional(),
  reviewRequired: z.boolean().optional(),
  greenlightCategory: z.enum([
    "sequence-activate", "budget-change", "erasure", "destructive", "credential-change",
  ]).optional(),
}).strict();

const CreateSchema = z.object({
  action: z.literal("create"),
  title: z.string().trim().min(1).max(200),
  goal: z.string().trim().min(1).max(2000),
  whyNow: z.string().trim().min(1).max(1000).optional(),
  scope: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
  deliverables: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
  proofContract: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
  constraints: z.array(z.string().trim().min(1).max(400)).max(12).optional(),
  budget: z.record(z.string(), z.union([z.string().max(120), z.number()])).optional(),
  sourceKind: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/).optional(),
  sourceRef: z.string().trim().min(1).max(160).optional(),
  requisitionId: z.string().uuid().optional(),
  assignments: z.array(AssignmentSchema).min(1).max(12).optional(),
}).strict().refine(
  (value) => (value.sourceKind === undefined) === (value.sourceRef === undefined),
  { message: "sourceKind and sourceRef must be provided together" },
);

const CancelSchema = z.object({
  action: z.literal("cancel"),
  missionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
}).strict();

const BodySchema = z.union([CreateSchema, CancelSchema]);

export async function GET(req: NextRequest) {
  const session = await getServerSupabase();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  // Authenticated-only read: reject an anonymous caller with a clean 401 rather
  // than letting the anon RPC call fail into a 502.
  const { data: { user } } = await session.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "swarm-missions"), { windowMs: 60_000, max: 60 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const { data, error } = await session.rpc("list_swarm_missions", { p_limit: 50 });
  if (error) {
    return NextResponse.json({ ok: false, error: "Mission read failed." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, missions: data ?? [] });
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
  const limit = checkRateLimit(rateLimitKey(req, "swarm-missions-write"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) {
    const response = NextResponse.json({ ok: false, error: "Rate limited." }, { status: 429 });
    response.headers.set("Retry-After", String(limit.retryAfterSec));
    return response;
  }
  const body = await validateBody(req, BodySchema, { maxBytes: 128_000 });
  if (!body.ok) return body.response;

  if (body.data.action === "cancel") {
    const { data, error } = await session.rpc("cancel_swarm_mission", {
      p_mission_id: body.data.missionId,
      p_reason: body.data.reason,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: "Cancel failed." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  const service = getServiceSupabase();
  if (!service) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const [{ data: auth }, { data: workspaceId, error: workspaceError }] = await Promise.all([
    session.auth.getUser(),
    session.rpc("current_workspace_id"),
  ]);
  const actorId = auth.user?.id;
  if (workspaceError || !workspaceId || !actorId) {
    return NextResponse.json({ ok: false, error: "Workspace unresolved." }, { status: 403 });
  }

  const created = await service.rpc("create_swarm_mission", {
    p_workspace_id: workspaceId,
    p_title: body.data.title,
    p_goal: body.data.goal,
    p_why_now: body.data.whyNow ?? null,
    p_scope: body.data.scope ?? [],
    p_deliverables: body.data.deliverables ?? [],
    p_proof_contract: body.data.proofContract ?? [],
    p_constraints: body.data.constraints ?? [],
    p_budget: body.data.budget ?? {},
    p_source_kind: body.data.sourceKind ?? null,
    p_source_ref: body.data.sourceRef ?? null,
    p_requisition_id: body.data.requisitionId ?? null,
    p_created_by: actorId,
  });
  const mission = created.data as { status?: string; id?: string; replay?: boolean } | null;
  if (created.error || !mission || mission.status !== "created" || !mission.id) {
    return NextResponse.json(
      { ok: false, error: "Mission create failed.", detail: mission?.status ?? "rpc_error" },
      { status: mission?.status === "idempotency_conflict" ? 409 : 502 },
    );
  }

  let planned: unknown = null;
  // Plan on a fresh mission AND on a replayed mission still stuck in
  // 'planning' (a prior planning failure must be retryable, not a dead end).
  const missionStatus = (mission as { mission_status?: string }).mission_status;
  const shouldPlan = body.data.assignments
    && (!mission.replay || missionStatus === "planning");
  if (shouldPlan && body.data.assignments) {
    const plan = await service.rpc("plan_swarm_assignments", {
      p_workspace_id: workspaceId,
      p_mission_id: mission.id,
      p_assignments: body.data.assignments.map((assignment) => ({
        agent_slug: assignment.agentSlug,
        task: assignment.task,
        rationale: assignment.rationale ?? null,
        expected_output: assignment.expectedOutput ?? null,
        depends_on: assignment.dependsOn ?? [],
        review_required: assignment.reviewRequired,
        greenlight_category: assignment.greenlightCategory ?? null,
      })),
    });
    const planResult = plan.data as { status?: string } | null;
    if (plan.error || !planResult || planResult.status !== "planned") {
      return NextResponse.json(
        {
          ok: false,
          error: "Mission created but planning failed.",
          missionId: mission.id,
          detail: planResult?.status ?? plan.error?.message ?? "rpc_error",
        },
        { status: 502 },
      );
    }
    planned = planResult;
  }

  return NextResponse.json({ ok: true, mission, planned });
}
