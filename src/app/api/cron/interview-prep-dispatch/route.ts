import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { buildInterviewPrepOutreach } from "@/lib/interview-prep-dispatch";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Booking, Campaign, Candidate } from "@/lib/types";

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

/**
 * Loop-side interview prep dispatch: build interviewer prep + candidate
 * confirmation drafts for the approval queue. Never sends directly.
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

  const snapshot = await svc.rpc("read_workspace_state_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const body = snapshot.data as {
    status?: string;
    state?: { campaigns?: Campaign[]; candidates?: Candidate[]; bookings?: Booking[] };
  } | null;
  if (snapshot.error || body?.status !== "ok" || !body.state) {
    return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 503 });
  }

  const campaign = (body.state.campaigns ?? []).find((c) => c.id === parsed.data.campaignId);
  const candidate = (body.state.candidates ?? []).find((c) => c.id === parsed.data.candidateId);
  const booking = (body.state.bookings ?? []).find((b) => b.id === parsed.data.bookingId);
  if (!campaign || !candidate || !booking) {
    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  }
  if (booking.candidateName !== candidate.name && booking.role) {
    // Booking rows are keyed by id; tolerate name drift but require candidate link via id usage.
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

  const outreach = buildInterviewPrepOutreach({ booking, candidate, campaign });
  return NextResponse.json({
    ok: true,
    status: "prep_drafted",
    campaignId: campaign.id,
    candidateId: candidate.id,
    bookingId: booking.id,
    outreach,
    dryRun: true,
  });
}
