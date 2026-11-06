// Experimental LinkedIn bridge: messages and invitations the signed-in user
// wrote in ARIA, to sourced candidates only.
//   GET    the latest outbox items
//   POST   queue one message to a candidate (this click is the human approval;
//          nothing upstream, no agent and no sequence, can call this route)
//   DELETE ?id=  withdraw a message or invitation that has not left yet

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { publicIdFromProfileUrl } from "@/lib/linkedin-bridge/voyager";
import {
  OUTBOX_COLUMNS,
  accountForUser,
  badRequest,
  candidateRecord,
  contactBlock,
  ensureContact,
  notFound,
  okJson,
  outboxItem,
  requireBridgeUser,
  serverError,
  transitionOutbox,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WAITING = 100;
const NOT_CONNECTED = "Not a 1st-degree connection on LinkedIn: send an invitation first.";

export async function GET(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return okJson({ items: [] });
    const { data, error } = await auth.ctx.svc
      .from("linkedin_bridge_outbox")
      .select(OUTBOX_COLUMNS)
      .eq("account_id", account.id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return serverError("Outbox unavailable.");
    return okJson({ items: data ?? [] });
  } catch {
    return serverError("Outbox unavailable.");
  }
}

const QueueSchema = z
  .object({
    /** Reply in a conversation (already tied to a candidate)... */
    conversationId: z.string().uuid().optional(),
    /** ...or write to a sourced candidate (their conversation, or a new one). */
    candidateId: z.string().min(1).max(100).optional(),
    text: z.string().max(8000).refine((t) => t.trim().length > 0, "Message is empty."),
  })
  .refine((v) => Boolean(v.conversationId) || Boolean(v.candidateId), { message: "Give conversationId or candidateId." });

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, QueueSchema, { maxBytes: 40_000 });
  if (!validated.ok) return validated.response;
  const { conversationId, text } = validated.data;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Connect your LinkedIn in Settings first.");
    const { svc, workspaceId, userId } = auth.ctx;

    const { count, error: countError } = await svc
      .from("linkedin_bridge_outbox")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .in("status", ["queued", "resolving", "sending"]);
    if (countError) return serverError("Outbox unavailable.");
    if ((count ?? 0) >= MAX_WAITING) return badRequest(`${MAX_WAITING} messages are already waiting. Let them go out first.`);

    let candidateId = validated.data.candidateId ?? null;
    let conversation: { id: string; conversation_urn: string; candidate_id: string | null } | null = null;
    if (conversationId) {
      const { data, error } = await svc
        .from("linkedin_bridge_conversations")
        .select("id, conversation_urn, candidate_id")
        .eq("account_id", account.id)
        .eq("id", conversationId)
        .maybeSingle();
      if (error) return serverError("Conversation unavailable.");
      if (!data || !data.candidate_id) return notFound("Conversation not found.");
      conversation = data as { id: string; conversation_urn: string; candidate_id: string };
      candidateId = conversation.candidate_id;
    }
    if (!candidateId) return badRequest("Give conversationId or candidateId.");

    // The candidate as the workspace knows it, and whether ARIA may contact them.
    const candidate = await candidateRecord(svc, workspaceId, candidateId);
    if (!candidate) return notFound("Candidate not found.");
    const blocked = contactBlock(candidate);
    if (blocked) return badRequest(blocked);
    const identity = publicIdFromProfileUrl(candidate.linkedinUrl);
    if (!identity) return badRequest("This candidate has no LinkedIn profile URL ARIA can read.");
    const contact = await ensureContact(svc, account.id, candidate.id, identity);

    const row: Record<string, unknown> = {
      account_id: account.id,
      created_by: userId,
      kind: "message",
      contact_id: contact.id,
      candidate_id: candidate.id,
      body: text,
      recipient_name: candidate.name.slice(0, 200),
    };
    if (!conversation) {
      const { data, error } = await svc
        .from("linkedin_bridge_conversations")
        .select("id, conversation_urn, candidate_id")
        .eq("account_id", account.id)
        .eq("candidate_id", candidate.id)
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) return serverError("Conversation unavailable.");
      conversation = (data as typeof conversation) ?? null;
    }
    if (conversation) {
      row.conversation_id = conversation.id;
      row.conversation_urn = conversation.conversation_urn;
    } else {
      // A first message: LinkedIn only delivers it to a connection.
      if (contact.relationship === "none") return badRequest(NOT_CONNECTED);
      if (contact.relationship === "pending") return badRequest("Your invitation is still pending: you can write once they accept.");
      if (contact.relationship === "not_found") return badRequest("LinkedIn does not know this profile. Check the candidate's LinkedIn URL.");
      if (contact.member_id) row.recipient_member_id = contact.member_id;
      else row.recipient_public_id = contact.identity;
    }

    const { data, error } = await svc.from("linkedin_bridge_outbox").insert(row).select(OUTBOX_COLUMNS).single();
    if (error || !data) return serverError("Could not queue the message.");
    return okJson({ item: data });
  } catch {
    return serverError("Could not queue the message.");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return badRequest("Missing message id.");
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Message not found.");
    const item = await outboxItem(auth.ctx.svc, account.id, id);
    if (!item) return notFound("Message not found.");
    if (item.status === "sending") return badRequest("This message is being sent right now.");
    if (item.status === "sent" || item.status === "cancelled") return okJson({ cancelled: false, status: item.status });
    const cancelled = await transitionOutbox(auth.ctx.svc, item, { status: "cancelled", claim_until: null });
    return okJson({ cancelled });
  } catch {
    return serverError("Could not withdraw the message.");
  }
}
