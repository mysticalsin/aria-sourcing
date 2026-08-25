import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase/server";
import { readBoundedBody } from "@/lib/api/validate";
import { safeLog } from "@/lib/log-redact";
import { decideInboundClassifyEnqueue } from "@/lib/inbound-reply-trigger";

export const dynamic = "force-dynamic";

/**
 * LinkedIn inbound webhook — vendor replies only (L-5 close).
 *
 * A contracted messaging vendor POSTs a signed payload. Tenant is resolved ONLY
 * from linkedin_inbound_routes.route_key (never from the sender profile).
 * No LinkedIn login/scrape in Aria — this is the official vendor callback path.
 */

const WEBHOOK_MAX_BODY_BYTES = 2_000_000;
const SECRET = () =>
  process.env.LINKEDIN_INBOUND_WEBHOOK_SECRET?.trim() ||
  process.env.EMAIL_INBOUND_WEBHOOK_SECRET?.trim() ||
  "";

const PayloadSchema = z.object({
  routeKey: z.string().min(16).max(128),
  providerId: z.string().min(1).max(512),
  fromProfileUrl: z.string().min(8).max(500),
  body: z.string().max(1_000_000).default(""),
});

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let ev: z.infer<typeof PayloadSchema>;
  try {
    ev = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  const { data: routeData, error: routeErr } = await supabase.rpc("resolve_linkedin_inbound_route", {
    p_route_key: ev.routeKey,
  });
  const route = routeData as { ok?: boolean; workspace_id?: string } | null;
  if (routeErr || route?.ok !== true || !route.workspace_id) {
    return NextResponse.json({ ok: false, reason: "No route for key." }, { status: 404 });
  }

  const { data: recData, error: recErr } = await supabase.rpc("record_linkedin_inbound", {
    p_workspace_id: route.workspace_id,
    p_provider_id: ev.providerId,
    p_from_profile: ev.fromProfileUrl,
    p_body: ev.body,
  });
  const rec = recData as { ok?: boolean; inbound_id?: string; duplicate?: boolean } | null;
  if (recErr || rec?.ok !== true || !rec.inbound_id) {
    safeLog("linkedin inbound webhook: record failed", { message: recErr?.message, code: recErr?.code });
    return NextResponse.json({ ok: false, reason: "Record failed." }, { status: 503 });
  }

  const decision = decideInboundClassifyEnqueue(rec);
  let classifyQueued = false;
  let classifyStatus: string | undefined;
  if (decision.enqueue) {
    const { data: enqData, error: enqErr } = await supabase.rpc("enqueue_aria_job", {
      p_workspace_id: route.workspace_id,
      p_kind: decision.kind,
      p_idempotency_key: `li:${decision.idempotencyKey}`,
      p_payload: decision.payload,
      p_run_at: new Date().toISOString(),
      p_priority: decision.priority,
    });
    const enq = enqData as { status?: string } | null;
    if (enqErr) {
      safeLog("linkedin inbound webhook: classify enqueue failed", {
        message: enqErr.message,
        code: enqErr.code,
      });
      return NextResponse.json(
        { ok: false, reason: "Classify enqueue failed.", inboundId: rec.inbound_id },
        { status: 503 },
      );
    }
    classifyStatus = typeof enq?.status === "string" ? enq.status : "unknown";
    classifyQueued = classifyStatus === "enqueued" || classifyStatus === "already_enqueued";
  }

  return NextResponse.json({
    ok: true,
    inboundId: rec.inbound_id,
    duplicate: Boolean(rec.duplicate),
    classifyQueued,
    classifyStatus: classifyStatus ?? (decision.enqueue ? "unknown" : "skipped"),
  });
}
