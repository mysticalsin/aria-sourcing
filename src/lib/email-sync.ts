// READ-ONLY. GET requests only — this module never sends, modifies, marks-read, or deletes mail.

/**
 * Pure read-only email sync helpers (server-only).
 *
 * Every external call in this file is an HTTP GET. No write verb (POST / PUT /
 * PATCH / DELETE) touches the mailbox, ever. Tokens are never logged.
 */

export interface InboundMessage {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Strip HTML tags and collapse whitespace. Mirrors the Graph path logic. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true when the string contains at least one properly-formed HTML
 * open-tag (letter-started tag name). Guards against over-stripping plain text
 * that merely contains a bare angle bracket like "<= value" or "<3".
 */
function looksLikeHtml(s: string): boolean {
  return /<[a-zA-Z][^>]*>/.test(s);
}

// ── Retry helper ─────────────────────────────────────────────────────────────

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Wraps `fetch` with bounded exponential back-off for transient failures.
 * Retryable: HTTP 429 / 502 / 503 / 504 and thrown network / timeout errors.
 * Non-retryable: any other 4xx or 2xx — returned immediately without retry.
 *
 * Each attempt receives a **fresh** `AbortSignal.timeout(15_000)` so the
 * timeout resets per attempt rather than draining a shared signal.
 *
 * If a `Retry-After` response header is present (seconds integer or HTTP-date)
 * it is honoured but capped at 10 s to prevent a single mailbox stalling the
 * whole sync. Without it, backoff is 500 ms → 1 000 ms → 2 000 ms.
 *
 * READ-ONLY companion: only used by GET helpers; never issues write verbs.
 */
async function fetchWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  maxRetries = 3,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });

      // Non-retryable (2xx, 4xx other than 429) or exhausted retries — return as-is
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxRetries) {
        return res;
      }

      // Retryable status — honour Retry-After header if present, else backoff
      const retryAfterRaw = res.headers.get("Retry-After");
      let waitMs: number;

      if (retryAfterRaw) {
        const parsed = parseInt(retryAfterRaw, 10);
        if (!Number.isNaN(parsed)) {
          waitMs = parsed * 1_000; // seconds → ms
        } else {
          // HTTP-date format
          waitMs = Math.max(0, new Date(retryAfterRaw).getTime() - Date.now());
        }
        waitMs = Math.min(waitMs, 10_000); // cap at 10 s
      } else {
        waitMs = 500 * 2 ** attempt; // 500 → 1 000 → 2 000 ms
      }

      await new Promise<void>((r) => setTimeout(r, waitMs));
    } catch (err) {
      // Network error or AbortError/TimeoutError
      lastError = err;
      if (attempt === maxRetries) throw err;
      const waitMs = Math.min(500 * 2 ** attempt, 10_000);
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
  }

  // Unreachable — loop always returns or throws before here
  throw lastError ?? new Error("fetchWithRetry: unexpected state");
}

// ── Gmail ────────────────────────────────────────────────────────────────────

/**
 * List recent inbound Gmail messages (GET only).
 * Returns message stubs; call getGmailMessage per id for full content.
 */
export async function listInboundGmail(
  token: string,
  max = 25,
): Promise<{ id: string; threadId: string }[]> {
  const q = encodeURIComponent("newer_than:14d -in:chats -from:me");
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail list error ${res.status}`);
  }
  const data = (await res.json()) as {
    messages?: { id: string; threadId: string }[];
  };
  return (data.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId }));
}

/**
 * Fetch and parse a single Gmail message (GET only).
 * Extracts plain-text body; falls back to snippet. Returns null on parse failure.
 */
export async function getGmailMessage(
  token: string,
  id: string,
): Promise<InboundMessage | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail message error ${res.status}`);
  }

  try {
    const data = (await res.json()) as {
      id: string;
      threadId: string;
      snippet?: string;
      payload?: {
        headers?: { name: string; value: string }[];
        mimeType?: string;
        body?: { data?: string };
        parts?: {
          mimeType?: string;
          body?: { data?: string };
        }[];
      };
    };

    // Case-insensitive header lookup
    const header = (name: string): string => {
      const lc = name.toLowerCase();
      return (
        data.payload?.headers?.find((h) => h.name.toLowerCase() === lc)
          ?.value ?? ""
      );
    };

    const from = header("From");
    const subject = header("Subject");
    const messageId = header("Message-ID") || id;
    const dateHeader = header("Date");
    const parsedDate = dateHeader ? new Date(dateHeader) : null;
    const receivedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

    // Extract body: prefer text/plain; fall back to text/html (strip tags).
    let body = "";
    let bodyIsHtml = false;
    const parts = data.payload?.parts ?? [];

    // Walk parts — pick text/plain first (no stripping needed)
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = Buffer.from(part.body.data, "base64url").toString("utf8");
        break;
      }
    }
    // No plain-text part — look for a text/html part and flag it
    if (!body) {
      for (const part of parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64url").toString("utf8");
          bodyIsHtml = true;
          break;
        }
      }
    }
    // Fall back to top-level body.data (single-part / non-multipart messages)
    if (!body && data.payload?.body?.data) {
      body = Buffer.from(data.payload.body.data, "base64url").toString("utf8");
      if (data.payload.mimeType === "text/html" || looksLikeHtml(body)) {
        bodyIsHtml = true;
      }
    }
    // Strip HTML tags when the chosen body came from an HTML part
    if (bodyIsHtml) {
      body = stripHtml(body);
    }
    // Last resort: snippet (short preview only — full message remains in mailbox)
    if (!body && data.snippet) {
      body = `${data.snippet} […preview; full message in mailbox]`;
    }

    return {
      messageId,
      threadId: data.threadId,
      from,
      subject,
      body,
      receivedAt,
    };
  } catch {
    return null;
  }
}

// ── Microsoft Graph ──────────────────────────────────────────────────────────

/**
 * List recent inbox messages via Microsoft Graph (GET only).
 * Returns message stubs; call getGraphMessage per id for full content.
 */
export async function listInboundGraph(
  token: string,
  max = 25,
): Promise<{ id: string; conversationId: string }[]> {
  const url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
    `?$top=${max}&$select=id,conversationId&$orderby=receivedDateTime desc`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph list error ${res.status}`);
  }
  const data = (await res.json()) as {
    value?: { id: string; conversationId: string }[];
  };
  return (data.value ?? []).map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
  }));
}

/**
 * Fetch and parse a single Microsoft Graph message (GET only).
 * Strips HTML to plain text when body is HTML. Returns null on parse failure.
 */
export async function getGraphMessage(
  token: string,
  id: string,
): Promise<InboundMessage | null> {
  const url =
    `https://graph.microsoft.com/v1.0/me/messages/${id}` +
    `?$select=from,subject,body,conversationId,internetMessageId,receivedDateTime`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph message error ${res.status}`);
  }

  try {
    const data = (await res.json()) as {
      id?: string;
      conversationId?: string;
      internetMessageId?: string;
      receivedDateTime?: string;
      subject?: string;
      from?: { emailAddress?: { address?: string } };
      body?: { contentType?: string; content?: string };
    };

    const from = data.from?.emailAddress?.address ?? "";
    const subject = data.subject ?? "";
    const messageId = data.internetMessageId || id;
    const threadId = data.conversationId ?? "";
    const rdtRaw = data.receivedDateTime;
    const rdtDate = rdtRaw ? new Date(rdtRaw) : null;
    const receivedAt =
      rdtDate && !Number.isNaN(rdtDate.getTime())
        ? rdtDate.toISOString()
        : new Date().toISOString();

    let body = data.body?.content ?? "";
    if (data.body?.contentType !== "text") {
      body = stripHtml(body);
    }

    return { messageId, threadId, from, subject, body, receivedAt };
  } catch {
    return null;
  }
}
