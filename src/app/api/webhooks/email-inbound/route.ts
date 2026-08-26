import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { routeInboundEmail } from "@/lib/inbound-email-router";

export const dynamic = "force-dynamic";

/**
 * Inbound email webhook — event-driven reply half of the durable loop.
 *
 * A provider adapter normalizes an inbound email into the signed shape below and
 * POSTs it here. The tenant is resolved ONLY from inbound_mailbox_routes (the
 * delivered-to mailbox → workspace); the sender is never trusted for routing.
 * The reply is persisted idempotently (record_inbound_email) and threaded back to
 * the send via In-Reply-To ↔ outreach_ledger.rfc_message_id (correlate_inbound_email).
 *
 * On a *new* inbound (not a duplicate redelivery), we enqueue `inbound_classify`
 * so the Fly loop classifies exactly once. Idle loop ticks never call the LLM —
 * no token burn waiting for candidates who have not answered.
 */

const WEBHOOK_MAX_BODY_BYTES = 2_000_000;
const SECRET = () => process.env.EMAIL_INBOUND_WEBHOOK_SECRET ?? "";

const PayloadSchema = z.object({
  mailbox: z.string().min(3).max(320),
  providerId: z.string().min(1).max(512),
  from: z.string().min(3).max(320),
  subject: z.string().max(998).default(""),
  body: z.string().max(1_000_000).default(""),
  inReplyTo: z.string().max(998).optional(),
});

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
    safeLog("email inbound webhook: service client unavailable", { hasSupabase: false });
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let ev: z.infer<typeof PayloadSchema>;
  try {
    ev = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  // Tenant ONLY from the mailbox route (never the sender).
  const { data: routeData, error: routeErr } = await supabase.rpc("resolve_inbound_mailbox_route", { p_mailbox: ev.mailbox });
  const route = routeData as { ok?: boolean; workspace_id?: string } | null;
  if (routeErr || route?.ok !== true || !route.workspace_id) {
    return NextResponse.json({ ok: false, reason: "No route for mailbox." }, { status: 404 });
  }

  const { data: recData, error: recErr } = await supabase.rpc("record_inbound_email", {
    p_workspace_id: route.workspace_id,
    p_provider_id: ev.providerId,
    p_from_address: ev.from,
    p_body: ev.body,
  });
  const rec = recData as { ok?: boolean; inbound_id?: string; duplicate?: boolean } | null;
  if (recErr || rec?.ok !== true || !rec.inbound_id) {
    safeLog("email inbound webhook: record failed", { message: recErr?.message, code: recErr?.code });
    return NextResponse.json({ ok: false, reason: "Record failed." }, { status: 503 });
  }

  // Correlate (fail-closed to triage on no/ambiguous match — never blocks the 200).
  const { data: corrData } = await supabase.rpc("correlate_inbound_email", {
    p_inbound_id: rec.inbound_id,
    p_in_reply_to: ev.inReplyTo ?? "",
  });
  const corr = corrData as { correlated?: boolean; reason?: string } | null;

  const routed = routeInboundEmail({
    record: rec,
    from: ev.from,
    subject: ev.subject,
    body: ev.body,
    mailbox: ev.mailbox,
    inReplyTo: ev.inReplyTo,
    correlated: corr?.correlated,
  });

  if (routed.route === "none") {
    return NextResponse.json({
      ok: true,
      inboundId: rec.inbound_id,
      duplicate: rec.duplicate === true,
      correlated: corr?.correlated ?? false,
      reason: routed.reason,
      jobQueued: false,
    });
  }

  const jobDecision =
    routed.route === "hiring_need" ? routed.decision : routed.decision;

  let jobQueued = false;
  let jobKind: string | undefined;
  let jobStatus: string | undefined;

  if (jobDecision.enqueue) {
    const { data: enqData, error: enqErr } = await supabase.rpc("enqueue_aria_job", {
      p_workspace_id: route.workspace_id,
      p_kind: jobDecision.kind,
      p_idempotency_key: jobDecision.idempotencyKey,
      p_payload: jobDecision.payload,
      p_run_at: new Date().toISOString(),
      p_priority: jobDecision.priority,
    });
    const enq = enqData as { status?: string; id?: string } | null;
    if (enqErr) {
      safeLog("email inbound webhook: job enqueue failed", {
        message: enqErr.message,
        code: enqErr.code,
        kind: jobDecision.kind,
      });
      return NextResponse.json(
        {
          ok: false,
          reason: "Job enqueue failed.",
          inboundId: rec.inbound_id,
          correlated: corr?.correlated ?? false,
          route: routed.route,
        },
        { status: 503 },
      );
    }
    jobKind = jobDecision.kind;
    jobStatus = typeof enq?.status === "string" ? enq.status : "unknown";
    jobQueued = jobStatus === "enqueued" || jobStatus === "replay";
  }

  return NextResponse.json({
    ok: true,
    inboundId: rec.inbound_id,
    duplicate: rec.duplicate === true,
    correlated: corr?.correlated ?? false,
    reason: corr?.reason,
    route: routed.route,
    jobKind,
    jobQueued,
    jobStatus,
    // Back-compat for reply classify consumers
    classifyQueued: routed.route === "reply_classify" && jobQueued,
    classifyStatus: routed.route === "reply_classify" ? jobStatus : undefined,
  });
}
