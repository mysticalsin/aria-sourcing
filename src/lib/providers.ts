import { redactEmail, redactSecrets } from "@/lib/log-redact";
import { renderEmailWithUnsubscribe } from "@/lib/email-unsubscribe";
import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";
import type { SeatProvider } from "./types";

function auditLog(level: "info" | "error", message: string, meta?: Record<string, unknown>) {
  const entry = { time: new Date().toISOString(), source: "email-provider", level, message, ...(meta ?? {}) };
  const serialized = redactSecrets(redactEmail(JSON.stringify(entry)));
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
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
    DeepSeek: /^sk-[A-Za-z0-9_-]{16,}$/,
    "NVIDIA NIM": /^nvapi-[A-Za-z0-9_-]{16,}$/,
    Resend: /^re_[A-Za-z0-9_-]{10,}$/,
    SendGrid: /^SG\.[A-Za-z0-9_.-]{20,}$/,
    Sillage: /^sk_live_[A-Za-z0-9]{16,}$/,
    Apify: /^apify_api_[A-Za-z0-9]{20,}$/,
    Tavily: /^tvly-[A-Za-z0-9_-]{8,}$/,
    Databricks: /^(?:dapi[A-Za-z0-9]{16,}|[A-Za-z0-9_./+=:-]{12,})$/,
    Cloudflare: /^[A-Za-z0-9_-]{20,}$/,
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
  /** Optional branded HTML (e.g. Mantu wrapper). Plain `body` remains the text part. */
  htmlBody?: string;
  /** Server-generated opaque recipient link; required for any live delivery. */
  unsubscribeUrl?: string;
  /** Immutable per-attempt identity stamped on the ledger claim before the
   *  provider call. Emitted as an X-Aria-Send-Attempt header so an ambiguous
   *  outcome can be matched against the provider's logs by a human. */
  attemptId?: string;
  /** RFC 5322 Message-ID ("<uuid@domain>") minted by the durable claim; emitted
   *  as the Message-ID header so an inbound reply threads back to this send. */
  messageId?: string;
}

export interface SendOutcome {
  status: "sent" | "dry-run" | "error";
  /** Whether an external provider definitely accepted, definitely rejected, or may have accepted the request. */
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: SeatProvider;
  detail: string;
  id?: string;
}

/** Perform a real send via the provider's official API. Never throws on
 *  transport failure — an unknown post-transport outcome is reported as
 *  deliveryState "unknown" so the caller can fail closed. */
export async function sendViaProvider(req: SendRequest): Promise<SendOutcome> {
  auditLog("info", "Send attempt", { provider: req.provider, from: req.from, to: req.to });
  if (!req.unsubscribeUrl) {
    return {
      status: "error",
      deliveryState: "not-sent",
      provider: req.provider,
      detail: "No compliant unsubscribe link is configured for this email.",
    };
  }
  const rendered = renderEmailWithUnsubscribe(req.body, req.unsubscribeUrl, {
    htmlBody: req.htmlBody,
  });
  const headers: Record<string, string> = {
    ...rendered.headers,
    ...(req.attemptId ? { "X-Aria-Send-Attempt": req.attemptId } : {}),
    ...(req.messageId ? { "Message-ID": req.messageId } : {}),
  };
  switch (req.provider) {
    case "Resend": {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        auditLog("info", "Resend dry-run: no API key", { to: req.to });
        return { status: "dry-run", deliveryState: "not-sent", provider: req.provider, detail: "No RESEND_API_KEY, dry-run only." };
      }
      try {
        // Base URL is overridable for staging/test harnesses; defaults to the
        // production Resend API. Never affects which provider is chosen — only
        // where the already-authenticated request is sent.
        const base = (process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/$/, "");
        const res = await fetch(`${base}/emails`, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: req.fromName ? `${req.fromName} <${req.from}>` : req.from,
            to: [req.to],
            subject: req.subject,
            text: rendered.text,
            html: rendered.html,
            headers,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          auditLog("error", "Resend send failed", { status: res.status, to: req.to });
          return { status: "error", deliveryState: classifyFailedHttpDeliveryState(res.status), provider: req.provider, detail: `Resend send error ${res.status}.` };
        }
        auditLog("info", "Resend send succeeded", { to: req.to, id: json?.id });
        return { status: "sent", deliveryState: "accepted", provider: req.provider, detail: "Sent via Resend.", id: json?.id };
      } catch (err) {
        // A timeout or disconnect after the request left this process may have
        // been accepted by Resend. Never report it as a definitive failure.
        auditLog("error", "Resend send transport failure", { to: req.to, message: err instanceof Error ? err.message : "unknown" });
        return { status: "error", deliveryState: "unknown", provider: req.provider, detail: "Resend transport failure: delivery state unknown." };
      }
    }
    case "SendGrid": {
      const key = process.env.SENDGRID_API_KEY;
      if (!key) {
        auditLog("info", "SendGrid dry-run: no API key", { to: req.to });
        return { status: "dry-run", deliveryState: "not-sent", provider: req.provider, detail: "No SENDGRID_API_KEY, dry-run only." };
      }
      try {
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: req.to }] }],
            from: { email: req.from, name: req.fromName },
            subject: req.subject,
            content: [
              { type: "text/plain", value: rendered.text },
              { type: "text/html", value: rendered.html },
            ],
            headers,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          auditLog("error", "SendGrid send failed", { status: res.status, to: req.to, body: redactSecrets(redactEmail(txt.slice(0, 500))) });
          return { status: "error", deliveryState: classifyFailedHttpDeliveryState(res.status), provider: req.provider, detail: `SendGrid send error ${res.status}.` };
        }
        auditLog("info", "SendGrid send succeeded", { to: req.to });
        return { status: "sent", deliveryState: "accepted", provider: req.provider, detail: "Sent via SendGrid." };
      } catch (err) {
        auditLog("error", "SendGrid send transport failure", { to: req.to, message: err instanceof Error ? err.message : "unknown" });
        return { status: "error", deliveryState: "unknown", provider: req.provider, detail: "SendGrid transport failure: delivery state unknown." };
      }
    }
    case "Microsoft Graph":
    case "Gmail API": {
      // OAuth providers are handled by sendViaOAuthProvider in the outreach send
      // route so the stored token can be resolved server-side.
      const detail = `${req.provider} must be sent via the OAuth adapter. Dry-run.`;
      auditLog("info", "OAuth provider dry-run", { provider: req.provider, to: req.to });
      return { status: "dry-run", deliveryState: "not-sent", provider: req.provider, detail };
    }
    default:
      auditLog("error", "Unknown email provider", { provider: req.provider });
      return { status: "dry-run", deliveryState: "not-sent", provider: req.provider, detail: "Unknown provider, dry-run only." };
  }
}
