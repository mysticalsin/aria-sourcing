import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { claimCalendarBooking, reconcileCalendarBooking } from "@/lib/calendar-authority";
import { mantuFirstInterviewAgenda, mantuPreCallAgenda } from "@/lib/mantu-brand";
import { getServiceSupabase } from "@/lib/supabase/server";
import { loadCampaignForLoop, loadCandidateForLoop } from "@/lib/workspace-loop-slices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(100),
  /** Default false — claim + release dry-run; never calls Graph. */
  confirmLive: z.boolean().optional().default(false),
  startTime: z.string().min(1).max(40).optional(),
  endTime: z.string().min(1).max(40).optional(),
  /** pre_call = 15–20 min screen; first_interview = 30–60 min Mantu interview (default). */
  meetingKind: z.enum(["pre_call", "first_interview"]).optional().default("first_interview"),
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

/** Next weekday default slot; pre-call is 20 min, first interview 30 min. */
function defaultMeetingWindow(
  meetingKind: "pre_call" | "first_interview",
  now = new Date(),
): { startTime: string; endTime: string } {
  const start = new Date(now);
  start.setUTCHours(10, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 1);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  const durationMs = meetingKind === "pre_call" ? 20 * 60 * 1000 : 30 * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/**
 * Loop-side interview propose: claim calendar authority, then either dry-run
 * release (default) or leave claim for human confirmLive Graph booking.
 * Never creates Graph events unless confirmLive=true and Graph is configured.
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

  // Live Graph booking belongs on POST /api/calendar/event with confirmLive.
  // This cron only proposes (claim → dry-run release) for the human confirm path.
  if (parsed.data.confirmLive === true) {
    return NextResponse.json(
      {
        ok: false,
        status: "use_calendar_event_route",
        detail: "Live Teams/Outlook booking uses POST /api/calendar/event with confirmLive.",
      },
      { status: 400 },
    );
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, status: "service_unavailable" }, { status: 503 });
  }

  const [campaign, candidate] = await Promise.all([
    loadCampaignForLoop(svc, parsed.data.workspaceId, parsed.data.campaignId),
    loadCandidateForLoop(svc, parsed.data.workspaceId, parsed.data.candidateId),
  ]);
  if (!campaign || !candidate) {
    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  }

  const meetingKind = parsed.data.meetingKind ?? "first_interview";
  const window =
    parsed.data.startTime && parsed.data.endTime
      ? { startTime: parsed.data.startTime, endTime: parsed.data.endTime }
      : defaultMeetingWindow(meetingKind);

  const requestId = `loop-propose:${parsed.data.campaignId}:${parsed.data.candidateId}:${window.startTime}`;
  const claim = await claimCalendarBooking(svc, {
    workspaceId: parsed.data.workspaceId,
    candidateId: candidate.id,
    startTime: window.startTime,
    requestId: requestId.slice(0, 100),
    provider: "Microsoft Graph",
  });

  if (claim.status !== "claimed") {
    return NextResponse.json(
      { ok: false, status: claim.status, detail: "Calendar propose claim refused." },
      { status: claim.status === "dependency_unavailable" ? 503 : 409 },
    );
  }

  const roleTitle =
    campaign.jobAnalysis?.title?.trim() ||
    (typeof campaign.title === "string" ? campaign.title.trim() : "") ||
    "Interview";
  const agenda =
    meetingKind === "pre_call"
      ? mantuPreCallAgenda(roleTitle)
      : mantuFirstInterviewAgenda(roleTitle);

  // Default autonomous path: dry-run — release claim so humans can confirmLive later.
  // Do not return a released claimId as if it were still held for confirmLive.
  await reconcileCalendarBooking(svc, {
    workspaceId: parsed.data.workspaceId,
    id: claim.id,
    status: "released",
    detail: "dry-run_loop_propose",
  });
  return NextResponse.json({
    ok: true,
    status: "proposed_dry_run",
    bookingMode: "human_confirm_live",
    meetingKind,
    campaignId: campaign.id,
    candidateId: candidate.id,
    candidateName: candidate.name,
    startTime: window.startTime,
    endTime: window.endTime,
    agenda,
    claimId: null,
    releasedClaimId: claim.id,
    replay: claim.replay,
    requestId,
  });
}
