/* ============================================================================
   LinkedIn Voyager request builders (experimental LinkedIn bridge).

   ARIA never calls linkedin.com itself. These request specs are handed to the
   paired Chrome extension, which runs them inside the user's own logged-in
   LinkedIn tab (same browser, same IP, same session as when they browse
   LinkedIn by hand). The extension only accepts the requests listed in
   extensions/linkedin-bridge/allowlist.js.

   Voyager is LinkedIn's undocumented web API: endpoints and GraphQL query ids
   change without notice. The query ids below are fallbacks; the extension
   reports the ids LinkedIn's own web app uses (see CapturedQueries) and those
   win. Protocol facts cross-checked against the open-source mautrix-linkedin
   bridge (2025); no code is copied from it.
   ========================================================================== */

export type BridgeHttpMethod = "GET" | "POST";

export interface LinkedInRequestSpec {
  method: BridgeHttpMethod;
  /** Path and query on https://www.linkedin.com. */
  path: string;
  /** Extra headers. The extension adds the csrf-token header itself. */
  headers: Record<string, string>;
  /** JSON text for POST requests. */
  body?: string;
}

/** A GraphQL query the LinkedIn web app was seen using: its id and variable names. */
export interface CapturedQuery {
  queryId: string;
  variables: string[];
}

/** Captured queries keyed by query name ("messengerConversations", ...). */
export type CapturedQueries = Record<string, CapturedQuery[]>;

export const QUERY_ID_PATTERN = /^(messengerConversations|messengerMessages)\.[0-9a-f]{32}$/;

/** Fallback query ids, used until the extension has seen the live ones. */
export const FALLBACK_QUERIES = {
  conversations: { queryId: "messengerConversations.f0873b936b43ed663997b215b2c28359", variables: ["mailboxUrn"] },
  messages: {
    queryId: "messengerMessages.4088d03bc70c91c3fa68965cb42336de",
    variables: ["deliveredAt", "conversationUrn", "countBefore", "countAfter"],
  },
} as const satisfies Record<string, CapturedQuery>;

/** Messages fetched per conversation refresh. */
export const MESSAGES_PER_FETCH = 40;

const GRAPHQL_PATH = "/voyager/api/voyagerMessagingGraphQL/graphql";
const GRAPHQL_HEADERS = { accept: "application/graphql", "x-restli-protocol-version": "2.0.0" };

/** A LinkedIn profile id (the ACoAA... part of urn:li:fsd_profile:ACoAA...). */
const MEMBER_ID = /^[A-Za-z0-9_-]{1,120}$/;
const PROFILE_URN = /urn:li:(?:fsd_profile|fs_miniProfile|fs_profile):([A-Za-z0-9_-]{1,120})/;
const CONVERSATION_URN = /^urn:li:msg_conversation:\(urn:li:fsd_profile:[A-Za-z0-9_-]{1,120},[A-Za-z0-9+/=_-]{1,200}\)$/;

export function isMemberId(value: unknown): value is string {
  return typeof value === "string" && MEMBER_ID.test(value);
}

/** The profile id inside any profile-like URN, including participant URNs. */
export function memberIdFromUrn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return PROFILE_URN.exec(value)?.[1] ?? null;
}

export function fsdProfileUrn(memberId: string): string {
  if (!isMemberId(memberId)) throw new Error("invalid LinkedIn member id");
  return `urn:li:fsd_profile:${memberId}`;
}

export function isConversationUrn(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_URN.test(value);
}

/**
 * The public id of a LinkedIn profile URL ("jane-doe" in
 * https://www.linkedin.com/in/jane-doe/), or null when the input is not one.
 */
export function publicIdFromProfileUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const match = /^\/in\/([^/?#]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return /^[\p{L}\p{N}_.-]{3,100}$/u.test(id) ? id : null;
}

/** Rest.li value encoding: encodeURIComponent plus the characters it leaves alone. */
export function restliEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function graphqlRequest(queryId: string, variables: [string, string][]): LinkedInRequestSpec {
  const vars = variables.map(([key, value]) => `${key}:${value}`).join(",");
  return { method: "GET", path: `${GRAPHQL_PATH}?queryId=${queryId}&variables=(${vars})`, headers: { ...GRAPHQL_HEADERS } };
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

function capturedFor(captured: CapturedQueries | null | undefined, name: string): CapturedQuery[] {
  const list = captured?.[name];
  return Array.isArray(list) ? list.filter((q) => QUERY_ID_PATTERN.test(q.queryId) && Array.isArray(q.variables)) : [];
}

export function buildMeRequest(): LinkedInRequestSpec {
  return { method: "GET", path: "/voyager/api/me", headers: { accept: "application/json" } };
}

/** The most recent conversations of the user's inbox (one page). */
export function buildConversationsRequest(selfMemberId: string, captured?: CapturedQueries | null): LinkedInRequestSpec {
  const mailboxUrn = restliEncode(fsdProfileUrn(selfMemberId));
  const live = capturedFor(captured, "messengerConversations").find((q) => sameNames(q.variables, ["mailboxUrn"]));
  return graphqlRequest((live ?? FALLBACK_QUERIES.conversations).queryId, [["mailboxUrn", mailboxUrn]]);
}

/** The latest messages of one conversation. */
export function buildMessagesRequest(
  conversationUrn: string,
  captured?: CapturedQueries | null,
  now: number = Date.now(),
): LinkedInRequestSpec {
  if (!isConversationUrn(conversationUrn)) throw new Error("invalid conversation URN");
  const values: Record<string, string> = {
    conversationUrn: restliEncode(conversationUrn),
    deliveredAt: String(Math.floor(now)),
    countBefore: String(MESSAGES_PER_FETCH),
    countAfter: "0",
  };
  const candidates = [...capturedFor(captured, "messengerMessages"), FALLBACK_QUERIES.messages];
  // Only templates whose every variable we know how to fill; a bare
  // (conversationUrn) template returns the latest page, as the web app does.
  const query =
    candidates.find((q) => sameNames(q.variables, ["conversationUrn"])) ??
    candidates.find((q) => sameNames(q.variables, FALLBACK_QUERIES.messages.variables))!;
  return graphqlRequest(
    query.queryId,
    query.variables.map((name) => [name, values[name]]),
  );
}

/** Resolve a public profile id (jane-doe) to the profile URN messaging needs. */
export function buildProfileLookupRequest(publicId: string): LinkedInRequestSpec {
  return {
    method: "GET",
    path: `/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${restliEncode(publicId)}`,
    headers: { accept: "application/vnd.linkedin.normalized+json+2.1" },
  };
}

export interface SendMessageInput {
  selfMemberId: string;
  text: string;
  /** Reply in an existing conversation... */
  conversationUrn?: string | null;
  /** ...or open a new one with this member. */
  recipientMemberId?: string | null;
  /** Client-generated UUID; ARIA uses the outbox item id. */
  originToken: string;
  /** 16 random characters, as the LinkedIn web client sends. */
  trackingId: string;
}

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
    path: "/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",
    headers: {
      accept: "application/json",
      "content-type": "text/plain;charset=UTF-8",
      "x-restli-protocol-version": "2.0.0",
    },
    body: JSON.stringify(payload),
  };
}

const QUERY_NAMES = ["messengerConversations", "messengerMessages"] as const;
const MAX_QUERIES_PER_NAME = 6;

/** Merge query ids reported by the extension: newest first, bounded, validated. */
export function mergeCapturedQueries(known: CapturedQueries | null, reported: unknown): CapturedQueries {
  const out: CapturedQueries = {};
  for (const name of QUERY_NAMES) {
    const incoming =
      reported && typeof reported === "object" && Array.isArray((reported as Record<string, unknown>)[name])
        ? ((reported as Record<string, unknown>)[name] as unknown[])
        : [];
    const merged: CapturedQuery[] = [];
    for (const raw of [...incoming, ...(known?.[name] ?? [])]) {
      if (!raw || typeof raw !== "object") continue;
      const { queryId, variables } = raw as { queryId?: unknown; variables?: unknown };
      if (typeof queryId !== "string" || !QUERY_ID_PATTERN.test(queryId) || !queryId.startsWith(`${name}.`)) continue;
      if (!Array.isArray(variables) || variables.length > 8) continue;
      if (!variables.every((v) => typeof v === "string" && /^[A-Za-z]{1,40}$/.test(v))) continue;
      const key = `${queryId}|${[...variables].sort().join(",")}`;
      if (merged.some((q) => `${q.queryId}|${[...q.variables].sort().join(",")}` === key)) continue;
      merged.push({ queryId, variables: [...variables] as string[] });
      if (merged.length >= MAX_QUERIES_PER_NAME) break;
    }
    if (merged.length) out[name] = merged;
  }
  return out;
}
