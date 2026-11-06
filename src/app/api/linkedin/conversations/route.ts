// Experimental LinkedIn bridge: the signed-in user's conversations with
// sourced candidates.
//   GET  conversations, most recent first
//   POST ask the extension to refresh the inbox (or one thread) on its next
//        poll, and/or mark a thread as seen in ARIA

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  accountForUser,
  notFound,
  okJson,
  requireBridgeUser,
  serverError,
  unreadInAria,
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
      .select(
        "id, candidate_id, title, participants, group_chat, last_activity_at, unread, seen_at, last_message_preview, last_message_direction, last_message_sender, messages_synced_at",
      )
      .eq("account_id", account.id)
      // Only conversations with sourced candidates; the rest is never shown.
      .not("candidate_id", "is", null)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) return serverError("Conversations unavailable.");
    const rows = (data ?? []) as (Record<string, unknown> & { unread: boolean; seen_at: string | null; last_activity_at: string | null })[];
    return okJson({ conversations: rows.map((row) => ({ ...row, unread: unreadInAria(row) })) });
  } catch {
    return serverError("Conversations unavailable.");
  }
}

const RefreshSchema = z.object({
  conversationId: z.string().uuid().optional(),
  /** Fetch the thread's messages again on the next poll (default true). */
  refresh: z.boolean().optional(),
  /** The user has the thread open: everything in it counts as seen. */
  seen: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, RefreshSchema, { maxBytes: 1_000 });
  if (!validated.ok) return validated.response;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Pair the extension first.");
    const { conversationId, refresh = true, seen = false } = validated.data;
    if (conversationId) {
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { updated_at: now };
      if (refresh) patch.needs_message_sync = true;
      if (seen) patch.seen_at = now;
      const { data, error } = await auth.ctx.svc
        .from("linkedin_bridge_conversations")
        .update(patch)
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
