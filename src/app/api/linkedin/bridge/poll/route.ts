// Experimental LinkedIn bridge: the paired extension asks what to do next.
// Authenticated by the pairing token, never by a LinkedIn credential.
// Sending is refused. PR 168 removes this route; until then Aria does not
// hand the extension a LinkedIn delivery.

import { NextResponse, type NextRequest } from "next/server";
import { linkedInDeliveryRefusal } from "@/lib/approval/dispatch-guard";
import { requireBridgeExtension } from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireBridgeExtension(req, "poll", 60);
  if (!auth.ok) return auth.response;
  const refused = linkedInDeliveryRefusal();
  return NextResponse.json(
    { ok: false, error: refused.error, reason: refused.reason },
    { status: 410 },
  );
}
