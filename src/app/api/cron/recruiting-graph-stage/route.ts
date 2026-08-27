import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  assertRecruitingGraphStage,
  nextJobKindAfterGraphStage,
} from "@/lib/langchain/recruiting-graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop-worker LangGraph checkpoint.
 * Side-effect handlers call this after real work so stage → successor job kinds
 * stay bound to the compiled recruiting graph (parse / rank / book intents).
 */
const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  intent: z.enum(["parse_only", "rank_only", "book_only", "draft_quality", "full"]),
  allowedStages: z.array(z.string().min(1).max(80)).min(1).max(12),
  inboundId: z.string().min(1).max(160).optional(),
  campaignId: z.string().min(1).max(160).optional(),
  candidateIds: z.array(z.string().min(1).max(160)).max(50).optional(),
  scoredCandidates: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        matchScore: z.number().nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  drafts: z
    .record(
      z.object({
        subject: z.string().max(500),
        body: z.string().max(20_000),
        channel: z.string().max(40),
      }),
    )
    .optional(),
  bookingId: z.string().min(1).max(160).optional(),
});

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

export async function POST(req: NextRequest) {
  if (req.headers.get("cookie") || req.headers.get("origin")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const check = await assertRecruitingGraphStage(
    {
      workspaceId: parsed.data.workspaceId,
      intent: parsed.data.intent,
      inboundId: parsed.data.inboundId,
      campaignId: parsed.data.campaignId,
      candidateIds: parsed.data.candidateIds,
      scoredCandidates: parsed.data.scoredCandidates,
      drafts: parsed.data.drafts,
      bookingId: parsed.data.bookingId,
    },
    parsed.data.allowedStages,
  );

  if (!check.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: check.reason,
        stage: check.stage,
        errors: check.errors,
        nextJobKind: nextJobKindAfterGraphStage(check.stage),
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    stage: check.stage,
    nextJobKind: check.nextJobKind,
    errors: check.errors,
  });
}
