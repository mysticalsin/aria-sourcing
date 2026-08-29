import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { buildInterviewPrepOutreach } from "@/lib/interview-prep-dispatch";
import { mantuEmailHtmlWrapper } from "@/lib/mantu-brand";
import { validateOutreachQualityLive } from "@/lib/outreach-quality-pipeline-live";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { OutreachMessage } from "@/lib/types";
import {
  loadBookingForLoop,
  loadCampaignForLoop,
  loadCandidateForLoop,
} from "@/lib/workspace-loop-slices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(100),
  bookingId: z.string().min(1).max(100),
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

async function applyLiveCritics(
  draft: OutreachMessage,
  workspaceId: string,
): Promise<OutreachMessage> {
  const verdict = await validateOutreachQualityLive({
    subject: draft.subject,
    body: draft.body,
    channel: draft.channel ?? "Email",
    workspaceId,
  });
  return {
    ...draft,
    subject: verdict.text.subject,
    body: verdict.text.body,
    htmlBody: mantuEmailHtmlWrapper(verdict.text.body),
    qualityStatus: verdict.status,
    qualityScore: verdict.aggregateScore,
    qualityCriticsUsed: verdict.llmCriticsUsed === true,
    qualityReasons: verdict.stages
      .flatMap((s) => s.reasons)
      .filter(Boolean)
      .slice(0, 12),
  };
}

/**
 * Loop-side interview prep dispatch: build interviewer prep + candidate
 * confirmation drafts, run live critics, return for workspace append.
 * Autopilot send is the worker's job when critics are green + entitled.
 */
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

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, status: "service_unavailable" }, { status: 503 });
  }

  const [campaign, candidate, booking] = await Promise.all([
    loadCampaignForLoop(svc, parsed.data.workspaceId, parsed.data.campaignId),
    loadCandidateForLoop(svc, parsed.data.workspaceId, parsed.data.candidateId),
    loadBookingForLoop(svc, parsed.data.workspaceId, parsed.data.bookingId),
  ]);
  if (!campaign || !candidate || !booking) {
    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  }
  if (!booking.calendarSync && !booking.teamsLink && !booking.calLink) {
    return NextResponse.json(
      {
        ok: false,
        status: "no_provider_booking",
        detail: "Interview prep dispatch requires a provider-linked booking.",
      },
      { status: 409 },
    );
  }

  const base = buildInterviewPrepOutreach({
    booking,
    candidate,
    campaign,
    workspaceId: parsed.data.workspaceId,
  });
  const outreach: OutreachMessage[] = [];
  for (const draft of base) {
    outreach.push(await applyLiveCritics(draft, parsed.data.workspaceId));
  }

  const llmCriticsUsed = outreach.every((m) => m.qualityCriticsUsed === true);
  const allReady = outreach.every((m) => m.qualityStatus === "ready");

  // Include resolved recipients for the worker's inline autopilot path
  // (interviewer override or candidate email). Not a persisted OutreachMessage field.
  const withRecipients = outreach.map((m) => {
    const override = m.recipientOverride?.trim() ?? "";
    const candidateEmail =
      m.prepPurpose === "candidate_confirmation" ? (candidate.email?.trim() ?? "") : "";
    return {
      ...m,
      recipient: override || candidateEmail,
    };
  });

  return NextResponse.json({
    ok: true,
    status: "prep_drafted",
    campaignId: campaign.id,
    candidateId: candidate.id,
    bookingId: booking.id,
    outreach: withRecipients,
    dryRun: true,
    llmCriticsUsed,
    qualityReady: allReady,
  });
}
