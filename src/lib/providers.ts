import { redactEmail, redactSecrets } from "@/lib/log-redact";
import type { SeatProvider } from "./types";

function auditLog(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
  const entry = { time: new Date().toISOString(), source: "email-provider", level, ...(meta ?? {}) };
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

/** Deterministic format validation for an API key by provider. No network — a
 *  malformed key is rejected immediately; a well-formed one passes as plausible. */
export function validateApiKeyFormat(provider: string, value: string): { valid: boolean; detail: string } {
  const v = (value ?? "").trim();
  if (!v) return { valid: false, detail: "Empty key." };
  const rule: Record<string, RegExp> = {
    Anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    OpenAI: /^sk-[A-Za-z0-9_-]{20,}$/,
    "Kimi (Moonshot)": /^sk-[A-Za-z0-9_-]{20,}$/,
    Resend: /^re_[A-Za-z0-9_-]{10,}$/,
    SendGrid: /^SG\.[A-Za-z0-9_.-]{20,}$/,
  };
  const re = rule[provider];
  if (!re) return { valid: v.length >= 8, detail: v.length >= 8 ? "Accepted (custom)." : "Too short." };
  return re.test(v)
    ? { valid: true, detail: `${provider} key format looks valid.` }
    : { valid: false, detail: `Does not match the expected ${provider} key format.` };
}

export function last4Of(value: string): string {
  const v = (value ?? "").trim();
  return v.length >= 4 ? v.slice(-4) : "••••";
}

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
  auditLog("info", "Send attempt", { provider: req.provider, from: req.from, to: req.to });
  switch (req.provider) {
    case "Resend": {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        auditLog("info", "Resend dry-run: no API key", { to: req.to });
        return { status: "dry-run", provider: req.provider, detail: "No RESEND_API_KEY — dry-run." };
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
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
      if (!res.ok) {
        auditLog("error", "Resend send failed", { status: res.status, to: req.to });
        return { status: "error", provider: req.provider, detail: json?.message ?? `HTTP ${res.status}` };
      }
      auditLog("info", "Resend send succeeded", { to: req.to, id: json?.id });
      return { status: "sent", provider: req.provider, detail: "Sent via Resend.", id: json?.id };
    }
    case "SendGrid": {
      const key = process.env.SENDGRID_API_KEY;
      if (!key) {
        auditLog("info", "SendGrid dry-run: no API key", { to: req.to });
        return { status: "dry-run", provider: req.provider, detail: "No SENDGRID_API_KEY — dry-run." };
      }
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
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
        auditLog("error", "SendGrid send failed", { status: res.status, to: req.to, body: redactSecrets(redactEmail(txt.slice(0, 500))) });
        return { status: "error", provider: req.provider, detail: `SendGrid send error ${res.status}.` };
      }
      auditLog("info", "SendGrid send succeeded", { to: req.to });
      return { status: "sent", provider: req.provider, detail: "Sent via SendGrid." };
    }
    case "Microsoft Graph":
    case "Gmail API": {
      // OAuth providers are handled by sendViaOAuthProvider in the outreach send
      // route so the stored token can be resolved server-side.
      const detail = `${req.provider} must be sent via the OAuth adapter. Dry-run.`;
      auditLog("info", "OAuth provider dry-run", { provider: req.provider, to: req.to });
      return { status: "dry-run", provider: req.provider, detail };
    }
    default:
      auditLog("error", "Unknown email provider", { provider: req.provider });
      return { status: "dry-run", provider: req.provider, detail: "Unknown provider — dry-run." };
  }
}
