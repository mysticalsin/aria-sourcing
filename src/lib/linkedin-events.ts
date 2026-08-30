/**
 * HeyReach-parity LinkedIn channel event taxonomy (pure helpers).
 * Spec: docs/LINKEDIN_HEYREACH_PARITY.md
 */

export const LINKEDIN_EVENT_TYPES = [
  "reply",
  "connection_accepted",
  "connection_rejected",
  "invite_sent",
  "message_sent",
  "message_delivered",
  "message_seen",
  "message_failed",
] as const;

export type LinkedInEventType = (typeof LINKEDIN_EVENT_TYPES)[number];

export function isLinkedInEventType(value: unknown): value is LinkedInEventType {
  return typeof value === "string" && (LINKEDIN_EVENT_TYPES as readonly string[]).includes(value);
}

/** Events that create messages_inbound rows + enqueue classify. */
export function isReplyLikeEvent(eventType: LinkedInEventType): boolean {
  return eventType === "reply";
}

export type LinkedInWebhookEnvelope = {
  schemaVersion: "2026-08-25.li-events.v1";
  routeKey: string;
  eventId: string;
  eventType: LinkedInEventType;
  occurredAt?: string;
  seatId?: string;
  profileUrl: string;
  candidateId?: string;
  providerThreadKey?: string;
  providerMessageId?: string;
  body: string;
  errorCode?: string;
  ariaAttemptId?: string;
  payload?: Record<string, unknown>;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Normalize vendor webhook body (v1 multi-event OR legacy reply-only).
 * Always requires routeKey for tenant resolution.
 */
export function normalizeLinkedInWebhookBody(body: unknown): LinkedInWebhookEnvelope | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body_must_be_object" };
  }
  const raw = body as Record<string, unknown>;
  const routeKey = asTrimmedString(raw.routeKey);
  if (!routeKey || routeKey.length < 16) return { error: "route_key_required" };

  const candidate = asObject(raw.candidate);
  const thread = asObject(raw.thread);
  const outbound = asObject(raw.outbound);
  const nestedPayload = asObject(raw.payload);

  const hasEventType =
    typeof raw.eventType === "string" ||
    raw.schemaVersion === "2026-08-25.li-events.v1" ||
    typeof raw.event_type === "string";

  if (hasEventType) {
    const eventTypeRaw = asTrimmedString(raw.eventType) || asTrimmedString(raw.event_type);
    if (!isLinkedInEventType(eventTypeRaw)) return { error: "invalid_event_type" };

    const eventId =
      asTrimmedString(raw.eventId) ||
      asTrimmedString(raw.event_id) ||
      asTrimmedString(raw.vendor_event_id) ||
      asTrimmedString(raw.providerId);
    if (!eventId) return { error: "event_id_required" };

    const profileUrl =
      asTrimmedString(raw.profileUrl) ||
      asTrimmedString(raw.fromProfileUrl) ||
      asTrimmedString(raw.profile_url) ||
      asTrimmedString(candidate?.profileUrl) ||
      asTrimmedString(candidate?.profile_url);
    if (!profileUrl) return { error: "profile_url_required" };

    const bodyText =
      asTrimmedString(raw.body) ||
      asTrimmedString(raw.message_text) ||
      asTrimmedString(nestedPayload?.body) ||
      "";

    if (isReplyLikeEvent(eventTypeRaw) && !bodyText) {
      return { error: "body_required_for_reply" };
    }

    return {
      schemaVersion: "2026-08-25.li-events.v1",
      routeKey,
      eventId,
      eventType: eventTypeRaw,
      occurredAt:
        asTrimmedString(raw.occurredAt) ||
        asTrimmedString(raw.occurred_at) ||
        undefined,
      seatId: asTrimmedString(raw.seatId) || asTrimmedString(raw.seat_id) || undefined,
      profileUrl,
      candidateId:
        asTrimmedString(raw.candidateId) ||
        asTrimmedString(raw.candidate_id) ||
        asTrimmedString(candidate?.id) ||
        undefined,
      providerThreadKey:
        asTrimmedString(raw.providerThreadKey) ||
        asTrimmedString(thread?.providerThreadKey) ||
        undefined,
      providerMessageId:
        asTrimmedString(raw.providerMessageId) ||
        asTrimmedString(raw.providerId) ||
        asTrimmedString(thread?.providerMessageId) ||
        undefined,
      body: bodyText,
      errorCode:
        asTrimmedString(raw.errorCode) ||
        asTrimmedString(nestedPayload?.errorCode) ||
        undefined,
      ariaAttemptId:
        asTrimmedString(raw.ariaAttemptId) ||
        asTrimmedString(outbound?.ariaAttemptId) ||
        undefined,
      payload: nestedPayload ?? undefined,
    };
  }

  // Legacy reply-only: routeKey + providerId + fromProfileUrl + body
  const eventId = asTrimmedString(raw.providerId) || asTrimmedString(raw.vendor_event_id);
  const profileUrl = asTrimmedString(raw.fromProfileUrl) || asTrimmedString(raw.profile_url);
  const bodyText = typeof raw.body === "string" ? raw.body : asTrimmedString(raw.message_text);
  if (!eventId) return { error: "event_id_required" };
  if (!profileUrl) return { error: "profile_url_required" };
  if (!bodyText.trim()) return { error: "body_required_for_reply" };

  return {
    schemaVersion: "2026-08-25.li-events.v1",
    routeKey,
    eventId,
    eventType: "reply",
    occurredAt: asTrimmedString(raw.occurredAt) || asTrimmedString(raw.occurred_at) || undefined,
    seatId: asTrimmedString(raw.seatId) || undefined,
    profileUrl,
    body: bodyText,
    providerMessageId: eventId,
  };
}

export type RecordLinkedInChannelEventResult = {
  ok?: boolean;
  duplicate?: boolean;
  event_row_id?: string;
  inbound_id?: string | null;
  conversation_id?: string | null;
  candidate_id?: string | null;
  event_type?: string;
  correlated?: boolean;
  reason?: string;
};

/** Decide whether classify should run after a channel-event record. */
export function shouldEnqueueClassifyFromRecord(
  result: RecordLinkedInChannelEventResult | null | undefined,
): boolean {
  if (!result?.ok || result.duplicate) return false;
  if (result.event_type !== "reply") return false;
  const inboundId = typeof result.inbound_id === "string" ? result.inbound_id.trim() : "";
  return Boolean(inboundId);
}

export function linkedInEventLabel(eventType: LinkedInEventType): string {
  switch (eventType) {
    case "reply":
      return "Candidate reply";
    case "connection_accepted":
      return "Connection accepted";
    case "connection_rejected":
      return "Connection rejected";
    case "invite_sent":
      return "Invite sent";
    case "message_sent":
      return "Message sent";
    case "message_delivered":
      return "Message delivered";
    case "message_seen":
      return "Message seen";
    case "message_failed":
      return "Message failed";
    default:
      return eventType;
  }
}
