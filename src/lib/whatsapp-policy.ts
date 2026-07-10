/*
 * WhatsApp delivery policy. This module is deliberately pure so every send
 * path can apply the same consent and session-window decision before it calls
 * Meta. A passed decision never replaces the final human-likeness gate,
 * approval record, provider check, or durable duplicate guard.
 */

export const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type WhatsAppOutboundType = "candidate_reply" | "approved_template";
export type WhatsAppPermissionStatus = "opted_in" | "opted_out";

export interface WhatsAppPermission {
  status: WhatsAppPermissionStatus;
  /** Canonical E.164 digits without a leading plus. */
  recipientAddress: string;
  recordedAt: string;
  expiresAt?: string | null;
}

export interface WhatsAppTemplateReference {
  /** Exact Meta-approved template name, never model-generated prose. */
  name: string;
  /** Meta language code, for example en_US. */
  language: string;
  /** Set only after ARIA confirms this name and locale in its trusted catalog. */
  approved: boolean;
}

export interface WhatsAppDispatchInput {
  now: Date;
  recipientAddress: string;
  type: WhatsAppOutboundType;
  permission: WhatsAppPermission | null;
  /** The exact inbound event that opens the customer-service window. */
  inboundReceivedAt?: string | null;
  template?: WhatsAppTemplateReference | null;
}

export type WhatsAppDispatchDecision =
  | { allow: true; recipientAddress: string }
  | {
      allow: false;
      reason:
        | "invalid-recipient"
        | "missing-opt-in"
        | "opted-out"
        | "permission-recipient-mismatch"
        | "permission-expired"
        | "reply-window-required"
        | "invalid-inbound-time"
        | "inbound-in-future"
        | "reply-window-closed"
        | "template-required"
        | "template-not-approved";
    };

const WHATSAPP_OPT_OUT_COMMANDS = new Set([
  "stop",
  "unsubscribe",
  "opt out",
  "opt-out",
  "end",
  "quit",
  "cancel",
  "remove me",
  "arret",
  "arrête",
  "arretez",
  "arrêtez",
  "désabonner",
  "desabonner",
]);

/**
 * Canonical Meta recipient form: E.164 country-code digits without `+`.
 * Rejects letters and malformed values rather than silently discarding input.
 */
export function normalizeWhatsAppAddress(raw: string): string | null {
  if (typeof raw !== "string" || !/^[+\d\s().-]+$/.test(raw)) return null;
  const plusIndex = raw.indexOf("+");
  if (plusIndex > 0 || (plusIndex === 0 && raw.indexOf("+", 1) !== -1)) return null;
  const digits = raw.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/**
 * Deterministic candidate opt-out commands. These are processed before any
 * thread lookup or model request, so an opt-out cannot become agent context.
 */
export function isWhatsAppOptOut(raw: string): boolean {
  const text = typeof raw === "string" ? raw.trim().toLocaleLowerCase() : "";
  return WHATSAPP_OPT_OUT_COMMANDS.has(text);
}

function templateDecision(template: WhatsAppTemplateReference | null | undefined): WhatsAppDispatchDecision | null {
  if (!template || !/^[a-z0-9_]{1,512}$/i.test(template.name) || !/^[a-z]{2,3}_[A-Z]{2}$/.test(template.language)) {
    return { allow: false, reason: "template-required" };
  }
  return template.approved ? null : { allow: false, reason: "template-not-approved" };
}

/**
 * Decides whether a typed WhatsApp outbound message may reach the provider.
 * Cold contact is limited to an approved template. Free-form text is limited
 * to a verified inbound conversation window and only when the recipient has
 * a current, matching opt-in record.
 */
export function assessWhatsAppDispatch(input: WhatsAppDispatchInput): WhatsAppDispatchDecision {
  const recipientAddress = normalizeWhatsAppAddress(input.recipientAddress);
  if (!recipientAddress) return { allow: false, reason: "invalid-recipient" };

  const permission = input.permission;
  if (!permission || permission.status !== "opted_in") {
    return { allow: false, reason: permission?.status === "opted_out" ? "opted-out" : "missing-opt-in" };
  }
  if (normalizeWhatsAppAddress(permission.recipientAddress) !== recipientAddress) {
    return { allow: false, reason: "permission-recipient-mismatch" };
  }
  if (permission.expiresAt) {
    const expiresAt = new Date(permission.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= input.now) {
      return { allow: false, reason: "permission-expired" };
    }
  }

  if (input.type === "approved_template") {
    const templateFailure = templateDecision(input.template);
    return templateFailure ?? { allow: true, recipientAddress };
  }

  if (!input.inboundReceivedAt) return { allow: false, reason: "reply-window-required" };
  const inboundAt = new Date(input.inboundReceivedAt);
  if (Number.isNaN(inboundAt.getTime())) return { allow: false, reason: "invalid-inbound-time" };
  if (inboundAt > input.now) return { allow: false, reason: "inbound-in-future" };
  if (input.now.getTime() - inboundAt.getTime() >= WHATSAPP_REPLY_WINDOW_MS) {
    return { allow: false, reason: "reply-window-closed" };
  }

  return { allow: true, recipientAddress };
}
