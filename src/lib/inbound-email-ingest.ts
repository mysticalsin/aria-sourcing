import "server-only";

/**
 * Shared durable ingest for normalized inbound email (HMAC webhook + Graph adapter).
 * Tenant is always resolved from mailbox route — never from the sender.
 */

import { getServiceSupabase } from "@/lib/supabase/server";
import { routeInboundEmail } from "@/lib/inbound-email-router";
import { buildInboundEmailText } from "@/lib/requisition-intake";
import { safeLog } from "@/lib/log-redact";

export type NormalizedInboundEmail = {
  mailbox: string;
  providerId: string;
  from: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
};

export type IngestInboundResult =
  | {
      ok: true;
      inboundId: string;
      workspaceId: string;
      duplicate: boolean;
      correlated: boolean;
      route: string;
      jobQueued: boolean;
      jobKind?: string;
      reason?: string;
    }
  | { ok: false; status: number; reason: string; inboundId?: string };

export async function ingestNormalizedInboundEmail(
  ev: NormalizedInboundEmail,
): Promise<IngestInboundResult> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return { ok: false, status: 503, reason: "Service client unavailable." };
  }

  const { data: routeData, error: routeErr } = await supabase.rpc("resolve_inbound_mailbox_route", {
    p_mailbox: ev.mailbox,
  });
  const route = routeData as { ok?: boolean; workspace_id?: string } | null;
  if (routeErr || route?.ok !== true || !route.workspace_id) {
    return { ok: false, status: 404, reason: "No route for mailbox." };
  }

  // Persist From/Subject into the durable body so requisition_parse keeps
  // Graph/webhook subject lines (record_inbound_email stores body only).
  const durableBody = buildInboundEmailText({
    from: ev.from,
    subject: ev.subject,
    body: ev.body ?? "",
  });

  const { data: recData, error: recErr } = await supabase.rpc("record_inbound_email", {
    p_workspace_id: route.workspace_id,
    p_provider_id: ev.providerId,
    p_from_address: ev.from,
    p_body: durableBody,
  });
  const rec = recData as { ok?: boolean; inbound_id?: string; duplicate?: boolean } | null;
  if (recErr || rec?.ok !== true || !rec.inbound_id) {
    safeLog("inbound ingest: record failed", { message: recErr?.message, code: recErr?.code });
    return { ok: false, status: 503, reason: "Record failed." };
  }

  const { data: corrData } = await supabase.rpc("correlate_inbound_email", {
    p_inbound_id: rec.inbound_id,
    p_in_reply_to: ev.inReplyTo ?? "",
  });
  const corr = corrData as { correlated?: boolean; reason?: string } | null;

  const routed = routeInboundEmail({
    record: rec,
    from: ev.from,
    subject: ev.subject ?? "",
    body: ev.body ?? "",
    mailbox: ev.mailbox,
    inReplyTo: ev.inReplyTo,
    correlated: corr?.correlated,
  });

  if (routed.route === "none") {
    return {
      ok: true,
      inboundId: rec.inbound_id,
      workspaceId: route.workspace_id,
      duplicate: rec.duplicate === true,
      correlated: corr?.correlated ?? false,
      route: "none",
      jobQueued: false,
      reason: routed.reason,
    };
  }

  const jobDecision = routed.route === "hiring_need" ? routed.decision : routed.decision;
  let jobQueued = false;
  let jobKind: string | undefined;

  if (jobDecision.enqueue) {
    const { data: enqData, error: enqErr } = await supabase.rpc("enqueue_aria_job", {
      p_workspace_id: route.workspace_id,
      p_kind: jobDecision.kind,
      p_idempotency_key: jobDecision.idempotencyKey,
      p_payload: jobDecision.payload,
      p_run_at: new Date().toISOString(),
      p_priority: jobDecision.priority,
    });
    if (enqErr) {
      safeLog("inbound ingest: job enqueue failed", {
        message: enqErr.message,
        kind: jobDecision.kind,
      });
      return {
        ok: false,
        status: 503,
        reason: "Job enqueue failed.",
        inboundId: rec.inbound_id,
      };
    }
    // Match LinkedIn webhook honesty: transport OK is not enough — require durable enqueue status.
    const enq = enqData as { status?: string } | null;
    const enqStatus = typeof enq?.status === "string" ? enq.status : "";
    if (enqStatus !== "enqueued" && enqStatus !== "already_enqueued") {
      safeLog("inbound ingest: job enqueue rejected", {
        kind: jobDecision.kind,
        status: enqStatus || "missing",
      });
      const controlBlocked = enqStatus === "control_blocked";
      return {
        ok: false,
        status: 503,
        reason: controlBlocked
          ? "Loop intake disabled — arm Intake on the sourcing-loop switchboard (synthetic HMAC and Graph paths both require it)."
          : "Job enqueue rejected.",
        inboundId: rec.inbound_id,
      };
    }
    jobQueued = true;
    jobKind = jobDecision.kind;
  }

  return {
    ok: true,
    inboundId: rec.inbound_id,
    workspaceId: route.workspace_id,
    duplicate: rec.duplicate === true,
    correlated: corr?.correlated ?? false,
    route: routed.route,
    jobQueued,
    jobKind,
  };
}
