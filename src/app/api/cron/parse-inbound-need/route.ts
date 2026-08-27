import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  buildCampaignFromNeed,
  buildInboundEmailText,
  deterministicCampaignId,
  parseInboundNeed,
} from "@/lib/requisition-intake";

export const dynamic = "force-dynamic";

const ParseBodySchema = z.object({
  from: z.string().max(320).optional(),
  subject: z.string().max(998).optional(),
  body: z.string().max(1_000_000).default(""),
  email: z.string().max(1_000_000).optional(),
  requisitionId: z.string().uuid().optional(),
  campaignId: z.string().min(1).max(200).optional(),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const presented = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const presentedBuf = Buffer.from(presented);
  const expectedBuf = Buffer.from(expected);
  return secret !== ""
    && presentedBuf.length === expectedBuf.length
    && timingSafeEqual(presentedBuf, expectedBuf);
}

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = ParseBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const emailText =
    parsed.data.email?.trim()
      ? parsed.data.email
      : buildInboundEmailText({
          from: parsed.data.from,
          subject: parsed.data.subject,
          body: parsed.data.body,
        });

  if (!emailText.trim()) {
    return NextResponse.json({ ok: false, status: "empty_input" }, { status: 400 });
  }

  const result = parseInboundNeed(emailText);
  const campaignId =
    parsed.data.campaignId?.trim()
    || (parsed.data.requisitionId ? deterministicCampaignId(parsed.data.requisitionId) : "");
  const campaign =
    result.ready && campaignId
      ? buildCampaignFromNeed(
          result.jobAnalysis,
          campaignId,
          result.sender.name || "Hiring Manager",
          result.sender.email || "",
        )
      : null;

  return NextResponse.json({
    ok: true,
    ready: result.ready,
    confidence: result.confidence,
    warnings: result.warnings,
    jobAnalysis: result.jobAnalysis,
    sender: result.sender,
    campaignId: campaign?.id ?? (campaignId || null),
    campaign,
  });
}
