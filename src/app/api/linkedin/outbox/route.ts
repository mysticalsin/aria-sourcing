// Experimental LinkedIn bridge: messages and invitations the signed-in user
// wrote in ARIA, to sourced candidates only.
//   GET    refused: Aria does not deliver to LinkedIn (no outbox items)
//   POST   refused: Aria does not deliver to LinkedIn (PR 168 removes this route)
//   DELETE ?id=  withdraw a message or invitation that has not left yet

import { NextResponse, type NextRequest } from "next/server";
import { linkedInDeliveryRefusal } from "@/lib/approval/dispatch-guard";
import {
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
  const refused = linkedInDeliveryRefusal();
  return NextResponse.json(
    { ok: false, error: refused.error, reason: refused.reason, items: [] },
    { status: 410 },
  );
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
