// Experimental LinkedIn bridge: the extension posts LinkedIn's raw answer to a
// task. ARIA parses it here, so a LinkedIn format change is fixed server-side
// without reinstalling the extension. Every reference the extension echoes
// (conversation URN, outbox id) is re-checked against the paired account.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { BRIDGE_OPS } from "@/lib/linkedin-bridge/planner";
import { readBridgePolicy } from "@/lib/linkedin-bridge/policy";
import { classifyAnswer, graphqlErrors, type LinkedInAnswer } from "@/lib/linkedin-bridge/outcome";
import {
  parseConversations,
  parseIdentity,
  parseMessages,
  parseProfileLookup,
  parseSendResult,
} from "@/lib/linkedin-bridge/parse";
import { isConversationUrn } from "@/lib/linkedin-bridge/voyager";
import {
  conversationByUrn,
  ensureConversation,
  okJson,
  outboxItem,
  requireBridgeExtension,
  serverError,
  storeConversations,
  storeMessages,
  transitionOutbox,
  updateAccount,
  type BridgeAccount,
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
  await storeConversations(svc, account.id, parseConversations(answer.json, account.member_id));
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
  }
  await svc.from("linkedin_bridge_conversations").update(patch).eq("id", conversation.id);
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
  const profile = parseProfileLookup(answer.json, item.recipient_public_id ?? "");
  if (!profile) {
    await transitionOutbox(svc, item, {
      status: "failed",
      claim_until: null,
      error: "LinkedIn did not return this profile. Check the URL, or reply from an existing conversation.",
    });
    return;
  }
  await transitionOutbox(svc, item, {
    status: "queued",
    claim_until: null,
    attempts: 0,
    error: null,
    recipient_member_id: profile.memberId,
    recipient_name: profile.name.slice(0, 200),
  });
}

async function handleSend(svc: Svc, account: BridgeAccount, ref: string | null, answer: LinkedInAnswer, rawBody: string, now: Date) {
  if (!ref || !UUID.test(ref)) return;
  const item = await outboxItem(svc, account.id, ref);
  if (!item || item.status !== "sending") return;
  if (answer.kind !== "ok") {
    // A transport error after the request left is ambiguous: the message may
    // be on LinkedIn. Only a clear HTTP refusal counts as "failed".
    const status = answer.kind === "transport" ? "unknown" : "failed";
    await transitionOutbox(svc, item, { status, claim_until: null, error: answer.detail });
    if (answer.kind !== "error") await recordAccountError(svc, account, answer, now);
    return;
  }
  const result = parseSendResult(answer.json, rawBody);
  const conversationUrn = result.conversationUrn ?? item.conversation_urn;
  const sentAt = new Date(result.sentAt ?? now.getTime()).toISOString();
  let conversationId = item.conversation_id;
  if (conversationUrn && isConversationUrn(conversationUrn)) {
    const participants = item.recipient_member_id
      ? [{ memberId: item.recipient_member_id, name: item.recipient_name ?? item.recipient_public_id ?? "LinkedIn member", profileUrl: item.recipient_public_id ? `https://www.linkedin.com/in/${item.recipient_public_id}/` : null, headline: null }]
      : [];
    conversationId = await ensureConversation(svc, account.id, conversationUrn, participants);
    if (result.messageUrn) {
      await storeMessages(svc, account.id, new Map([[conversationUrn, conversationId]]), [
        {
          urn: result.messageUrn,
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
  await transitionOutbox(svc, item, {
    status: "sent",
    claim_until: null,
    error: null,
    sent_at: sentAt,
    sent_message_urn: result.messageUrn,
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
      return handleSend(svc, account, result.ref, answer, result.body, now);
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
