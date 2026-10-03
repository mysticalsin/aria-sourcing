import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getServiceSupabase } from "@/lib/supabase/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { decideInboundClassifyEnqueue } from "@/lib/inbound-reply-trigger";
import {
  normalizeLinkedInWebhookBody,
  shouldEnqueueClassifyFromRecord,
  type RecordLinkedInChannelEventResult,
} from "@/lib/linkedin-events";

export const dynamic = "force-dynamic";

/**
 * LinkedIn inbound webhook — HeyReach-parity multi-event path (L-5 / scenario plan).
 *
 * Vendor POSTs a signed envelope. Tenant is resolved ONLY from
 * linkedin_inbound_routes.route_key (never from the sender profile).
 * Reply events → messages_inbound + correlate + enqueue inbound_classify once.
 * Lifecycle events (accepted / delivered / failed / …) → durable event log only.
 */

const WEBHOOK_MAX_BODY_BYTES = 2_000_000;
const SECRET = () =>
  process.env.LINKEDIN_INBOUND_WEBHOOK_SECRET?.trim() ||
  process.env.EMAIL_INBOUND_WEBHOOK_SECRET?.trim() ||
  "";

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readBoundedBody(req, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, reason: "Body too large." }, { status: 413 });
  }
  if (!verifySignature(rawBody, req.headers.get("x-aria-signature"), SECRET())) {
    return NextResponse.json({ ok: false, reason: "Bad signature." }, { status: 401 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  const ev = normalizeLinkedInWebhookBody(parsed);
  if ("error" in ev) {
    return NextResponse.json({ ok: false, reason: ev.error }, { status: 400 });
  }

  const { data: routeData, error: routeErr } = await supabase.rpc("resolve_linkedin_inbound_route", {
    p_route_key: ev.routeKey,
  });
  const route = routeData as { ok?: boolean; workspace_id?: string; seat_id?: string } | null;
  if (routeErr || route?.ok !== true || !route.workspace_id) {
    return NextResponse.json({ ok: false, reason: "No route for key." }, { status: 404 });
  }

  const seatId =
    (ev.seatId && /^[0-9a-f-]{36}$/i.test(ev.seatId) ? ev.seatId : null) ||
    (typeof route.seat_id === "string" ? route.seat_id : null);

  const { data: recData, error: recErr } = await supabase.rpc("record_linkedin_channel_event", {
    p_workspace_id: route.workspace_id,
    p_seat_id: seatId,
    p_event_id: ev.eventId,
    p_event_type: ev.eventType,
    p_profile_url: ev.profileUrl,
    p_provider_thread_key: ev.providerThreadKey ?? "",
    p_provider_message_id: ev.providerMessageId ?? ev.eventId,
    p_body: ev.body,
    p_payload: {
      schemaVersion: ev.schemaVersion,
      candidateId: ev.candidateId ?? null,
      errorCode: ev.errorCode ?? null,
      ariaAttemptId: ev.ariaAttemptId ?? null,
      ...(ev.payload ?? {}),
    },
    p_occurred_at: ev.occurredAt ?? new Date().toISOString(),
  });

  const rec = recData as RecordLinkedInChannelEventResult | null;
  if (recErr || rec?.ok !== true) {
    safeLog("linkedin inbound webhook: record failed", {
      message: recErr?.message,
      code: recErr?.code,
      reason: rec?.reason,
    });
    return NextResponse.json({ ok: false, reason: "Record failed." }, { status: 503 });
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
      const { data: enqData, error: enqErr } = await supabase.rpc("enqueue_aria_job", {
        p_workspace_id: route.workspace_id,
        p_kind: decision.kind,
        p_idempotency_key: `li:${decision.idempotencyKey}`,
        p_payload: { ...decision.payload, channel: "LinkedIn" },
        p_run_at: new Date().toISOString(),
        p_priority: decision.priority,
      });
      const enq = enqData as { status?: string } | null;
      if (enqErr) {
        safeLog("linkedin inbound webhook: classify enqueue failed", {
          message: enqErr.message,
          code: enqErr.code,
        });
        return NextResponse.json(
          {
            ok: false,
            reason: "Classify enqueue failed.",
            inboundId: rec.inbound_id,
            eventType: rec.event_type,
          },
          { status: 503 },
        );
      }
      classifyStatus = typeof enq?.status === "string" ? enq.status : "unknown";
      classifyQueued = classifyStatus === "enqueued" || classifyStatus === "already_enqueued";
    }
  }

  return NextResponse.json({
    ok: true,
    eventType: rec.event_type ?? ev.eventType,
    eventRowId: rec.event_row_id,
    inboundId: rec.inbound_id ?? null,
    conversationId: rec.conversation_id ?? null,
    candidateId: rec.candidate_id ?? null,
    correlated: Boolean(rec.correlated),
    duplicate: Boolean(rec.duplicate),
    classifyQueued,
    classifyStatus:
      classifyStatus ?? (shouldEnqueueClassifyFromRecord(rec) ? "unknown" : "skipped"),
  });
}
