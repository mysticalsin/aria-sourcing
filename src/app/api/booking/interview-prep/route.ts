import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { validateBody } from "@/lib/api/validate";
import { decideInterviewPrepEnqueue } from "@/lib/interview-prep-trigger";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z
  .object({
    bookingId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    candidateId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    campaignId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    providerEventCreated: z.boolean(),
  })
  .strict();

function enqueueErrorStatus(status: string): number {
  if (status === "control_blocked") return 403;
  if (status === "idempotency_conflict") return 409;
  if (status === "invalid_request") return 400;
  return 503;
}

/**
 * Enqueue interview prep drafts after a live calendar booking succeeds.
 * Non-fatal for the booking itself — returns queued=false when skipped.
 */
export async function POST(req: NextRequest) {
  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, queued: false, reason: "demo_mode" });
  }

  const rl = checkRateLimit(rateLimitKey(req, "booking-interview-prep"), {
    windowMs: 60_000,
    max: 30,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, BodySchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase unavailable." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "book")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const decision = decideInterviewPrepEnqueue(validated.data);
  if (decision.enqueue === false) {
    return NextResponse.json({ ok: true, queued: false, reason: decision.reason });
  }

  const [{ data: workspaceId, error: workspaceError }] = await Promise.all([
    supabase.rpc("current_workspace_id"),
  ]);
  if (workspaceError || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace unavailable." }, { status: 503 });
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service unavailable." }, { status: 503 });
  }

  const enqueue = await svc.rpc("enqueue_aria_job", {
    p_workspace_id: workspaceId,
    p_kind: decision.kind,
    p_idempotency_key: decision.idempotencyKey,
    p_payload: decision.payload,
    p_priority: decision.priority,
  });
  const result = enqueue.data as { status?: string; id?: string; replay?: boolean } | null;
  if (enqueue.error || !result?.status) {
    return NextResponse.json({ ok: false, error: "Job enqueue failed." }, { status: 503 });
  }
  if (result.status !== "enqueued") {
    return NextResponse.json(
      { ok: false, error: result.status, queued: false },
      { status: enqueueErrorStatus(result.status) },
    );
  }

  return NextResponse.json({
    ok: true,
    queued: true,
    jobId: result.id,
    replay: result.replay === true,
    kind: decision.kind,
  });
}
