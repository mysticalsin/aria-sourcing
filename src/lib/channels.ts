// Real WhatsApp + SMS outreach adapters (server-only). Token-gated: each returns a
// dry-run when its credentials are absent, so the app stays fully functional in demo
// and goes live the moment the env vars are set. Tokens are never logged. These do
// only the final delivery — the approval gate, suppression, and guardrails upstream
// still apply, so this never bypasses never-auto-send.

export interface ChannelSendRequest {
  to: string; // E.164 phone, e.g. +14155552671
  body: string;
}

interface WhatsAppSenderRequest {
  /** Resolved from the locked ARIA sender record, never accepted from a client. */
  senderPhoneNumberId?: string;
}

export interface WhatsAppTemplateSendRequest {
  to: string;
  kind: "approved_template";
  template: {
    /** Meta-approved template name, selected from ARIA's trusted catalog. */
    name: string;
    /** Meta language code, for example en_US. */
    language: string;
    /** Final, typed body parameters only. No tool output or event payloads. */
    bodyParameters?: string[];
  };
}

export type WhatsAppSendRequest =
  | (ChannelSendRequest & WhatsAppSenderRequest)
  | (WhatsAppTemplateSendRequest & WhatsAppSenderRequest);

function isWhatsAppTemplateRequest(req: WhatsAppSendRequest): req is WhatsAppTemplateSendRequest & WhatsAppSenderRequest {
  return "kind" in req && req.kind === "approved_template";
}

export interface ChannelSendOutcome {
  status: "sent" | "dry-run" | "error";
  /** Whether an external provider definitely accepted, definitely rejected, or may have accepted the request. */
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: string;
  detail: string;
  id?: string;
}

const TIMEOUT = 15_000;

function failedHttpDeliveryState(status: number): "not-sent" | "unknown" {
  // A timeout or server failure can be returned after the provider processed
  // the request. Client rejections are definitive; these responses are not.
  return status === 408 || status >= 500 ? "unknown" : "not-sent";
}

// Graph API versions expire ~2 years after release (v18.0 died early 2026).
// v21.0 is the early-2026 stable; override without a deploy if Meta sunsets it.
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v21.0";

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

/**
 * Send a WhatsApp message via the WhatsApp Business Cloud API (Meta).
 * Needs WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Note: free-form text only reaches a
 * contact inside an open 24h session; cold outreach to a new number requires a
 * pre-approved message template configured in Meta Business.
 */
export async function sendWhatsApp(req: WhatsAppSendRequest): Promise<ChannelSendOutcome> {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const phoneNumberId = req.senderPhoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!token || !phoneNumberId) {
    return {
      status: "dry-run",
      deliveryState: "not-sent",
      provider: "WhatsApp Cloud",
      detail: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set, nothing sent.",
    };
  }
  const to = normalizePhone(req.to);
  if (!to) return { status: "error", deliveryState: "not-sent", provider: "WhatsApp Cloud", detail: "No phone number on file for this candidate." };

  let payload: Record<string, unknown>;
  if (isWhatsAppTemplateRequest(req)) {
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: req.template.name,
        language: { code: req.template.language },
        ...(req.template.bodyParameters?.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: req.template.bodyParameters.map((text) => ({ type: "text", text })),
                },
              ],
            }
          : {}),
      },
    };
  } else {
    payload = { messaging_product: "whatsapp", to, type: "text", text: { body: req.body } };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { status: "error", deliveryState: failedHttpDeliveryState(res.status), provider: "WhatsApp Cloud", detail: `WhatsApp API ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    const providerMessageId = data.messages?.[0]?.id;
    if (!providerMessageId) {
      return {
        status: "error",
        deliveryState: "unknown",
        provider: "WhatsApp Cloud",
        detail: "WhatsApp API response did not include a message ID for reconciliation.",
      };
    }
    return { status: "sent", deliveryState: "accepted", provider: "WhatsApp Cloud", detail: "Sent via WhatsApp.", id: providerMessageId };
  } catch (err) {
    return {
      status: "error",
      deliveryState: "unknown",
      provider: "WhatsApp Cloud",
      detail: err instanceof Error ? err.message : "WhatsApp send failed.",
    };
  }
}

/** Send an SMS via Twilio. Needs TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM. */
export async function sendSms(req: ChannelSendRequest): Promise<ChannelSendOutcome> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_FROM ?? "";
  if (!sid || !token || !from) {
    return {
      status: "dry-run",
      deliveryState: "not-sent",
      provider: "Twilio SMS",
      detail: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM not set, nothing sent.",
    };
  }
  const to = normalizePhone(req.to);
  if (!to) return { status: "error", deliveryState: "not-sent", provider: "Twilio SMS", detail: "No phone number on file for this candidate." };

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const form = new URLSearchParams({ To: to, From: from, Body: req.body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { status: "error", deliveryState: failedHttpDeliveryState(res.status), provider: "Twilio SMS", detail: `Twilio ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    const providerMessageId = data.sid?.trim();
    if (!providerMessageId) {
      return {
        status: "error",
        deliveryState: "unknown",
        provider: "Twilio SMS",
        detail: "Twilio response did not include a message SID for reconciliation.",
      };
    }
    return { status: "sent", deliveryState: "accepted", provider: "Twilio SMS", detail: "Sent via SMS.", id: providerMessageId };
  } catch (err) {
    return { status: "error", deliveryState: "unknown", provider: "Twilio SMS", detail: err instanceof Error ? err.message : "SMS send failed." };
  }
}
