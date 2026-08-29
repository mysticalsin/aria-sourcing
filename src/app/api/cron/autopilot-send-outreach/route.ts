import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getServiceSupabase } from "@/lib/supabase/server";
import { runAutopilotOutreachDispatch } from "@/lib/rei-autopilot-dispatch";
import type { ReiOutboundChannel } from "@/lib/rei-autopilot-send";
import { preferredOutreachChannel } from "@/lib/outreach-channel";
import type { Candidate, Campaign, OutreachMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  campaignId: z.string().min(1).max(120).optional(),
  candidateId: z.string().min(1).max(120).optional(),
  messageId: z.string().min(1).max(120).optional(),
  /** Inline draft — used by loop worker before workspace append. */
  channel: z.enum(["Email", "LinkedIn", "WhatsApp", "SMS"]).optional(),
  subject: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(50_000).optional(),
  recipient: z.string().min(1).max(500).optional(),
  qualityStatus: z.string().max(40).optional(),
  criticsPassed: z.boolean().optional(),
  /** When true, sweep Needs Approval drafts in the workspace (capped). */
  sweep: z.boolean().optional(),
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

function recipientFor(channel: ReiOutboundChannel, candidate: Candidate): string {
  if (channel === "WhatsApp" || channel === "SMS") return candidate.phone ?? "";
  if (channel === "LinkedIn") return candidate.linkedinUrl ?? "";
  return candidate.email ?? "";
}

type DispatchTarget = {
  messageId: string;
  campaignId: string;
  candidateId: string;
  channel: ReiOutboundChannel;
  subject: string;
  body: string;
  recipient: string;
  qualityStatus: string;
  criticsPassed: boolean;
};

/**
 * Autopilot first-touch send — only when profiles.autopilot_enabled + sequences armed.
 * Mints autopilot_critics approval after critics already green on the draft, then
 * durable-queues Email / WhatsApp / LinkedIn (HeyReach).
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

  const targets: DispatchTarget[] = [];

  // Fast path: worker passes the just-generated draft inline (before workspace append).
  if (
    parsed.data.messageId &&
    parsed.data.campaignId &&
    parsed.data.candidateId &&
    parsed.data.channel &&
    parsed.data.subject &&
    parsed.data.body &&
    parsed.data.recipient
  ) {
    targets.push({
      messageId: parsed.data.messageId,
      campaignId: parsed.data.campaignId,
      candidateId: parsed.data.candidateId,
      channel: parsed.data.channel,
      subject: parsed.data.subject,
      body: parsed.data.body,
      recipient: parsed.data.recipient,
      qualityStatus: parsed.data.qualityStatus ?? "",
      criticsPassed: parsed.data.criticsPassed === true,
    });
  } else {
    const snapshot = await svc.rpc("read_workspace_state_for_loop", {
      p_workspace_id: parsed.data.workspaceId,
    });
    const body = snapshot.data as {
      status?: string;
      state?: {
        campaigns?: Campaign[];
        candidates?: Candidate[];
        outreach?: OutreachMessage[];
      };
    } | null;
    if (snapshot.error || body?.status !== "ok" || !body.state) {
      return NextResponse.json({ ok: false, status: "workspace_unavailable" }, { status: 503 });
    }

    const outreach = body.state.outreach ?? [];
    const candidates = body.state.candidates ?? [];
    const msgs: OutreachMessage[] = [];

    if (parsed.data.messageId) {
      const msg = outreach.find((m) => m.id === parsed.data.messageId);
      if (!msg) {
        return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
      }
      msgs.push(msg);
    } else if (parsed.data.campaignId && parsed.data.candidateId) {
      const msg = outreach
        .filter(
          (m) =>
            m.campaignId === parsed.data.campaignId &&
            m.candidateId === parsed.data.candidateId &&
            (m.status === "Needs Approval" || m.status === "Draft"),
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      if (!msg) {
        return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
      }
      msgs.push(msg);
    } else if (parsed.data.sweep) {
      msgs.push(...outreach.filter((m) => m.status === "Needs Approval").slice(0, 20));
    } else {
      return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
    }

    for (const msg of msgs) {
      const candidate = candidates.find((c) => c.id === msg.candidateId);
      if (!candidate) continue;
      const channel = (msg.channel ?? preferredOutreachChannel(candidate)) as ReiOutboundChannel;
      targets.push({
        messageId: msg.id,
        campaignId: msg.campaignId,
        candidateId: msg.candidateId,
        channel,
        subject: msg.subject,
        body: msg.body,
        recipient: recipientFor(channel, candidate),
        qualityStatus: msg.qualityStatus ?? "unknown",
        criticsPassed:
          msg.qualityStatus === "ready" && msg.qualityCriticsUsed === true,
      });
    }
  }

  const results: Array<{ messageId: string; result: Awaited<ReturnType<typeof runAutopilotOutreachDispatch>> }> =
    [];

  for (const target of targets) {
    const result = await runAutopilotOutreachDispatch(svc, {
      workspaceId: parsed.data.workspaceId,
      ...target,
    });
    results.push({ messageId: target.messageId, result });
  }

  const sent = results.filter((r) => r.result.status === "sent" || r.result.status === "queued").length;
  const skipped = results.filter((r) => r.result.status === "skipped").length;
  const errors = results.filter((r) => r.result.status === "error").length;

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    errors,
    results,
  });
}

/** Daily/backstop probe — same auth as other crons. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    detail: "POST with workspaceId + inline draft or messageId|sweep for autopilot send.",
  });
}
