// Experimental LinkedIn bridge: the extension posts LinkedIn's raw answer to a
// task. ARIA parses it here, so a LinkedIn format change is fixed server-side
// without reinstalling the extension. Every reference the extension echoes
// (conversation URN, outbox id, contact id) is re-checked against the paired
// account.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { BRIDGE_OPS } from "@/lib/linkedin-bridge/planner";
import { readBridgePolicy } from "@/lib/linkedin-bridge/policy";
import { classifyAnswer, graphqlErrors, type LinkedInAnswer } from "@/lib/linkedin-bridge/outcome";
import {
  isNotConnectedRefusal,
  parseConversations,
  parseIdentity,
  parseInvitationResult,
  parseMessages,
  parseProfileCard,
  parseSendResult,
  type ProfileCard,
} from "@/lib/linkedin-bridge/parse";
import { isConversationUrn } from "@/lib/linkedin-bridge/voyager";
import {
  candidateMembers,
  contactById,
  conversationByUrn,
  ensureConversation,
  linkCandidateConversations,
  okJson,
  outboxItem,
  requireBridgeExtension,
  serverError,
  storeConversations,
  storeMessages,
  transitionOutbox,
  updateAccount,
  updateContact,
  type BridgeAccount,
  type ContactRow,
  type OutboxRow,
  type Svc,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 3_500_000;

const ResultSchema = z.object({
  taskId: z.string().min(1).max(500),
  op: z.enum(BRIDGE_OPS),
  ref: z.string().max(500).nullable(),
  status: z.number().int().min(0).max(999),
  body: z.string().max(MAX_BODY_CHARS),
  finalUrl: z.string().max(2000).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});
type TaskResult = z.infer<typeof ResultSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Errors that concern the whole session pause the bridge; others stay local. */
async function recordAccountError(svc: Svc, account: BridgeAccount, answer: LinkedInAnswer, now: Date): Promise<void> {
  if (answer.kind === "ok") return;
  const policy = readBridgePolicy();
  const patch: Record<string, unknown> = { last_error: answer.detail, last_error_at: now.toISOString() };
  if (answer.kind === "session") {
    // Re-check who is signed in before anything else: the browser may now
    // hold a different LinkedIn account.
    patch.identity_checked_at = null;
    patch.backoff_until = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  } else if (answer.kind === "throttled" || answer.kind === "challenge") {
    patch.backoff_until = new Date(now.getTime() + policy.backoffMs).toISOString();
  }
  await updateAccount(svc, account.id, patch);
}

async function handleIdentity(svc: Svc, account: BridgeAccount, answer: LinkedInAnswer, now: Date) {
  if (answer.kind !== "ok") return recordAccountError(svc, account, answer, now);
  const identity = parseIdentity(answer.json);
  if (!identity) {
    return updateAccount(svc, account.id, {
      last_error: "Could not read the signed-in LinkedIn profile.",
      last_error_at: now.toISOString(),
    });
  }
  if (account.member_id && account.member_id !== identity.memberId) {
    // Never mix two people's inboxes under one pairing.
    return updateAccount(svc, account.id, {
      last_error: `This browser is signed in to another LinkedIn account (${identity.firstName} ${identity.lastName}). Disconnect in ARIA and pair again to switch.`,
      last_error_at: now.toISOString(),
      backoff_until: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });
  }
  const { data: taken, error: takenError } = await svc
    .from("linkedin_bridge_accounts")
    .select("id")
    .eq("member_id", identity.memberId)
    .neq("id", account.id)
    .limit(1);
  if (takenError) throw new Error("linkedin_bridge_accounts read failed");
  if (taken?.length) {
    // One LinkedIn account belongs to one ARIA user.
    return updateAccount(svc, account.id, {
      last_error: `This LinkedIn account (${identity.firstName} ${identity.lastName}) is already connected to another ARIA user. Sign in to LinkedIn with your own account in this browser.`,
      last_error_at: now.toISOString(),
      backoff_until: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });
  }
  return updateAccount(svc, account.id, {
    member_id: identity.memberId,
    display_name: `${identity.firstName} ${identity.lastName}`.trim().slice(0, 200) || null,
    public_identifier: identity.publicIdentifier,
    identity_checked_at: now.toISOString(),
    backoff_until: null,
    last_error: null,
    last_error_at: null,
  });
}

async function handleConversations(svc: Svc, account: BridgeAccount, answer: LinkedInAnswer, now: Date) {
  // Whatever happens, wait for the next interval before asking again.
  await updateAccount(svc, account.id, { last_inbox_sync_at: now.toISOString() });
  if (answer.kind !== "ok") return recordAccountError(svc, account, answer, now);
  if (!account.member_id) return;
  const gqlError = graphqlErrors(answer.json);
  if (gqlError) {
    // A stale captured query id is the usual cause: fall back to the defaults.
    const queries = { ...account.query_ids };
    delete queries.messengerConversations;
    return updateAccount(svc, account.id, {
      query_ids: queries,
      last_error: `Inbox sync failed: ${gqlError}`,
      last_error_at: now.toISOString(),
    });
  }
  await storeConversations(svc, account.id, parseConversations(answer.json, account.member_id), await candidateMembers(svc, account.id));
  if (account.last_error) await updateAccount(svc, account.id, { last_error: null, last_error_at: null });
}

async function handleMessages(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, now: Date) {
  if (!ref || !isConversationUrn(ref) || !account.member_id) return;
  const conversation = await conversationByUrn(svc, account.id, ref);
  if (!conversation) return;
  // Done with this thread until LinkedIn reports new activity, even on error,
  // so a failing thread is not retried on every poll.
  const done = { needs_message_sync: false, messages_synced_at: now.toISOString(), updated_at: now.toISOString() };
  if (answer.kind !== "ok") {
    await svc.from("linkedin_bridge_conversations").update(done).eq("id", conversation.id);
    return recordAccountError(svc, account, answer, now);
  }
  const gqlError = graphqlErrors(answer.json);
  if (gqlError) {
    await svc.from("linkedin_bridge_conversations").update(done).eq("id", conversation.id);
    const queries = { ...account.query_ids };
    delete queries.messengerMessages;
    return updateAccount(svc, account.id, {
      query_ids: queries,
      last_error: `Thread sync failed: ${gqlError}`,
      last_error_at: now.toISOString(),
    });
  }
  const messages = parseMessages(answer.json, account.member_id, ref);
  await storeMessages(svc, account.id, new Map([[ref, conversation.id]]), messages);
  const latest = messages[messages.length - 1];
  const patch: Record<string, unknown> = { ...done };
  if (latest) {
    patch.last_message_preview = latest.body.replace(/\s+/g, " ").trim().slice(0, 200);
    patch.last_activity_at = new Date(latest.sentAt).toISOString();
    patch.last_message_direction = latest.direction;
    patch.last_message_sender = latest.senderName.slice(0, 200);
  }
  await svc.from("linkedin_bridge_conversations").update(patch).eq("id", conversation.id);
}

const NOT_CONNECTED =
  "Not a 1st-degree connection on LinkedIn: messages only reach connections. Send an invitation first.";

/** What a profile read says about a candidate: member id, standing with the user. */
async function applyProfileCard(svc: Svc, account: BridgeAccount, contact: ContactRow, card: ProfileCard | null, now: Date) {
  const nowIso = now.toISOString();
  if (!card) {
    return updateContact(svc, contact.id, {
      relationship: "not_found",
      lookup_requested: false,
      checked_at: nowIso,
      lookup_error: "LinkedIn did not return this profile. Check the candidate's LinkedIn URL.",
    });
  }
  // An answer without a MemberRelationship keeps what we knew.
  const relationship =
    card.relationship !== "unknown" ? card.relationship : contact.relationship === "not_found" ? "unknown" : contact.relationship;
  const patch: Record<string, unknown> = {
    member_id: card.memberId,
    display_name: card.name.slice(0, 200),
    headline: card.headline ? card.headline.slice(0, 300) : null,
    relationship,
    lookup_requested: false,
    checked_at: nowIso,
    lookup_error: null,
  };
  if (contact.relationship === "pending" && relationship === "connected") patch.accepted_at = nowIso;
  await updateContact(svc, contact.id, patch);
  if (card.memberId !== contact.member_id) {
    // Conversations already seen with them become theirs; recent ones come
    // back in full on the next inbox sync.
    await linkCandidateConversations(svc, account.id, card.memberId, contact.candidate_id);
    await updateAccount(svc, account.id, { last_inbox_sync_at: null });
  }
}

async function handleLookupContact(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, now: Date) {
  if (!ref || !UUID.test(ref)) return;
  const contact = await contactById(svc, account.id, ref);
  if (!contact) return;
  if (answer.kind === "ok") return applyProfileCard(svc, account, contact, parseProfileCard(answer.json, contact.member_id ?? contact.identity), now);
  const sessionWide = answer.kind === "session" || answer.kind === "throttled" || answer.kind === "challenge";
  await updateContact(svc, contact.id, {
    // Session-wide problems retry after the pause; anything else waits for a person.
    lookup_requested: sessionWide,
    checked_at: now.toISOString(),
    lookup_error: answer.detail,
    ...(answer.kind === "error" && answer.status === 404 ? { relationship: "not_found" } : {}),
  });
  if (sessionWide) await recordAccountError(svc, account, answer, now);
}

async function contactOf(svc: Svc, account: BridgeAccount, item: OutboxRow): Promise<ContactRow | null> {
  return item.contact_id ? contactById(svc, account.id, item.contact_id) : null;
}

async function handleResolveProfile(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, now: Date) {
  if (!ref || !UUID.test(ref)) return;
  const item = await outboxItem(svc, account.id, ref);
  if (!item || item.status !== "resolving") return;
  if (answer.kind !== "ok") {
    if (answer.kind === "error" && answer.status === 404) {
      await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: "No LinkedIn profile with this URL." });
      return;
    }
    // Session-wide problems leave the item queued for the next try.
    await transitionOutbox(svc, item, { status: "queued", claim_until: null, error: answer.detail });
    return recordAccountError(svc, account, answer, now);
  }
  const card = parseProfileCard(answer.json, item.recipient_public_id ?? "");
  const contact = await contactOf(svc, account, item);
  if (contact) await applyProfileCard(svc, account, contact, card, now);
  if (!card) {
    await transitionOutbox(svc, item, {
      status: "failed",
      claim_until: null,
      error: "LinkedIn did not return this profile. Check the URL, or reply from an existing conversation.",
    });
    return;
  }
  // Refuse a write LinkedIn would refuse anyway, with the reason.
  const refusal =
    item.kind === "message" && (card.relationship === "none" || card.relationship === "pending")
      ? card.relationship === "pending"
        ? "Your invitation is still pending: LinkedIn delivers messages once they accept."
        : NOT_CONNECTED
      : item.kind === "invitation" && card.relationship === "connected"
        ? "Already connected: send a message instead."
        : item.kind === "invitation" && card.relationship === "pending"
          ? "An invitation to this person is already pending."
          : null;
  if (refusal) {
    await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: refusal, recipient_member_id: card.memberId });
    return;
  }
  await transitionOutbox(svc, item, {
    status: "queued",
    claim_until: null,
    attempts: 0,
    error: null,
    recipient_member_id: card.memberId,
    recipient_name: card.name.slice(0, 200),
  });
}

async function handleInvite(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, result: TaskResult, now: Date) {
  if (!ref || !UUID.test(ref)) return;
  const item = await outboxItem(svc, account.id, ref);
  if (!item || item.status !== "sending" || item.kind !== "invitation") return;
  const contact = await contactOf(svc, account, item);
  const nowIso = now.toISOString();
  if (answer.kind === "transport") {
    // It may have left: never resend blindly; the next lookup tells.
    await transitionOutbox(svc, item, { status: "unknown", claim_until: null, error: answer.detail });
    if (contact) await updateContact(svc, contact.id, { lookup_requested: true });
    return;
  }
  if (answer.kind === "session" || answer.kind === "throttled" || answer.kind === "challenge") {
    await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: answer.detail });
    return recordAccountError(svc, account, answer, now);
  }
  const outcome = parseInvitationResult(result.status, result.body);
  switch (outcome.kind) {
    case "sent":
      await transitionOutbox(svc, item, { status: "sent", claim_until: null, error: null, sent_at: nowIso });
      if (contact) await updateContact(svc, contact.id, { relationship: "pending", invited_at: nowIso, lookup_error: null });
      return;
    case "already_pending":
      await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: "An invitation to this person is already pending." });
      if (contact) await updateContact(svc, contact.id, { relationship: "pending" });
      return;
    case "already_connected":
      await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: "Already connected: send a message instead." });
      if (contact) await updateContact(svc, contact.id, { relationship: "connected" });
      return;
    case "quota":
      await transitionOutbox(svc, item, {
        status: "failed",
        claim_until: null,
        error: `${outcome.detail} LinkedIn caps invitations (about 100 a week); try again in a few days.`.slice(0, 500),
      });
      return;
    case "refused":
      await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: outcome.detail });
      return;
  }
}

async function handleSend(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, result: TaskResult, now: Date) {
  if (!ref || !UUID.test(ref)) return;
  const item = await outboxItem(svc, account.id, ref);
  if (!item || item.status !== "sending") return;
  if (answer.kind !== "ok") {
    if (answer.kind === "error" && isNotConnectedRefusal(result.status, result.body)) {
      await transitionOutbox(svc, item, { status: "failed", claim_until: null, error: NOT_CONNECTED });
      const contact = await contactOf(svc, account, item);
      if (contact) await updateContact(svc, contact.id, { relationship: contact.relationship === "pending" ? "pending" : "none" });
      return;
    }
    // A transport error after the request left is ambiguous: the message may
    // be on LinkedIn. Only a clear HTTP refusal counts as "failed".
    const status = answer.kind === "transport" ? "unknown" : "failed";
    await transitionOutbox(svc, item, { status, claim_until: null, error: answer.detail });
    if (answer.kind !== "error") await recordAccountError(svc, account, answer, now);
    return;
  }
  const sent = parseSendResult(answer.json, result.body);
  const conversationUrn = sent.conversationUrn ?? item.conversation_urn;
  const sentAt = new Date(sent.sentAt ?? now.getTime()).toISOString();
  let conversationId = item.conversation_id;
  if (conversationUrn && isConversationUrn(conversationUrn)) {
    const participants = item.recipient_member_id
      ? [{ memberId: item.recipient_member_id, name: item.recipient_name ?? item.recipient_public_id ?? "LinkedIn member", profileUrl: null, headline: null }]
      : [];
    conversationId = await ensureConversation(svc, account.id, conversationUrn, participants, item.candidate_id);
    // The reply shows at once, as read: the user just wrote it.
    await svc
      .from("linkedin_bridge_conversations")
      .update({
        last_message_preview: item.body.replace(/\s+/g, " ").trim().slice(0, 200),
        last_message_direction: "outbound",
        last_message_sender: (account.display_name ?? "You").slice(0, 200),
        last_activity_at: sentAt,
        seen_at: sentAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
    if (sent.messageUrn) {
      await storeMessages(svc, account.id, new Map([[conversationUrn, conversationId]]), [
        {
          urn: sent.messageUrn,
          conversationUrn,
          senderMemberId: account.member_id,
          senderName: account.display_name ?? "You",
          direction: "outbound",
          body: item.body,
          sentAt: Date.parse(sentAt),
        },
      ]);
    }
  }
  // A delivered message proves the connection.
  const contact = await contactOf(svc, account, item);
  if (contact && contact.relationship !== "connected") {
    await updateContact(svc, contact.id, { relationship: "connected", ...(contact.relationship === "pending" ? { accepted_at: sentAt } : {}) });
  }
  await transitionOutbox(svc, item, {
    status: "sent",
    claim_until: null,
    error: null,
    sent_at: sentAt,
    sent_message_urn: sent.messageUrn,
    conversation_urn: conversationUrn,
    conversation_id: conversationId,
  });
}

async function dispatch(svc: Svc, account: BridgeAccount, result: TaskResult): Promise<void> {
  const now = new Date();
  const answer = classifyAnswer(result);
  switch (result.op) {
    case "identity":
      return handleIdentity(svc, account, answer, now);
    case "conversations":
      return handleConversations(svc, account, answer, now);
    case "messages":
      return handleMessages(svc, account, result.ref, answer, now);
    case "resolveProfile":
      return handleResolveProfile(svc, account, result.ref, answer, now);
    case "send":
      return handleSend(svc, account, result.ref, answer, result, now);
    case "invite":
      return handleInvite(svc, account, result.ref, answer, result, now);
    case "lookupContact":
      return handleLookupContact(svc, account, result.ref, answer, now);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireBridgeExtension(req, "result", 120);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, ResultSchema, { maxBytes: 4_000_000 });
  if (!validated.ok) return validated.response;
  try {
    await dispatch(auth.svc, auth.account, validated.data);
    return okJson({});
  } catch {
    return serverError("Bridge result could not be stored.");
  }
}
