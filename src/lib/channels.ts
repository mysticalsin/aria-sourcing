// Real WhatsApp + SMS outreach adapters (server-only). Token-gated: each returns a
// dry-run when its credentials are absent, so the app stays fully functional in demo
// and goes live the moment the env vars are set. Tokens are never logged. These do
// only the final delivery — the approval gate, suppression, and guardrails upstream
// still apply, so this never bypasses never-auto-send.

export interface ChannelSendRequest {
  to: string; // E.164 phone, e.g. +14155552671
  body: string;
}

export interface ChannelSendOutcome {
  status: "sent" | "dry-run" | "error";
  provider: string;
  detail: string;
  id?: string;
}

const TIMEOUT = 15_000;

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

/**
 * Send a WhatsApp message via the WhatsApp Business Cloud API (Meta).
 * Needs WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Note: free-form text only reaches a
 * contact inside an open 24h session; cold outreach to a new number requires a
 * pre-approved message template configured in Meta Business.
 */
export async function sendWhatsApp(req: ChannelSendRequest): Promise<ChannelSendOutcome> {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!token || !phoneNumberId) {
    return {
      status: "dry-run",
      provider: "WhatsApp Cloud",
      detail: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set, nothing sent.",
    };
  }
  const to = normalizePhone(req.to);
  if (!to) return { status: "error", provider: "WhatsApp Cloud", detail: "No phone number on file for this candidate." };

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: req.body } }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { status: "error", provider: "WhatsApp Cloud", detail: `WhatsApp API ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { status: "sent", provider: "WhatsApp Cloud", detail: "Sent via WhatsApp.", id: data.messages?.[0]?.id };
  } catch (err) {
    return {
      status: "error",
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
      provider: "Twilio SMS",
      detail: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM not set, nothing sent.",
    };
  }
  const to = normalizePhone(req.to);
  if (!to) return { status: "error", provider: "Twilio SMS", detail: "No phone number on file for this candidate." };

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const form = new URLSearchParams({ To: to, From: from, Body: req.body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return { status: "error", provider: "Twilio SMS", detail: `Twilio ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return { status: "sent", provider: "Twilio SMS", detail: "Sent via SMS.", id: data.sid };
  } catch (err) {
    return { status: "error", provider: "Twilio SMS", detail: err instanceof Error ? err.message : "SMS send failed." };
  }
}
