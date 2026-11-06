// Experimental LinkedIn bridge: messages the signed-in user wrote in ARIA.
//   GET    the latest outbox items
//   POST   queue one message (this click is the human approval; nothing
//          upstream, no agent and no sequence, can call this route)
//   DELETE ?id=  withdraw a message that has not left yet

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { publicIdFromProfileUrl } from "@/lib/linkedin-bridge/voyager";
import {
  OUTBOX_COLUMNS,
  accountForUser,
  badRequest,
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
    conversationId: z.string().uuid().optional(),
    profileUrl: z.string().max(300).optional(),
    text: z.string().max(8000).refine((t) => t.trim().length > 0, "Message is empty."),
    candidateId: z.string().max(100).optional(),
  })
  .refine((v) => Boolean(v.conversationId) !== Boolean(v.profileUrl), {
    message: "Give either conversationId or profileUrl.",
  });

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const validated = await validateBody(req, QueueSchema, { maxBytes: 40_000 });
  if (!validated.ok) return validated.response;
  const { conversationId, profileUrl, text, candidateId } = validated.data;
  try {
    const account = await accountForUser(auth.ctx);
    if (!account) return notFound("Pair the ARIA LinkedIn extension first.");
    const svc = auth.ctx.svc;

    const { count, error: countError } = await svc
      .from("linkedin_bridge_outbox")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .in("status", ["queued", "resolving", "sending"]);
    if (countError) return serverError("Outbox unavailable.");
    if ((count ?? 0) >= MAX_WAITING) return badRequest(`${MAX_WAITING} messages are already waiting. Let them go out first.`);

    const row: Record<string, unknown> = {
      account_id: account.id,
      created_by: auth.ctx.userId,
      body: text,
      candidate_id: candidateId ?? null,
    };
    if (conversationId) {
      const { data: conversation, error } = await svc
        .from("linkedin_bridge_conversations")
        .select("id, conversation_urn")
        .eq("account_id", account.id)
        .eq("id", conversationId)
        .maybeSingle();
      if (error) return serverError("Conversation unavailable.");
      if (!conversation) return notFound("Conversation not found.");
      row.conversation_id = conversation.id;
      row.conversation_urn = conversation.conversation_urn;
    } else {
      const publicId = publicIdFromProfileUrl(profileUrl ?? "");
      if (!publicId) return badRequest("Use a LinkedIn profile URL like https://www.linkedin.com/in/jane-doe/.");
      row.recipient_public_id = publicId;
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
