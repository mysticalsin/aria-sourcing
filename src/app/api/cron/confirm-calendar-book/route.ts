import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createGraphCalendarEvent, isTeamsMeetingJoinUrl } from "@/lib/calendar";
import { claimCalendarBooking, reconcileCalendarBooking } from "@/lib/calendar-authority";
import { decryptSecret, encryptSecret, encryptionRequiredButMissing } from "@/lib/crypto-secrets";
import { mantuFirstInterviewAgenda } from "@/lib/mantu-brand";
import { safeLog } from "@/lib/log-redact";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { Candidate, Campaign, EmailConnection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(100),
  startTime: z.string().min(1).max(40).optional(),
  endTime: z.string().min(1).max(40).optional(),
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

function defaultInterviewWindow(now = new Date()): { startTime: string; endTime: string } {
  const start = new Date(now);
  start.setUTCHours(10, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 1);
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
    start.setUTCDate(start.getUTCDate() + 1);
  }
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/**
 * Loop-side live Teams/Outlook book: service-role Graph create with OnlineMeetings.
 * Distinct from propose-calendar-book (dry-run claim/release) and from the
 * authenticated operator POST /api/calendar/event path.
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

  // Live book is Autopilot-only. Human confirmLive uses /api/calendar/event.
  const entitled = await svc
    .from("profiles")
    .select("id")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("autopilot_enabled", true)
    .in("role", ["admin", "member"])
    .limit(1)
    .maybeSingle();
  if (!entitled.data?.id) {
    return NextResponse.json({ ok: false, status: "autopilot_disarmed" }, { status: 409 });
  }
  const controls = await svc
    .from("sourcing_loop_controls")
    .select("kill_switch, sequences_enabled")
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();
  if (controls.data?.kill_switch !== false || controls.data?.sequences_enabled !== true) {
    return NextResponse.json({ ok: false, status: "autopilot_disarmed" }, { status: 409 });
  }

  const snapshot = await svc.rpc("read_workspace_state_for_loop", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const body = snapshot.data as {
    status?: string;
    state?: { campaigns?: Campaign[]; candidates?: Candidate[] };
  } | null;
  if (snapshot.error || body?.status !== "ok" || !body.state) {
    return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 503 });
  }

  const campaign = (body.state.campaigns ?? []).find((c) => c.id === parsed.data.campaignId);
  const candidate = (body.state.candidates ?? []).find((c) => c.id === parsed.data.candidateId);
  if (!campaign || !candidate) {
    return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
  }

  const { data: seats, error: seatErr } = await svc
    .from("agent_seats")
    .select("id, provider, mode, status, connected_account")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("provider", "Microsoft Graph")
    .eq("mode", "live")
    .eq("status", "active");
  if (seatErr) {
    return NextResponse.json({ ok: false, status: "seat_lookup_failed" }, { status: 503 });
  }
  const seat = (Array.isArray(seats) ? seats : []).find(
    (s: { connected_account?: string | null }) => Boolean(String(s.connected_account ?? "").trim()),
  ) as { id: string; provider: string } | undefined;
  if (!seat) {
    return NextResponse.json({
      ok: false,
      status: "no_live_graph_seat",
      detail: "Connect Outlook (mode=live) with OnlineMeetings before loop Teams book.",
    });
  }

  const { data: conn, error: connErr } = await svc
    .from("email_connections")
    .select("id, access_token, refresh_token, expires_at, scope, account_email, workspace_id")
    .eq("seat_id", seat.id)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("provider", "Microsoft Graph")
    .maybeSingle();
  if (connErr || !conn?.id || !conn.refresh_token) {
    return NextResponse.json({
      ok: false,
      status: "graph_connection_missing",
      detail: "Microsoft Graph mailbox connection required.",
    });
  }
  const scope = String(conn.scope ?? "");
  if (!/OnlineMeetings\.ReadWrite/i.test(scope) || !/Calendars\.ReadWrite/i.test(scope)) {
    return NextResponse.json({
      ok: false,
      status: "scope_insufficient",
      detail: "Reconnect Outlook with Calendars.ReadWrite and OnlineMeetings.ReadWrite.",
    });
  }

  const window =
    parsed.data.startTime && parsed.data.endTime
      ? { startTime: parsed.data.startTime, endTime: parsed.data.endTime }
      : defaultInterviewWindow();

  const roleTitle =
    campaign.jobAnalysis?.title?.trim() ||
    (typeof campaign.title === "string" ? campaign.title.trim() : "") ||
    "Interview";
  const agenda = mantuFirstInterviewAgenda(roleTitle);
  const requestId = `loop-confirm:${parsed.data.campaignId}:${parsed.data.candidateId}:${window.startTime}`.slice(
    0,
    100,
  );

  const claim = await claimCalendarBooking(svc, {
    workspaceId: parsed.data.workspaceId,
    candidateId: candidate.id,
    startTime: window.startTime,
    requestId,
    provider: "Microsoft Graph",
  });
  if (claim.status !== "claimed") {
    return NextResponse.json(
      { ok: false, status: claim.status, detail: "Calendar confirm claim refused." },
      { status: claim.status === "dependency_unavailable" ? 503 : 409 },
    );
  }
  if (claim.replay) {
    // Same requestId retry — never call Graph again; return the prior outcome.
    if (claim.bookingStatus === "confirmed") {
      // Confirmed without a Teams join URL is ledger corruption / orphan Graph —
      // never advertise created to the worker (it would treat a bare webLink as live).
      if (!claim.meetingUrl || !isTeamsMeetingJoinUrl(claim.meetingUrl)) {
        return NextResponse.json(
          {
            ok: false,
            status: "reconciliation_required",
            detail:
              "Prior confirmed claim is missing a Teams join URL. Do not retry until reconciled.",
            claimId: claim.id,
            eventId: claim.externalEventId ?? null,
          },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        status: "created",
        bookingMode: "loop_confirm_live",
        campaignId: campaign.id,
        candidateId: candidate.id,
        candidateName: candidate.name,
        startTime: window.startTime,
        endTime: window.endTime,
        agenda,
        claimId: claim.id,
        teamsLink: claim.meetingUrl,
        eventId: claim.externalEventId,
        seatId: seat.id,
        replay: true,
      });
    }
    if (claim.bookingStatus === "claimed") {
      // Prior attempt still unreconciled (in flight or unknown). Do not retry Graph.
      return NextResponse.json(
        {
          ok: false,
          status: "reconciliation_required",
          detail:
            "This booking request is already being processed or its outcome is unknown. Do not retry.",
          claimId: claim.id,
        },
        { status: 502 },
      );
    }
    // failed / released — retry needs a new requestId (new slot), not a replay.
    return NextResponse.json(
      {
        ok: false,
        status: "skipped",
        detail: "This booking request already failed. Retry with a new slot.",
        claimId: claim.id,
      },
      { status: 409 },
    );
  }

  const origAccessToken = decryptSecret(conn.access_token);
  const connection: EmailConnection = {
    id: conn.id,
    seatId: seat.id,
    provider: "Microsoft Graph",
    accountEmail: conn.account_email,
    accessToken: origAccessToken,
    refreshToken: conn.refresh_token ? decryptSecret(conn.refresh_token) : null,
    expiresAt: conn.expires_at,
    scope,
    connectedAt: "",
    updatedAt: "",
  };

  try {
    const outcome = await createGraphCalendarEvent(
      {
        candidateName: candidate.name,
        role: roleTitle,
        startTime: window.startTime,
        endTime: window.endTime,
        timezone: "UTC",
        candidateEmail: candidate.email ?? "",
        interviewerEmail: connection.accountEmail,
        agenda,
      },
      connection,
    );

    if (
      (origAccessToken !== connection.accessToken
        || conn.expires_at !== connection.expiresAt
        || (connection.scope ?? "") !== (conn.scope ?? ""))
      && !encryptionRequiredButMissing()
    ) {
      try {
        await svc
          .from("email_connections")
          .update({
            access_token: encryptSecret(connection.accessToken),
            expires_at: connection.expiresAt,
            scope: connection.scope ?? conn.scope,
            updated_at: new Date().toISOString(),
          })
          .eq("id", connection.id);
      } catch (persistErr) {
        safeLog("loop confirm calendar token persist error", {
          message: persistErr instanceof Error ? persistErr.message : "unknown",
        });
      }
    }

    if (outcome.ok) {
      if (!outcome.link || !isTeamsMeetingJoinUrl(outcome.link)) {
        return NextResponse.json(
          {
            ok: false,
            status: "reconciliation_required",
            detail: "Graph event may exist but Teams join URL is missing.",
            claimId: claim.id,
            eventId: outcome.eventId ?? null,
          },
          { status: 502 },
        );
      }

      const reconciled = await reconcileCalendarBooking(svc, {
        workspaceId: parsed.data.workspaceId,
        id: claim.id,
        status: "confirmed",
        externalEventId: outcome.eventId ?? null,
        meetingUrl: outcome.link,
        detail: outcome.detail,
      });
      if (reconciled.status !== "reconciled" || reconciled.bookingStatus !== "confirmed") {
        return NextResponse.json(
          {
            ok: false,
            status: "reconciliation_required",
            detail: "Calendar ledger could not confirm the Teams meeting.",
            claimId: claim.id,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        ok: true,
        status: "created",
        bookingMode: "loop_confirm_live",
        campaignId: campaign.id,
        candidateId: candidate.id,
        candidateName: candidate.name,
        startTime: window.startTime,
        endTime: window.endTime,
        agenda,
        claimId: claim.id,
        teamsLink: outcome.link,
        eventId: outcome.eventId ?? null,
        seatId: seat.id,
        replay: false,
      });
    }

    // Only proven pre-transport failures free the slot. deliveryState "unknown"
    // (or absent) leaves the claim in 'claimed' — never retry Graph.
    if (outcome.deliveryState === "not-sent") {
      await reconcileCalendarBooking(svc, {
        workspaceId: parsed.data.workspaceId,
        id: claim.id,
        status: "failed",
        detail: outcome.detail,
      });
      return NextResponse.json({
        ok: false,
        status: "skipped",
        detail: outcome.detail,
        claimId: claim.id,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        status: "reconciliation_required",
        detail: "Calendar provider acceptance is not yet reconciled. Do not retry.",
        claimId: claim.id,
      },
      { status: 502 },
    );
  } catch (err) {
    safeLog("loop confirm calendar error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      {
        ok: false,
        status: "reconciliation_required",
        detail: "Calendar provider acceptance is not yet reconciled. Do not retry.",
        claimId: claim.id,
      },
      { status: 502 },
    );
  }
}
