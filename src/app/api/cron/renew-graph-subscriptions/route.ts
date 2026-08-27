import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { renewExpiringGraphMailSubscriptions } from "@/lib/email-graph-subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return (
    secret !== "" &&
    presentedBuf.length === expectedBuf.length &&
    timingSafeEqual(presentedBuf, expectedBuf)
  );
}

/**
 * Renew Microsoft Graph Inbox subscriptions before they expire (~2–3 day TTL).
 * Called by the loop worker tick (and any external cron) so webhook intake stays live.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await renewExpiringGraphMailSubscriptions({ withinHours: 12, limit: 25 });
  return NextResponse.json({ ok: true, ...result });
}
