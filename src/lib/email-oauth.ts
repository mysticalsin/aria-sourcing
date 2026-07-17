import { redactEmail, redactSecrets } from "@/lib/log-redact";
import { renderEmailWithUnsubscribe, type RenderedUnsubscribeEmail } from "@/lib/email-unsubscribe";
import { classifyFailedHttpDeliveryState } from "@/lib/delivery-outcome";
import type { EmailConnection, EmailConnectionProvider } from "./types";

export interface OAuthSendRequest {
  provider?: EmailConnectionProvider;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  /** Server-generated opaque recipient link; required for any live delivery. */
  unsubscribeUrl?: string;
  /** Immutable per-attempt identity stamped on the ledger claim before the
   *  provider call. Emitted as an X-Aria-Send-Attempt MIME header so an
   *  ambiguous outcome can be matched against the mailbox by a human. */
  attemptId?: string;
  /** RFC 5322 Message-ID (e.g. "<uuid@domain>") minted by the durable claim
   *  BEFORE the send and stamped into the MIME headers, so the durable ledger,
   *  the provider send, and later inbound reply correlation all agree on one
   *  value. When absent (legacy synchronous path) no Message-ID is stamped. */
  messageId?: string;
}

export interface OAuthSendOutcome {
  status: "sent" | "dry-run" | "error";
  /** Whether an external provider definitely accepted, definitely rejected, or may have accepted the request. */
  deliveryState: "accepted" | "not-sent" | "unknown";
  provider: EmailConnectionProvider;
  detail: string;
  id?: string;
}

/** Send via Gmail API using a stored OAuth connection. */
export async function sendViaGmailApi(req: OAuthSendRequest, connection: EmailConnection): Promise<OAuthSendOutcome> {
  const provider = connection.provider;
  if (!req.unsubscribeUrl) {
    return { status: "error", deliveryState: "not-sent", provider, detail: "No compliant unsubscribe link is configured for this email." };
  }
  // Token refresh is a separate pre-transport endpoint: its failure proves the
  // message never reached the send API, so the attempt stays retryable.
  const token = await ensureAccessToken(connection);
  if (!token) {
    return { status: "error", deliveryState: "not-sent", provider, detail: "Unable to refresh Gmail access token." };
  }

  const mime = buildMimeMessage(req, renderEmailWithUnsubscribe(req.body, req.unsubscribeUrl));
  const raw = Buffer.from(mime).toString("base64url");

  try {
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    if (!res.ok) {
      return { status: "error", deliveryState: classifyFailedHttpDeliveryState(res.status), provider, detail: `Gmail API error ${res.status}.` };
    }
    return { status: "sent", deliveryState: "accepted", provider, detail: "Sent via Gmail API.", id: json.id };
  } catch {
    // A timeout or disconnect after the request left this process may have
    // been accepted by Gmail. Never report it as a definitive failure.
    return { status: "error", deliveryState: "unknown", provider, detail: "Gmail transport failure: delivery state unknown." };
  }
}

/** Send via Microsoft Graph using a stored OAuth connection. */
export async function sendViaMicrosoftGraph(
  req: OAuthSendRequest,
  connection: EmailConnection,
): Promise<OAuthSendOutcome> {
  const provider = connection.provider;
  if (!req.unsubscribeUrl) {
    return { status: "error", deliveryState: "not-sent", provider, detail: "No compliant unsubscribe link is configured for this email." };
  }
  // Token refresh is a separate pre-transport endpoint: its failure proves the
  // message never reached the send API, so the attempt stays retryable.
  const token = await ensureAccessToken(connection);
  if (!token) {
    return { status: "error", deliveryState: "not-sent", provider, detail: "Unable to refresh Microsoft access token." };
  }

  // Graph's JSON message shape only permits x-* custom headers. Send a raw MIME
  // message so standard List-Unsubscribe headers survive the provider boundary.
  const mime = buildMimeMessage(req, renderEmailWithUnsubscribe(req.body, req.unsubscribeUrl));
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: Buffer.from(mime).toString("base64"),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("Microsoft Graph send error", { status: res.status, body: redactSecrets(redactEmail(txt.slice(0, 500))) });
      return { status: "error", deliveryState: classifyFailedHttpDeliveryState(res.status), provider, detail: `Microsoft Graph send error ${res.status}.` };
    }
    return { status: "sent", deliveryState: "accepted", provider, detail: "Sent via Microsoft Graph." };
  } catch {
    return { status: "error", deliveryState: "unknown", provider, detail: "Microsoft Graph transport failure: delivery state unknown." };
  }
}

/**
 * Return a valid access token, refreshing if needed.
 * Returns null if refresh is unavailable or fails.
 *
 * NOTE: This mutates the in-memory connection object but does NOT write the
 * refreshed token back to the database. The caller is responsible for persisting
 * a refreshed token when it wants to (typically via the service-role Supabase
 * client in the API route).
 */
async function ensureAccessToken(connection: EmailConnection): Promise<string | null> {
  const now = Date.now();
  const expires = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
  const bufferMs = 60_000;

  if (expires && expires > now + bufferMs && connection.accessToken) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) return null;

  if (connection.provider === "Gmail API") {
    return refreshGoogleToken(connection);
  }
  if (connection.provider === "Microsoft Graph") {
    return refreshMicrosoftToken(connection);
  }
  return null;
}

/** Public: get a valid (refreshed) access token for READING a connection's
 *  mailbox. Caller persists the token if it changed. Read-only — this never sends. */
export async function getAccessTokenForReading(connection: EmailConnection): Promise<string | null> {
  return ensureAccessToken(connection);
}

// Retry an idempotent OAuth token refresh on transient failures (429 / 5xx / network).
// Safe to retry — unlike a send, a refresh can't double-contact anyone.
async function postFormWithRetry(url: string, body: URLSearchParams, maxRetries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      // Success or a non-retryable client error (e.g. invalid_grant) — return as-is.
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`OAuth token endpoint ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error("OAuth token refresh failed.");
}

async function refreshGoogleToken(connection: EmailConnection): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !connection.refreshToken) return null;

  let res: Response;
  try {
    res = await postFormWithRetry(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refreshToken,
        grant_type: "refresh_token",
      }),
    );
  } catch {
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    return null;
  }
  connection.accessToken = json.access_token;
  connection.expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;
  return json.access_token;
}

async function refreshMicrosoftToken(connection: EmailConnection): Promise<string | null> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret || !connection.refreshToken) return null;

  let res: Response;
  try {
    res = await postFormWithRetry(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refreshToken,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.ReadWrite offline_access",
      }),
    );
  } catch {
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    return null;
  }
  connection.accessToken = json.access_token;
  connection.expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;
  if (json.refresh_token) connection.refreshToken = json.refresh_token;
  return json.access_token;
}

function buildMimeMessage(req: OAuthSendRequest, rendered: RenderedUnsubscribeEmail): string {
  const boundary = `__hermes_${Math.random().toString(36).slice(2)}__`;
  const fromHeader = req.fromName ? `${req.fromName} <${req.from}>` : req.from;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${req.to}`,
    `Subject: ${req.subject}`,
    // Durable correlation key: the RFC Message-ID the ledger recorded, so an
    // inbound reply's In-Reply-To/References threads back to this exact send.
    ...(req.messageId ? [`Message-ID: ${req.messageId}`] : []),
    `List-Unsubscribe: ${rendered.headers["List-Unsubscribe"]}`,
    `List-Unsubscribe-Post: ${rendered.headers["List-Unsubscribe-Post"]}`,
    // Per-attempt identity for human reconciliation of ambiguous outcomes.
    ...(req.attemptId ? [`X-Aria-Send-Attempt: ${req.attemptId}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "MIME-Version: 1.0",
    "",
  ];
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    rendered.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: 7bit",
    "",
    rendered.html,
    `--${boundary}--`,
  ];
  return headers.concat(parts).join("\r\n");
}
