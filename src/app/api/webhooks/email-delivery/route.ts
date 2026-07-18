import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

/**
 * Email delivery webhook — the delivery half of the durable email outbox (Rock 2).
 *
 * A provider adapter (SES / SendGrid / Postmark / …) normalizes its native
 * delivery notifications into the signed shape below and POSTs them here. Each
 * event is recorded through the service-only `record_email_delivery_event` RPC:
 * an append-only receipt on email_delivery_events, and a permanent bounce or a
 * spam complaint upserts the workspace suppression list. Send state is never
 * mutated here.
 *
 * Auth is our own HMAC over the raw body (the adapter holds the shared secret),
 * timing-safe compared BEFORE any parsing. A missing service client returns 503
 * so the adapter retries rather than dropping the event.
 *
 * NOTE (owner-verify pending): shipped DEGRADED (Codex re-attack owed 2026-07-23)
 * and not exercised end-to-end in the build sandbox — the RPC + table it feeds are
 * DB-tested (tests/email-durability-db.sh); this thin adapter is not.
 */

const WEBHOOK_MAX_BODY_BYTES = 1_000_000;
const SECRET = () => process.env.EMAIL_DELIVERY_WEBHOOK_SECRET ?? "";
// Replay horizon: reject events older than this. It MUST stay shorter than the
// dedup receipt retention floor (90 days) so a receipt always outlives any
// event the webhook will still process — a replay of an event older than the
// horizon is refused outright, so a garbage-collected receipt can never be
// re-processed. Providers deliver bounce/complaint events within hours/days.
const EVENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EventSchema = z.object({
  workspaceId: z.string().uuid(),
  rfcMessageId: z.string().min(3).max(998).regex(/^<[^<>@\s]+@[^<>@\s]+>$/),
  eventStatus: z.enum(["delivered", "bounced", "complained", "opened"]),
  occurredAt: z.string().datetime(),
  permanent: z.boolean().optional().default(false),
  errorCode: z.number().int().optional(),
});
const PayloadSchema = z.object({ events: z.array(EventSchema).min(1).max(500) });

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Bound the unauthenticated body BEFORE buffering it (an attacker without the
  // secret can still stream a large body ahead of the signature check).
  let rawBody: string;
  try {
    rawBody = await readBoundedBody(req, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return NextResponse.json({ ok: false, reason: "Body too large." }, { status: 413 });
  }

  if (!verifySignature(rawBody, req.headers.get("x-aria-signature"), SECRET())) {
    return NextResponse.json({ ok: false, reason: "Bad signature." }, { status: 401 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    safeLog("email delivery webhook: service client unavailable", { hasSupabase: false });
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    parsed = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  let recorded = 0;
  let failed = 0;
  let skippedStale = 0;
  const now = Date.now();
  for (const event of parsed.events) {
    // Refuse events older than the replay horizon: beyond it the dedup receipt
    // may have been garbage-collected, so re-processing could reopen a replay.
    if (now - Date.parse(event.occurredAt) > EVENT_MAX_AGE_MS) {
      skippedStale += 1;
      continue;
    }
    const { data, error } = await supabase.rpc("record_email_delivery_event", {
      p_workspace_id: event.workspaceId,
      p_rfc_message_id: event.rfcMessageId,
      p_event_status: event.eventStatus,
      p_provider_occurred_at: event.occurredAt,
      p_provider_error_code: event.errorCode ?? null,
      p_permanent: event.permanent,
    });
    const result = data as { recorded?: boolean } | null;
    if (error || result?.recorded !== true) {
      failed++;
      safeLog("email delivery webhook: record failed", { message: error?.message, code: error?.code });
    } else {
      recorded++;
    }
  }

  // Any failure returns 503 so the adapter retries the batch; the RPC is
  // idempotent, so a redelivered event is a no-op.
  if (failed > 0) {
    return NextResponse.json({ ok: false, recorded, failed, skippedStale }, { status: 503 });
  }
  return NextResponse.json({ ok: true, recorded, skippedStale });
}
