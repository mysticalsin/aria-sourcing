// Experimental LinkedIn bridge: the signed-in user's synced inbox.
//   GET  conversations, most recent first
//   POST ask the extension to refresh the inbox (or one thread) on its next poll

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  accountForUser,
  notFound,
  okJson,
  requireBridgeUser,
  serverError,
  updateAccount,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return okJson({ conversations: [] });
    const { data, error } = await auth.ctx.svc
      .from("linkedin_bridge_conversations")
      .select("id, title, participants, group_chat, last_activity_at, unread, last_message_preview, messages_synced_at")
      .eq("account_id", account.id)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) return serverError("Conversations unavailable.");
    return okJson({ conversations: data ?? [] });
  } catch {
    return serverError("Conversations unavailable.");
  }
}

const RefreshSchema = z.object({ conversationId: z.string().uuid().optional() });

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, RefreshSchema, { maxBytes: 1_000 });
  if (!validated.ok) return validated.response;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Pair the extension first.");
    const { conversationId } = validated.data;
    if (conversationId) {
      const { data, error } = await auth.ctx.svc
        .from("linkedin_bridge_conversations")
        .update({ needs_message_sync: true, updated_at: new Date().toISOString() })
        .eq("account_id", account.id)
        .eq("id", conversationId)
        .select("id");
      if (error) return serverError("Refresh failed.");
      if (!data?.length) return notFound("Conversation not found.");
    } else {
      await updateAccount(auth.ctx.svc, account.id, { last_inbox_sync_at: null });
    }
    return okJson({ queued: true });
  } catch {
    return serverError("Refresh failed.");
  }
}
