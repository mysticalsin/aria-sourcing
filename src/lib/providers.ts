import type { SeatProvider } from "./types";

/* ============================================================================
   Email provider adapters (SERVER ONLY).
   Dry-run is the default everywhere. A real send happens ONLY when: live mode is
   on, the seat's domain is verified, an API key is present in server env, and the
   request is explicitly confirmed live. Resend / SendGrid send via their official
   REST APIs with a single API key. Microsoft Graph / Gmail require per-mailbox
   OAuth (connect flow) and remain a documented seam — never a fake send.
   No scraping, no LinkedIn automation — email only.
   ========================================================================== */

export interface SendRequest {
  provider: SeatProvider;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
}

export interface SendOutcome {
  status: "sent" | "dry-run" | "error";
  provider: SeatProvider;
  detail: string;
  id?: string;
}

function plainToHtml(body: string): string {
  return body
    .split("\n")
    .map((l) => (l.trim() ? `<p>${escapeHtml(l)}</p>` : "<br/>"))
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

/** Perform a real send via the provider's official API. Throws on misconfig. */
export async function sendViaProvider(req: SendRequest): Promise<SendOutcome> {
  switch (req.provider) {
    case "Resend": {
      const key = process.env.RESEND_API_KEY;
      if (!key) return { status: "dry-run", provider: req.provider, detail: "No RESEND_API_KEY — dry-run." };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: req.fromName ? `${req.fromName} <${req.from}>` : req.from,
          to: [req.to],
          subject: req.subject,
          text: req.body,
          html: plainToHtml(req.body),
          headers: { "List-Unsubscribe": "<mailto:unsubscribe@hermes.example>" },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { status: "error", provider: req.provider, detail: json?.message ?? `HTTP ${res.status}` };
      return { status: "sent", provider: req.provider, detail: "Sent via Resend.", id: json?.id };
    }
    case "SendGrid": {
      const key = process.env.SENDGRID_API_KEY;
      if (!key) return { status: "dry-run", provider: req.provider, detail: "No SENDGRID_API_KEY — dry-run." };
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: req.to }] }],
          from: { email: req.from, name: req.fromName },
          subject: req.subject,
          content: [
            { type: "text/plain", value: req.body },
            { type: "text/html", value: plainToHtml(req.body) },
          ],
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { status: "error", provider: req.provider, detail: txt || `HTTP ${res.status}` };
      }
      return { status: "sent", provider: req.provider, detail: "Sent via SendGrid." };
    }
    case "Microsoft Graph":
    case "Gmail API":
      // Per-mailbox OAuth required. Until a mailbox is connected, stay dry-run.
      return {
        status: "dry-run",
        provider: req.provider,
        detail: `${req.provider} needs a connected mailbox (OAuth). Dry-run until connected.`,
      };
    default:
      return { status: "dry-run", provider: req.provider, detail: "Unknown provider — dry-run." };
  }
}
