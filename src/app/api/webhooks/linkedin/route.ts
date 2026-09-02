import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { parseLinkedInConnectionAccepted, parseLinkedInInboundWebhook, verifyLoopWebhookSecret } from "@/lib/linkedin-loop";
import {
  drainLinkedInCampaign,
  drainLinkedInLoop,
  ingestLinkedInConnectionAcceptedEvent,
  ingestLinkedInLoopEvent,
} from "@/lib/linkedin-loop-server";

export const dynamic = "force-dynamic";

/**
 * LinkedIn reply webhook (delivery-vendor shaped or generic). The inbound half
 * of the launched-campaign reply loop (docs/outreach/LINKEDIN-LOOP.md).
 *
 * Aria never reads LinkedIn itself: the vendor that holds the official send
 * key tells Aria a candidate replied. Every event is authenticated with the
 * shared secret in LINKEDIN_INBOUND_WEBHOOK_SECRET (header
 * x-aria-webhook-secret); an unset secret refuses everything. The tenant comes
 * from the launch grant that owns the vendor campaign id, never from a guess.
 * Storage happens before any model call; a retryable persistence failure
 * returns 503 so the vendor redelivers instead of dropping the reply.
 */
const WEBHOOK_MAX_BODY_BYTES = 500_000;

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readBoundedBody(req, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, reason: "Body too large." }, { status: 413 });
  }
  const secret = process.env.LINKEDIN_INBOUND_WEBHOOK_SECRET ?? "";
  if (!verifyLoopWebhookSecret(req.headers.get("x-aria-webhook-secret"), secret)) {
    return NextResponse.json({ ok: false, reason: "Bad secret." }, { status: 401 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    safeLog("linkedin webhook: not configured", { hasSupabase: false });
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  let retryable = false;
  const outcomes: Record<string, number> = {};
  for (const event of parseLinkedInInboundWebhook(payload)) {
    try {
      const result = await ingestLinkedInLoopEvent(supabase, event);
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      if (result.outcome === "retry") {
        retryable = true;
        safeLog("linkedin webhook: inbound deferred", { reason: result.reason });
      }
    } catch (err) {
      retryable = true;
      safeLog("linkedin webhook processing error", { message: err instanceof Error ? err.message : "unknown" });
    }
  }

  // Accepted connection requests: the event is stored, then the first message
  // the launch approved is queued 2 to 10 minutes out. Never sent from here.
  for (const accepted of parseLinkedInConnectionAccepted(payload)) {
    try {
      const result = await ingestLinkedInConnectionAcceptedEvent(supabase, accepted);
      const key = `accepted:${result.outcome}`;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      if (result.outcome === "retry") {
        retryable = true;
        safeLog("linkedin webhook: accepted event deferred", { reason: result.reason });
      }
    } catch (err) {
      retryable = true;
      safeLog("linkedin webhook accepted event error", { message: err instanceof Error ? err.message : "unknown" });
    }
  }

  // Opportunistic drain: only replies and connection requests whose 2 to 10
  // minute delay has already elapsed go out here. The rows stored above are
  // never due yet.
  try {
    await drainLinkedInLoop(supabase, 5);
    await drainLinkedInCampaign(supabase, 5);
  } catch (err) {
    safeLog("linkedin webhook: drain error", { message: err instanceof Error ? err.message : "unknown" });
  }

  if (retryable) {
    return NextResponse.json({ ok: false, reason: "Retryable LinkedIn persistence failure." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, outcomes });
}
