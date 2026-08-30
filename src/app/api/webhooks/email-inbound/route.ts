import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { readBoundedBody } from "@/lib/api/validate";
import { ingestNormalizedInboundEmail } from "@/lib/inbound-email-ingest";

export const dynamic = "force-dynamic";

/**
 * Inbound email webhook — HMAC-signed normalized adapter path.
 * Graph-native notifications use /api/webhooks/microsoft-graph instead.
 * Both paths share ingestNormalizedInboundEmail (no mailbox polling).
 */

const WEBHOOK_MAX_BODY_BYTES = 2_000_000;
const SECRET = () => process.env.EMAIL_INBOUND_WEBHOOK_SECRET ?? "";

const PayloadSchema = z.object({
  mailbox: z.string().min(3).max(320),
  providerId: z.string().min(1).max(512),
  from: z.string().min(3).max(320),
  subject: z.string().max(998).default(""),
  body: z.string().max(1_000_000).default(""),
  inReplyTo: z.string().max(998).optional(),
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

  let ev: z.infer<typeof PayloadSchema>;
  try {
    ev = PayloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid payload." }, { status: 400 });
  }

  const ingested = await ingestNormalizedInboundEmail(ev);
  if (!ingested.ok) {
    return NextResponse.json(
      { ok: false, reason: ingested.reason, inboundId: ingested.inboundId },
      { status: ingested.status },
    );
  }

  return NextResponse.json({
    ok: true,
    inboundId: ingested.inboundId,
    duplicate: ingested.duplicate,
    correlated: ingested.correlated,
    reason: ingested.reason,
    jobQueued: ingested.jobQueued,
    jobKind: ingested.jobKind,
    route: ingested.route,
  });
}
