/**
 * Resolve how REI autopilot may send WhatsApp first-touch.
 * Cold Meta traffic requires an approved template; free-form replies need an open window.
 */

import {
  APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
  buildApprovedWhatsAppTemplateAudit,
  parseApprovedWhatsAppTemplateParameterSchema,
} from "@/lib/whatsapp-template-queue";
import {
  assessWhatsAppDispatch,
  normalizeWhatsAppAddress,
  type WhatsAppPermission,
} from "@/lib/whatsapp-policy";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WhatsAppAutopilotShape =
  | {
      kind: "candidate_reply";
      recipient: string;
      subject: string;
      body: string;
      templateId: null;
      templateParameters: [];
    }
  | {
      kind: "approved_template";
      recipient: string;
      subject: typeof APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT;
      body: string;
      templateId: string;
      templateParameters: string[];
    }
  | {
      kind: "skip";
      reason: string;
      detail: string;
    };

type ServiceClient = SupabaseClient;

/**
 * Open 24h customer-service window + opted-in contact → free-form reply OK.
 * Else a zero-parameter Meta-approved template on the live seat's sender.
 * Otherwise fail closed (operator uses the WhatsApp template picker).
 */
export async function resolveWhatsAppAutopilotShape(
  svc: ServiceClient,
  input: {
    workspaceId: string;
    seatId: string;
    recipient: string;
    subject: string;
    body: string;
    now?: Date;
  },
): Promise<WhatsAppAutopilotShape> {
  const recipient = normalizeWhatsAppAddress(input.recipient);
  if (!recipient) {
    return { kind: "skip", reason: "no_phone", detail: "No valid WhatsApp number." };
  }

  const now = input.now ?? new Date();
  const { data: contact } = await svc
    .from("whatsapp_contacts")
    .select("consent_status, recipient_e164, recorded_at, expires_at, last_inbound_at")
    .eq("workspace_id", input.workspaceId)
    .eq("recipient_e164", recipient)
    .maybeSingle();

  const permission: WhatsAppPermission | null = contact
    ? {
        status: contact.consent_status === "opted_in" ? "opted_in" : "opted_out",
        recipientAddress: contact.recipient_e164,
        recordedAt: contact.recorded_at,
        expiresAt: contact.expires_at,
      }
    : null;

  const replyDecision = assessWhatsAppDispatch({
    now,
    recipientAddress: recipient,
    type: "candidate_reply",
    permission,
    inboundReceivedAt: contact?.last_inbound_at ?? null,
  });
  if (replyDecision.allow) {
    return {
      kind: "candidate_reply",
      recipient,
      subject: input.subject,
      body: input.body,
      templateId: null,
      templateParameters: [],
    };
  }

  // Cold path: only a zero-parameter approved Meta template can auto-send.
  // Parameterized templates need human parameter binding via the picker.
  const { data: sender } = await svc
    .from("whatsapp_senders")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("seat_id", input.seatId)
    .eq("status", "active")
    .maybeSingle();
  if (!sender?.id) {
    return {
      kind: "skip",
      reason: "whatsapp_cold_requires_template",
      detail:
        "Cold WhatsApp needs an approved Meta template (and active sender). Use the template picker, or wait for an open reply window.",
    };
  }

  const { data: templates } = await svc
    .from("whatsapp_templates")
    .select("id, sender_id, meta_name, language, version, status, parameter_schema, body_parameter_count")
    .eq("workspace_id", input.workspaceId)
    .eq("sender_id", sender.id)
    .eq("status", "approved")
    .eq("body_parameter_count", 0)
    .limit(5);

  const row = (templates ?? [])[0];
  if (!row) {
    return {
      kind: "skip",
      reason: "whatsapp_cold_requires_template",
      detail:
        "No zero-parameter Meta-approved template on this WhatsApp seat. Approve a template or send via the template picker.",
    };
  }

  const parameterSchema = parseApprovedWhatsAppTemplateParameterSchema(
    row.parameter_schema,
    row.body_parameter_count,
  );
  if (!parameterSchema) {
    return {
      kind: "skip",
      reason: "whatsapp_template_schema_invalid",
      detail: "WhatsApp template parameter schema is incomplete.",
    };
  }

  const audit = buildApprovedWhatsAppTemplateAudit({
    template: {
      id: row.id,
      senderId: row.sender_id,
      metaName: row.meta_name,
      language: row.language,
      version: row.version,
    },
    parameterSchema,
    parameters: [],
  });
  if (!audit) {
    return {
      kind: "skip",
      reason: "whatsapp_template_audit_failed",
      detail: "Could not build WhatsApp template audit payload.",
    };
  }

  return {
    kind: "approved_template",
    recipient,
    subject: APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
    body: audit.body,
    templateId: row.id,
    templateParameters: audit.parameters,
  };
}
