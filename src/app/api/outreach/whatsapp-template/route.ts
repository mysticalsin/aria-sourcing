import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { safeLog } from "@/lib/log-redact";
import { approvalHash, approvalScopeHash } from "@/lib/outreach-content";
import { can } from "@/lib/rbac";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import {
  APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
  buildApprovedWhatsAppTemplateAudit,
  MAX_WHATSAPP_TEMPLATE_PARAMETERS,
  MAX_WHATSAPP_TEMPLATE_PARAMETER_LENGTH,
  parseApprovedWhatsAppTemplateParameterSchema,
} from "@/lib/whatsapp-template-queue";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";

export const dynamic = "force-dynamic";

const WhatsAppTemplateQueueSchema = z
  .object({
    candidateId: z.string().trim().min(1).max(120),
    recipient: z.string().trim().min(8).max(40),
    seatId: z.string().uuid(),
    templateId: z.string().uuid(),
    parameters: z.array(z.string().max(MAX_WHATSAPP_TEMPLATE_PARAMETER_LENGTH)).max(MAX_WHATSAPP_TEMPLATE_PARAMETERS),
    // This is the human approval action. There is no separate client-supplied
    // body, name, language, or template status that could be reinterpreted.
    humanApproval: z.literal(true),
  })
  .strict();

type SenderRow = {
  id: string;
  seat_id: string | null;
  status: string;
};

type SeatRow = {
  id: string;
  provider: string;
  status: string;
  mode: string;
};

type TemplateRow = {
  id: string;
  sender_id: string;
  meta_name: string;
  language: string;
  category: string;
  version: number;
  status: string;
  parameter_schema: unknown;
  body_parameter_count: number;
};

async function requireOutreachOperator(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false as const, response: prodBlock };
  if (!supabaseEnabled) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "No enforcement backend configured." }, { status: 503 }),
    };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 503 }),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }),
    };
  }
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 }),
    };
  }
  return { ok: true as const, supabase, userId: user.id };
}

function templateForPicker(template: TemplateRow, sender: SenderRow, activeSeatIds: Set<string>) {
  if (template.status !== "approved" || sender.status !== "active" || !sender.seat_id || !activeSeatIds.has(sender.seat_id)) {
    return null;
  }
  const parameterSchema = parseApprovedWhatsAppTemplateParameterSchema(
    template.parameter_schema,
    template.body_parameter_count,
  );
  if (!parameterSchema) return null;
  return {
    id: template.id,
    seatId: sender.seat_id,
    metaName: template.meta_name,
    language: template.language,
    category: template.category,
    version: template.version,
    parameters: parameterSchema,
  };
}

/** Lists only ready-to-send, already Meta-approved template records. */
export async function GET(req: NextRequest) {
  const actor = await requireOutreachOperator(req);
  if (!actor.ok) return actor.response;

  const rl = checkRateLimit(rateLimitKey(req, "whatsapp-template-read", actor.userId), { windowMs: 60_000, max: 120 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const { data: senders, error: senderErr } = await actor.supabase
    .from("whatsapp_senders")
    .select("id, seat_id, status")
    .eq("status", "active");
  if (senderErr) {
    safeLog("whatsapp template sender list error", { message: senderErr.message, code: senderErr.code });
    return NextResponse.json({ ok: false, error: "Could not load WhatsApp senders." }, { status: 500 });
  }

  const activeSenderRows = (senders ?? []) as SenderRow[];
  const senderSeatIds = activeSenderRows.flatMap((sender) => (sender.seat_id ? [sender.seat_id] : []));
  let activeSeatIds = new Set<string>();
  if (senderSeatIds.length > 0) {
    const { data: seats, error: seatErr } = await actor.supabase
      .from("agent_seats")
      .select("id, provider, status, mode")
      .in("id", senderSeatIds);
    if (seatErr) {
      safeLog("whatsapp template seat list error", { message: seatErr.message, code: seatErr.code });
      return NextResponse.json({ ok: false, error: "Could not load WhatsApp sender seats." }, { status: 500 });
    }
    activeSeatIds = new Set(
      ((seats ?? []) as SeatRow[])
        .filter((seat) => seat.provider === "WhatsApp Cloud" && seat.status === "active" && seat.mode === "live")
        .map((seat) => seat.id),
    );
  }

  const { data: templates, error: templateErr } = await actor.supabase
    .from("whatsapp_templates")
    .select("id, sender_id, meta_name, language, category, version, status, parameter_schema, body_parameter_count")
    .eq("status", "approved")
    .order("meta_name", { ascending: true })
    .limit(100);
  if (templateErr) {
    safeLog("whatsapp template list error", { message: templateErr.message, code: templateErr.code });
    return NextResponse.json({ ok: false, error: "Could not load approved WhatsApp templates." }, { status: 500 });
  }

  const senderById = new Map(activeSenderRows.map((sender) => [sender.id, sender]));
  const readyTemplates = ((templates ?? []) as TemplateRow[]).flatMap((template) => {
    const sender = senderById.get(template.sender_id);
    if (!sender) return [];
    const ready = templateForPicker(template, sender, activeSeatIds);
    return ready ? [ready] : [];
  });
  return NextResponse.json({ ok: true, templates: readyTemplates });
}

/**
 * Records a human decision and queues an existing Meta-approved template.
 * The request cannot contain candidate-facing prose. It contains only the
 * selected IDs and bounded placeholder values; metadata and audit content are
 * always read from the trusted catalog on the server.
 */
export async function POST(req: NextRequest) {
  const actor = await requireOutreachOperator(req);
  if (!actor.ok) return actor.response;

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ ok: false, error: "Expected a JSON request." }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return NextResponse.json({ ok: false, error: "Cross-origin template queueing is not allowed." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "whatsapp-template-queue", actor.userId), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, WhatsAppTemplateQueueSchema, { maxBytes: 16_000 });
  if (!validated.ok) return validated.response;
  const payload = validated.data;

  const recipient = normalizeWhatsAppAddress(payload.recipient);
  if (!recipient) {
    return NextResponse.json({ ok: false, error: "A valid E.164 WhatsApp number is required." }, { status: 400 });
  }
  const { data: workspaceId, error: workspaceErr } = await actor.supabase.rpc("current_workspace_id");
  if (workspaceErr || !workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  const { data: seat, error: seatErr } = await actor.supabase
    .from("agent_seats")
    .select("id, provider, status, mode")
    .eq("id", payload.seatId)
    .maybeSingle();
  if (seatErr || !seat || seat.provider !== "WhatsApp Cloud" || seat.status !== "active" || seat.mode !== "live") {
    return NextResponse.json({ ok: false, error: "The selected WhatsApp seat is not live." }, { status: 409 });
  }

  const { data: sender, error: senderErr } = await actor.supabase
    .from("whatsapp_senders")
    .select("id, seat_id, status")
    .eq("workspace_id", workspaceId)
    .eq("seat_id", payload.seatId)
    .eq("status", "active")
    .maybeSingle();
  if (senderErr || !sender) {
    return NextResponse.json({ ok: false, error: "No active WhatsApp sender is linked to that seat." }, { status: 409 });
  }

  const { data: template, error: templateErr } = await actor.supabase
    .from("whatsapp_templates")
    .select("id, sender_id, meta_name, language, category, version, status, parameter_schema, body_parameter_count")
    .eq("workspace_id", workspaceId)
    .eq("id", payload.templateId)
    .eq("sender_id", sender.id)
    .eq("status", "approved")
    .maybeSingle();
  if (templateErr || !template) {
    return NextResponse.json({ ok: false, error: "The selected Meta template is not approved for this sender." }, { status: 409 });
  }

  const trustedTemplate = template as TemplateRow;
  const parameterSchema = parseApprovedWhatsAppTemplateParameterSchema(
    trustedTemplate.parameter_schema,
    trustedTemplate.body_parameter_count,
  );
  if (!parameterSchema) {
    return NextResponse.json(
      { ok: false, error: "This Meta template needs a bounded parameter schema before it can be queued." },
      { status: 409 },
    );
  }
  const audit = buildApprovedWhatsAppTemplateAudit({
    template: {
      id: trustedTemplate.id,
      senderId: trustedTemplate.sender_id,
      metaName: trustedTemplate.meta_name,
      language: trustedTemplate.language,
      version: trustedTemplate.version,
    },
    parameterSchema,
    parameters: payload.parameters,
  });
  if (!audit) {
    return NextResponse.json({ ok: false, error: "Template parameters do not match the approved template bounds." }, { status: 400 });
  }

  const approvalMessageId = randomUUID();
  const bodyHash = approvalHash(APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT, audit.body);
  const scopeHash = approvalScopeHash({ candidateId: payload.candidateId, channel: "WhatsApp", recipient });
  if (!scopeHash) {
    return NextResponse.json({ ok: false, error: "Invalid template recipient." }, { status: 400 });
  }
  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", persisted: false, detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }
  const { data: recorded, error: approvalErr } = await actor.supabase.rpc("record_outreach_approval", {
    p_message_id: approvalMessageId,
    p_body_hash: bodyHash,
    p_approval_scope_hash: scopeHash,
  });
  const approval = recorded as { ok?: boolean; reason?: string } | null;
  if (approvalErr || approval?.ok !== true) {
    safeLog("whatsapp template approval error", { message: approvalErr?.message ?? approval?.reason ?? "unknown" });
    return NextResponse.json({ ok: false, error: "Could not record the human template approval." }, { status: 500 });
  }

  const { data: queuedData, error: queueErr } = await actor.supabase.rpc("enqueue_whatsapp_outbound", {
    p_message_id: approvalMessageId,
    p_candidate_id: payload.candidateId,
    p_campaign_id: null,
    p_seat_id: payload.seatId,
    p_recipient: recipient,
    p_type: "approved_template",
    p_subject: APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
    p_body: audit.body,
    p_template_id: trustedTemplate.id,
    p_template_parameters: audit.parameters,
  });
  const queued = queuedData as { ok?: boolean; status?: string; id?: string; reason?: string } | null;
  if (queueErr || queued?.ok !== true || queued.status !== "queued" || !queued.id) {
    // The approval cannot authorize anything without an outbox row. Revoke it
    // so a failed queue write never leaves a misleading active approval behind.
    await actor.supabase.rpc("revoke_outreach_approval", {
      p_message_id: approvalMessageId,
      p_reason: "Template queue write did not complete.",
    });
    if (queued?.reason === "duplicate") {
      return NextResponse.json({ ok: false, status: "skipped", detail: "This exact template dispatch is already queued or was sent." }, { status: 409 });
    }
    safeLog("whatsapp template queue error", {
      message: queueErr?.message ?? queued?.reason ?? "no result",
      code: queueErr?.code,
    });
    return NextResponse.json({ ok: false, error: "Could not queue the approved template." }, { status: 500 });
  }

  // Only the existing durable dispatcher may reach Meta. This opportunistic
  // drain is optional; the cron/webhook path will still process a queued row.
  const dispatcher = getServiceSupabase();
  if (dispatcher) {
    try {
      await dispatchDue(dispatcher, 1, queued.id);
    } catch (err) {
      safeLog("whatsapp template immediate dispatch error", { message: err instanceof Error ? err.message : "unknown" });
    }
    const { data: dispatched, error: dispatchedErr } = await dispatcher
      .from("messages_outbound")
      .select("status")
      .eq("id", queued.id)
      .maybeSingle();
    if (dispatched?.status === "sent") {
      return NextResponse.json({ ok: true, status: "sent", messageId: queued.id });
    }
    if (dispatched?.status === "blocked") {
      return NextResponse.json({ ok: false, status: "skipped", detail: "WhatsApp policy blocked this template before delivery." }, { status: 409 });
    }
    if (dispatched?.status === "failed") {
      return NextResponse.json({ ok: false, status: "error", detail: "WhatsApp template delivery failed after policy checks." }, { status: 502 });
    }
    if (dispatched?.status === "dispatching" || dispatchedErr || !dispatched || dispatched.status !== "queued") {
      if (dispatchedErr || !dispatched) {
        safeLog("whatsapp template dispatch state unavailable", { message: dispatchedErr?.message ?? "no outbox row" });
      }
      return NextResponse.json(
        {
          ok: false,
          status: "reconciliation-required",
          messageId: queued.id,
          detail: "WhatsApp provider acceptance is not yet reconciled. Do not retry this template dispatch.",
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      status: "queued",
      messageId: queued.id,
      detail: "Queued for policy-checked WhatsApp template delivery. No free-form message was sent by this request.",
    },
    { status: 202 },
  );
}
