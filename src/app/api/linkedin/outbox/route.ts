// Experimental LinkedIn bridge: messages and invitations the signed-in user
// wrote in ARIA, to sourced candidates only.
//   GET    the latest outbox items
//   POST   refused: Aria does not deliver to LinkedIn (PR 168 removes this route)
//   DELETE ?id=  withdraw a message or invitation that has not left yet

import { NextResponse, type NextRequest } from "next/server";
import { linkedInDeliveryRefusal } from "@/lib/approval/dispatch-guard";
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

export async function POST(req: NextRequest) {
  const auth = await requireBridgeUser(req, { mutation: true });
  if (!auth.ok) return auth.response;
  const refused = linkedInDeliveryRefusal();
  return NextResponse.json({ ok: false, error: refused.error, reason: refused.reason }, { status: 410 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req: NextRequest) {
  const auth = await requireBridgeUser(req, { mutation: true });
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
