// Experimental LinkedIn bridge: one conversation of the signed-in user, with
// its messages and the messages still waiting in the outbox for it.

import type { NextRequest } from "next/server";
import { OUTBOX_COLUMNS, accountForUser, notFound, okJson, requireBridgeUser, serverError } from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return notFound("Conversation not found.");
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Conversation not found.");
    const svc = auth.ctx.svc;
    const { data: conversation, error } = await svc
      .from("linkedin_bridge_conversations")
      .select("id, conversation_urn, title, participants, group_chat, last_activity_at, unread, messages_synced_at, needs_message_sync")
      .eq("account_id", account.id)
      .eq("id", id)
      .maybeSingle();
    if (error) return serverError("Conversation unavailable.");
    if (!conversation) return notFound("Conversation not found.");
    const [messages, outbox] = await Promise.all([
      svc
        .from("linkedin_bridge_messages")
        .select("id, message_urn, sender_name, direction, body, sent_at")
        .eq("account_id", account.id)
        .eq("conversation_id", id)
        .order("sent_at", { ascending: false })
        .limit(200),
      svc
        .from("linkedin_bridge_outbox")
        .select(OUTBOX_COLUMNS)
        .eq("account_id", account.id)
        .eq("conversation_id", id)
        .in("status", ["queued", "resolving", "sending", "failed", "unknown"])
        .order("created_at", { ascending: true })
        .limit(50),
    ]);
    if (messages.error || outbox.error) return serverError("Conversation unavailable.");
    return okJson({
      conversation,
      // Newest 200, shown oldest first.
      messages: [...(messages.data ?? [])].reverse(),
      outbox: outbox.data ?? [],
    });
  } catch {
    return serverError("Conversation unavailable.");
  }
}
