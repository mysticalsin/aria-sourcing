import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { decideInboundClassifyEnqueue } from "@/lib/inbound-reply-trigger";
import {
  shouldEnqueueClassifyFromRecord,
  type RecordLinkedInChannelEventResult,
} from "@/lib/linkedin-events";
import { normalizeLinkedInProfileUrl } from "@/lib/linkedin-connections";
import { safeLog } from "@/lib/log-redact";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const SimulateSchema = z.object({
  eventType: z.enum([
    "reply",
    "connection_accepted",
    "connection_rejected",
    "invite_sent",
    "message_sent",
    "message_delivered",
    "message_seen",
    "message_failed",
  ]),
  profileUrl: z.string().min(8).max(500),
  body: z.string().max(20_000).optional().default(""),
  seatId: z.string().uuid().optional(),
  providerThreadKey: z.string().max(512).optional(),
  eventId: z.string().min(1).max(512).optional(),
});

/**
 * Admin simulator for HeyReach-parity LinkedIn events (S5/S10 without a vendor).
 * Uses service_role after requireAdmin — never calls linkedin.com.
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "Authentication backend not configured." }, { status: 503 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  }

  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "manage_fleet")) {
    return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-simulate", user.id), {
    windowMs: 60_000,
    max: 30,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, SimulateSchema, { maxBytes: 32_000 });
  if (!validated.ok) return validated.response;
  const data = validated.data;

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  const profileUrl = normalizeLinkedInProfileUrl(data.profileUrl) ?? data.profileUrl.trim().toLowerCase();
  const bodyText = typeof data.body === "string" ? data.body : "";
  if (data.eventType === "reply" && !bodyText.trim()) {
    return NextResponse.json({ ok: false, error: "body required for reply events." }, { status: 400 });
  }

  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 503 });
  }

  const eventId = data.eventId?.trim() || `sim:${data.eventType}:${randomUUID()}`;

  const { data: recData, error: recErr } = await svc.rpc("record_linkedin_channel_event", {
    p_workspace_id: wid,
    p_seat_id: data.seatId ?? null,
    p_event_id: eventId,
    p_event_type: data.eventType,
    p_profile_url: profileUrl,
    p_provider_thread_key: data.providerThreadKey ?? "",
    p_provider_message_id: eventId,
    p_body: bodyText,
    p_payload: { source: "admin_simulate", simulatedBy: user.id },
    p_occurred_at: new Date().toISOString(),
  });

  const rec = recData as RecordLinkedInChannelEventResult | null;
  if (recErr || rec?.ok !== true) {
    safeLog("linkedin simulate: record failed", { message: recErr?.message, reason: rec?.reason });
    return NextResponse.json(
      { ok: false, error: rec?.reason ?? recErr?.message ?? "Record failed." },
      { status: 503 },
    );
  }

  let classifyQueued = false;
  let classifyStatus: string | undefined;
  if (shouldEnqueueClassifyFromRecord(rec)) {
    const decision = decideInboundClassifyEnqueue({
      ok: true,
      inbound_id: rec.inbound_id ?? undefined,
      duplicate: Boolean(rec.duplicate),
    });
    if (decision.enqueue) {
      const { data: enqData, error: enqErr } = await svc.rpc("enqueue_aria_job", {
        p_workspace_id: wid,
        p_kind: decision.kind,
        p_idempotency_key: `li:${decision.idempotencyKey}`,
        p_payload: { ...decision.payload, channel: "LinkedIn" },
        p_run_at: new Date().toISOString(),
        p_priority: decision.priority,
      });
      if (enqErr) {
        return NextResponse.json(
          {
            ok: false,
            error: "Event recorded but classify enqueue failed.",
            inboundId: rec.inbound_id,
          },
          { status: 503 },
        );
      }
      const enq = enqData as { status?: string } | null;
      classifyStatus = typeof enq?.status === "string" ? enq.status : "unknown";
      classifyQueued = classifyStatus === "enqueued" || classifyStatus === "already_enqueued";
    }
  }

  return NextResponse.json({
    ok: true,
    eventType: rec.event_type ?? data.eventType,
    eventId,
    eventRowId: rec.event_row_id,
    inboundId: rec.inbound_id ?? null,
    candidateId: rec.candidate_id ?? null,
    correlated: Boolean(rec.correlated),
    duplicate: Boolean(rec.duplicate),
    classifyQueued,
    classifyStatus: classifyStatus ?? "skipped",
  });
}
