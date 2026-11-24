/* ============================================================================
   Parsers for LinkedIn Voyager responses (experimental LinkedIn bridge).

   Voyager answers in two shapes: nested JSON (GraphQL with
   accept: application/graphql) and "normalized" JSON, where entities sit in an
   `included` array and fields point at them with "*field": "urn:...". Rather
   than hard-code one schema that LinkedIn changes at will, the parsers index
   every object carrying an `entityUrn`, resolve "*field" references through
   that index, and pick conversations and messages by their URN type.
   ========================================================================== */

import { isConversationUrn, memberIdFromUrn } from "./voyager";

type Obj = Record<string, unknown>;

export interface LinkedInIdentity {
  memberId: string;
  firstName: string;
  lastName: string;
  publicIdentifier: string | null;
  headline: string | null;
}

export interface ParsedParticipant {
  memberId: string | null;
  name: string;
  profileUrl: string | null;
  headline: string | null;
}

export interface ParsedMessage {
  urn: string;
  conversationUrn: string;
  senderMemberId: string | null;
  senderName: string;
  direction: "inbound" | "outbound";
  body: string;
  /** Unix milliseconds. */
  sentAt: number;
}

export interface ParsedConversation {
  urn: string;
  title: string | null;
  /** Unix milliseconds, or null when LinkedIn did not say. */
  lastActivityAt: number | null;
  unread: boolean;
  groupChat: boolean;
  /** Everyone except the mailbox owner. */
  participants: ParsedParticipant[];
  /** The latest message(s) LinkedIn embeds in the conversation list. */
  messages: ParsedMessage[];
}

const MAX_DEPTH = 64;
const MAX_TEXT = 20_000;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A plain string or LinkedIn's AttributedText / TextViewModel ({ text }). */
function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isObj(value) && typeof value.text === "string") return value.text;
  return null;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Every object with an `entityUrn`, merged by URN, plus "*field" resolution. */
class EntityIndex {
  private readonly byUrn = new Map<string, Obj>();

  constructor(root: unknown) {
    this.walk(root, 0);
  }

  private walk(value: unknown, depth: number): void {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      for (const item of value) this.walk(item, depth + 1);
      return;
    }
    if (!isObj(value)) return;
    const urn = nonEmpty(value.entityUrn);
    if (urn) {
      const known = this.byUrn.get(urn);
      // Keep the richer copy's fields: nested stubs ({ entityUrn } only) must
      // not erase a full entity seen elsewhere in the payload.
      this.byUrn.set(urn, known ? { ...value, ...known, ...pickDefined(value, known) } : value);
    }
    for (const child of Object.values(value)) this.walk(child, depth + 1);
  }

  get(urn: string): Obj | undefined {
    return this.byUrn.get(urn);
  }

  entitiesOfType(prefix: string): Obj[] {
    return [...this.byUrn.entries()].filter(([urn]) => urn.startsWith(prefix)).map(([, entity]) => entity);
  }

  /** obj[key], or the entity (or entities) obj["*key"] points at. */
  field(obj: unknown, key: string): unknown {
    if (!isObj(obj)) return undefined;
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    const ref = obj[`*${key}`];
    if (typeof ref === "string") return this.byUrn.get(ref) ?? ref;
    if (Array.isArray(ref)) return ref.map((r) => (typeof r === "string" ? (this.byUrn.get(r) ?? r) : r));
    return undefined;
  }
}

/** Fields of `incoming` that are set and not already set in `known`. */
function pickDefined(incoming: Obj, known: Obj): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null && (known[key] === undefined || known[key] === null)) out[key] = value;
  }
  return out;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObj(value) && Array.isArray(value.elements)) return value.elements;
  return [];
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function participantOf(index: EntityIndex, raw: unknown): ParsedParticipant | null {
  const entity = typeof raw === "string" ? (index.get(raw) ?? { entityUrn: raw }) : raw;
  if (!isObj(entity)) return null;
  const memberId =
    memberIdFromUrn(entity.hostIdentityUrn) ?? memberIdFromUrn(entity.entityUrn) ?? memberIdFromUrn(entity.backendUrn);
  const type = index.field(entity, "participantType");
  const member = isObj(type) ? index.field(type, "member") : undefined;
  const organization = isObj(type) ? index.field(type, "organization") : undefined;
  if (isObj(member)) {
    const name = [textOf(member.firstName), textOf(member.lastName)].filter(Boolean).join(" ").trim();
    return {
      memberId,
      name: name || "LinkedIn member",
      profileUrl: nonEmpty(member.profileUrl),
      headline: nonEmpty(textOf(member.headline)),
    };
  }
  if (isObj(organization)) {
    return {
      memberId,
      name: nonEmpty(textOf(organization.name)) ?? "LinkedIn page",
      profileUrl: nonEmpty(organization.pageUrl),
      headline: null,
    };
  }
  return memberId ? { memberId, name: "LinkedIn member", profileUrl: null, headline: null } : null;
}

/** What to show for a message with no text: attachments, recalls. */
function describeBody(index: EntityIndex, message: Obj): string {
  const text = textOf(index.field(message, "body"));
  if (message.messageBodyRenderFormat === "RECALLED") return "[message deleted]";
  if (text && text.trim()) return clip(text);
  const parts: string[] = [];
  for (const content of asList(index.field(message, "renderContent"))) {
    if (!isObj(content)) continue;
    const file = content.file;
    if (isObj(file)) parts.push(`[file: ${nonEmpty(file.name) ?? "attachment"}]`);
    else if (content.vectorImage) parts.push("[image]");
    else if (content.video) parts.push("[video]");
    else if (content.audio) parts.push("[voice message]");
    else if (content.externalMedia) parts.push("[GIF]");
    else if (content.forwardedMessageContent) parts.push("[forwarded message]");
    else if (content.hostUrnData) parts.push("[shared post]");
    else if (content.repliedMessageContent) continue;
    else parts.push("[attachment]");
  }
  return parts.join(" ") || "";
}

function conversationUrnOf(index: EntityIndex, message: Obj): string | null {
  const conversation = index.field(message, "conversation");
  const candidates = [
    isObj(conversation) ? conversation.entityUrn : conversation,
    message.conversationUrn,
  ];
  return (candidates.find((c) => isConversationUrn(c)) as string | undefined) ?? null;
}

function messageOf(
  index: EntityIndex,
  raw: unknown,
  selfMemberId: string,
  fallbackConversationUrn: string | null,
): ParsedMessage | null {
  const message = typeof raw === "string" ? index.get(raw) : raw;
  if (!isObj(message)) return null;
  const urn = nonEmpty(message.entityUrn);
  if (!urn || !urn.startsWith("urn:li:msg_message:")) return null;
  const sentAt = timestamp(message.deliveredAt) ?? timestamp(message.createdAt);
  const conversationUrn = conversationUrnOf(index, message) ?? fallbackConversationUrn;
  if (sentAt === null || !conversationUrn) return null;
  const sender = participantOf(index, index.field(message, "sender"));
  const body = describeBody(index, message);
  return {
    urn,
    conversationUrn,
    senderMemberId: sender?.memberId ?? null,
    senderName: sender?.name ?? "LinkedIn member",
    direction: sender?.memberId && sender.memberId === selfMemberId ? "outbound" : "inbound",
    body,
    sentAt,
  };
}

function byTime(a: ParsedMessage, b: ParsedMessage): number {
  return a.sentAt - b.sentAt;
}

/** The logged-in member, from GET /voyager/api/me (plain or normalized JSON). */
export function parseIdentity(json: unknown): LinkedInIdentity | null {
  const index = new EntityIndex(json);
  const root = isObj(json) && isObj(json.data) ? json.data : json;
  let mini = index.field(root, "miniProfile");
  if (!isObj(mini)) mini = index.entitiesOfType("urn:li:fs_miniProfile:")[0];
  if (!isObj(mini)) return null;
  const memberId = memberIdFromUrn(mini.dashEntityUrn) ?? memberIdFromUrn(mini.entityUrn);
  if (!memberId) return null;
  return {
    memberId,
    firstName: nonEmpty(mini.firstName) ?? "",
    lastName: nonEmpty(mini.lastName) ?? "",
    publicIdentifier: nonEmpty(mini.publicIdentifier),
    headline: nonEmpty(mini.occupation),
  };
}

/** One page of the inbox (messengerConversations query). */
export function parseConversations(json: unknown, selfMemberId: string): ParsedConversation[] {
  const index = new EntityIndex(json);
  const out: ParsedConversation[] = [];
  for (const conversation of index.entitiesOfType("urn:li:msg_conversation:")) {
    const urn = conversation.entityUrn as string;
    if (!isConversationUrn(urn)) continue;
    const rawParticipants = asList(index.field(conversation, "conversationParticipants"));
    const lastActivityAt = timestamp(conversation.lastActivityAt);
    // Messages reference their conversation with a stub; only real
    // conversation entities carry participants or an activity time.
    if (!rawParticipants.length && lastActivityAt === null) continue;
    const participants = rawParticipants
      .map((p) => participantOf(index, p))
      .filter((p): p is ParsedParticipant => p !== null && p.memberId !== selfMemberId);
    const messages = asList(index.field(conversation, "messages"))
      .map((m) => messageOf(index, m, selfMemberId, urn))
      .filter((m): m is ParsedMessage => m !== null)
      .sort(byTime);
    const unreadCount = timestamp(conversation.unreadCount) ?? 0;
    out.push({
      urn,
      title: nonEmpty(textOf(conversation.title)),
      lastActivityAt,
      unread: conversation.read === false || unreadCount > 0,
      groupChat: conversation.groupChat === true,
      participants,
      messages,
    });
  }
  return out.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
}

/** One conversation's messages (messengerMessages query), oldest first. */
export function parseMessages(json: unknown, selfMemberId: string, conversationUrn: string): ParsedMessage[] {
  const index = new EntityIndex(json);
  const seen = new Set<string>();
  return index
    .entitiesOfType("urn:li:msg_message:")
    .map((m) => messageOf(index, m, selfMemberId, conversationUrn))
    .filter((m): m is ParsedMessage => m !== null && m.conversationUrn === conversationUrn)
    .filter((m) => (seen.has(m.urn) ? false : (seen.add(m.urn), true)))
    .sort(byTime);
}

export interface ParsedSendResult {
  messageUrn: string | null;
  conversationUrn: string | null;
  sentAt: number | null;
}

/** The createMessage answer ({ value: Message }). Every field is best effort. */
export function parseSendResult(json: unknown, rawText: string): ParsedSendResult {
  const index = new EntityIndex(json);
  const message = index.entitiesOfType("urn:li:msg_message:")[0];
  let conversationUrn = message ? conversationUrnOf(index, message) : null;
  if (!conversationUrn) {
    const match = /urn:li:msg_conversation:\(urn:li:fsd_profile:[A-Za-z0-9_-]+,[A-Za-z0-9+/=_-]+\)/.exec(rawText);
    conversationUrn = match ? match[0] : null;
  }
  return {
    messageUrn: message ? (nonEmpty(message.entityUrn) ?? null) : null,
    conversationUrn,
    sentAt: message ? (timestamp(message.deliveredAt) ?? null) : null,
  };
}

export type Relationship = "connected" | "pending" | "none" | "unknown";

export interface ProfileCard {
  memberId: string;
  publicIdentifier: string | null;
  name: string;
  headline: string | null;
  /** "unknown" when LinkedIn sent no MemberRelationship (undecorated answer). */
  relationship: Relationship;
}

function relationshipOf(index: EntityIndex, memberId: string): Relationship {
  const entity = index.get(`urn:li:fsd_memberRelationship:${memberId}`);
  if (!entity) return "unknown";
  const union = index.field(entity, "memberRelationshipUnion");
  if (isObj(union) && index.field(union, "connection")) return "connected";
  const none = isObj(union) ? index.field(union, "noConnection") : undefined;
  if (isObj(none) && none.memberDistance === "DISTANCE_1") return "connected";
  const invitationUnion = isObj(none) ? index.field(none, "invitationUnion") : undefined;
  const data = index.field(entity, "memberRelationshipData");
  if ((isObj(invitationUnion) && index.field(invitationUnion, "invitation")) || (isObj(data) && index.field(data, "invitation"))) {
    return "pending";
  }
  if (isObj(invitationUnion) && "noInvitation" in invitationUnion) return "none";
  return isObj(union) ? "none" : "unknown";
}

/**
 * A profile read (identity/dash/profiles?q=memberIdentity, top-card
 * decoration). The answer also holds the signed-in member's own profile, so
 * the subject is taken from data["*elements"], else by public id.
 */
export function parseProfileCard(json: unknown, identity: string): ProfileCard | null {
  const index = new EntityIndex(json);
  const root = isObj(json) && isObj(json.data) ? json.data : json;
  const listed = isObj(root) ? [...asList(index.field(root, "elements")), ...asList(root["*elements"])] : [];
  const subjectUrn = listed
    .map((item) => (typeof item === "string" ? item : isObj(item) ? item.entityUrn : null))
    .find((urn): urn is string => typeof urn === "string" && urn.startsWith("urn:li:fsd_profile:"));
  const profiles = index.entitiesOfType("urn:li:fsd_profile:");
  const wanted = identity.toLowerCase();
  const subject =
    (subjectUrn ? index.get(subjectUrn) ?? { entityUrn: subjectUrn } : undefined) ??
    profiles.find((p) => typeof p.publicIdentifier === "string" && p.publicIdentifier.toLowerCase() === wanted) ??
    profiles.find((p) => memberIdFromUrn(p.entityUrn) === identity) ??
    (profiles.length === 1 ? profiles[0] : undefined);
  const memberId = subject ? memberIdFromUrn(subject.entityUrn) : null;
  if (!subject || !memberId) return null;
  const name = [nonEmpty(subject.firstName), nonEmpty(subject.lastName)].filter(Boolean).join(" ");
  return {
    memberId,
    publicIdentifier: nonEmpty(subject.publicIdentifier),
    name: name || identity,
    headline: nonEmpty(textOf(subject.headline)),
    relationship: relationshipOf(index, memberId),
  };
}

/** The profile URN behind a public id. */
export function parseProfileLookup(json: unknown, publicId: string): { memberId: string; name: string } | null {
  const card = parseProfileCard(json, publicId);
  return card ? { memberId: card.memberId, name: card.name } : null;
}

export type InvitationOutcome =
  | { kind: "sent"; invitationUrn: string | null }
  /** LinkedIn says an invitation is already pending (CANT_RESEND_YET...). */
  | { kind: "already_pending"; detail: string }
  | { kind: "already_connected"; detail: string }
  | { kind: "quota"; detail: string }
  | { kind: "refused"; detail: string };

function classifyInvitationRefusal(code: string, message: string): InvitationOutcome {
  const text = `${code} ${message}`.trim();
  const detail = text ? `LinkedIn: ${text}`.slice(0, 300) : "LinkedIn refused the invitation.";
  if (/CANT_RESEND|ALREADY_INVITED|already (?:been )?invited|pending/i.test(text)) return { kind: "already_pending", detail };
  if (/ALREADY_CONNECTED|already connected|FIRST_DEGREE/i.test(text)) return { kind: "already_connected", detail };
  if (/QUOTA|LIMIT|too many|weekly/i.test(text)) return { kind: "quota", detail };
  return { kind: "refused", detail };
}

/**
 * The verifyQuotaAndCreateV2 answer. Success carries data.value["*invitation"];
 * LinkedIn may also refuse with HTTP 200 and data.code/message, or with an
 * HTTP error whose body names the reason.
 */
export function parseInvitationResult(status: number, body: string): InvitationOutcome {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const root = isObj(json) && isObj(json.data) ? json.data : isObj(json) ? json : {};
  const code = String((root as Obj).code ?? (root as Obj).serviceErrorCode ?? "");
  const message = String((root as Obj).message ?? "");
  if (status >= 200 && status < 300) {
    const value = (root as Obj).value;
    const urn = isObj(value) ? (value["*invitation"] ?? value.invitationUrn ?? value.entityUrn) : undefined;
    if (typeof urn === "string") return { kind: "sent", invitationUrn: urn };
    if (code || message) return classifyInvitationRefusal(code, message);
    return { kind: "sent", invitationUrn: null };
  }
  return classifyInvitationRefusal(code || (/[A-Z_]{8,}/.exec(body)?.[0] ?? ""), message || `HTTP ${status}`);
}

/** A message LinkedIn refused because the recipient is not a 1st-degree connection. */
export function isNotConnectedRefusal(status: number, body: string): boolean {
  return status === 422 && /NOT_FIRST_DEGREE|FIRST_DEGREE_CONNECTION/i.test(body);
}
