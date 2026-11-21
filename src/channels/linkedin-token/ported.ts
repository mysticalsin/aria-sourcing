/**
 * Port of the existing LinkedIn session-token send.
 *
 * Source, branch mbe-branch / mbe-ngrok / mbe-test, commit
 * e3fa3f594a6d86aec31d42a65414a96be4c8400e:
 * - src/lib/linkedin-bridge/voyager.ts buildSendMessageRequest
 * - extensions/linkedin-bridge/background.js fetchInPage (csrf-token header)
 * - src/lib/linkedin-bridge/policy.ts sendSlot
 * - src/lib/linkedin-bridge/outcome.ts classifyAnswer
 * - supabase/migrations/0006_linkedin_bridge.sql outbox states
 *
 * The Chrome extension ran the request inside the user's LinkedIn tab and
 * kept the session cookie in the browser. This port keeps the request shape
 * and the csrf header, and attaches the session value the user supplied.
 * It does not open a browser, scrape, or log in.
 */

const MEMBER_ID = /^[A-Za-z0-9_-]{1,120}$/;
const CONVERSATION_URN = /^urn:li:msg_conversation:\(urn:li:fsd_profile:[A-Za-z0-9_-]{1,120},[A-Za-z0-9+/=_-]{1,200}\)$/;

export const CREATE_MESSAGE_PATH = "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage";

export interface LinkedInRequestSpec {
  method: "POST";
  path: string;
  headers: Record<string, string>;
  body: string;
}

function isMemberId(value: string): boolean {
  return MEMBER_ID.test(value);
}

function fsdProfileUrn(memberId: string): string {
  if (!isMemberId(memberId)) throw new Error("invalid LinkedIn member id");
  return `urn:li:fsd_profile:${memberId}`;
}

function isConversationUrn(value: string): boolean {
  return CONVERSATION_URN.test(value);
}

export interface SendMessageInput {
  selfMemberId: string;
  text: string;
  conversationUrn?: string | null;
  recipientMemberId?: string | null;
  originToken: string;
  trackingId: string;
}

/** Ported from voyager.ts buildSendMessageRequest. */
export function buildSendMessageRequest(input: SendMessageInput): LinkedInRequestSpec {
  const text = input.text;
  if (!text.trim()) throw new Error("empty message");
  const conversationUrn = input.conversationUrn ?? null;
  const recipient = input.recipientMemberId ?? null;
  if ((conversationUrn === null) === (recipient === null)) {
    throw new Error("a message needs exactly one of conversationUrn or recipientMemberId");
  }
  if (conversationUrn !== null && !isConversationUrn(conversationUrn)) throw new Error("invalid conversation URN");
  const message: Record<string, unknown> = {
    body: { attributes: [], text },
    renderContentUnions: [],
    originToken: input.originToken,
  };
  if (conversationUrn) message.conversationUrn = conversationUrn;
  const payload: Record<string, unknown> = {
    message,
    mailboxUrn: fsdProfileUrn(input.selfMemberId),
    trackingId: input.trackingId,
    dedupeByClientGeneratedToken: false,
  };
  if (recipient) payload.hostRecipientUrns = [fsdProfileUrn(recipient)];
  return {
    method: "POST",
    path: CREATE_MESSAGE_PATH,
    headers: {
      accept: "application/json",
      "content-type": "text/plain;charset=UTF-8",
      "x-restli-protocol-version": "2.0.0",
    },
    body: JSON.stringify(payload),
  };
}

export type SendSlot =
  | { allowed: true }
  | { allowed: false; reason: "daily_cap" | "min_interval" };

/** Ported from policy.ts sendSlot. Fixed gap, no jitter. */
export function sendSlot(input: {
  now: number;
  recentSends: number[];
  dailySendCap: number;
  minSendIntervalMs: number;
}): SendSlot {
  const dayAgo = input.now - 24 * 60 * 60 * 1000;
  const recent = input.recentSends.filter((t) => t > dayAgo).sort((a, b) => a - b);
  if (recent.length >= input.dailySendCap) return { allowed: false, reason: "daily_cap" };
  const last = recent[recent.length - 1];
  if (last !== undefined && input.now - last < input.minSendIntervalMs) {
    return { allowed: false, reason: "min_interval" };
  }
  return { allowed: true };
}

export type AnswerKind = "ok" | "session" | "throttled" | "challenge" | "warning" | "error";

/** Ported from outcome.ts classifyAnswer, plus an explicit account-warning body. */
export function classifyAnswer(input: { status: number; body: string; finalUrl?: string | null }): AnswerKind {
  const finalUrl = input.finalUrl ?? "";
  if (finalUrl && /checkpoint|authwall|uas\/login|\/login/i.test(finalUrl)) return "challenge";
  if (input.status >= 300 && input.status < 400) return "challenge";
  if (input.status === 401 || input.status === 403) return "session";
  if (input.status === 429 || input.status === 999) return "throttled";
  if (input.status < 200 || input.status >= 300) return "error";
  if (/^\s*</.test(input.body)) return "challenge";
  try {
    const parsed = JSON.parse(input.body) as { accountWarning?: boolean; code?: string; message?: string };
    const code = (parsed.code ?? "").toLowerCase();
    const message = (parsed.message ?? "").toLowerCase();
    if (parsed.accountWarning || code === "account_warning" || code === "sender_restricted") return "warning";
    if (message.includes("account warning") || message.includes("challenge")) return "warning";
  } catch {
    return "error";
  }
  return "ok";
}
