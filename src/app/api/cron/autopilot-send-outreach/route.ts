import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getServiceSupabase } from "@/lib/supabase/server";
import { runAutopilotOutreachDispatch } from "@/lib/rei-autopilot-dispatch";
import type { ReiOutboundChannel } from "@/lib/rei-autopilot-send";
import { preferredOutreachChannel } from "@/lib/outreach-channel";
import { outreachDispatchRecipient } from "@/lib/outreach-recipient";
import type { OutreachMessage } from "@/lib/types";
import {
  loadCandidateForLoop,
  loadCandidateOutreachForLoop,
  loadOutreachMessageForLoop,
  loadReadyAutopilotOutreachSweep,
  mergeOutreachMessageScheduled,
} from "@/lib/workspace-loop-slices";

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
  /** True when message already lives in workspace (sweep / messageId) — patch Scheduled after queue. */
  persistScheduled: boolean;
};

async function targetFromMessage(
  svc: NonNullable<ReturnType<typeof getServiceSupabase>>,
  workspaceId: string,
  msg: OutreachMessage,
  persistScheduled: boolean,
): Promise<DispatchTarget | null> {
  const candidate = await loadCandidateForLoop(svc, workspaceId, msg.candidateId);
  if (!candidate) return null;
  const channel = (msg.channel ?? preferredOutreachChannel(candidate)) as ReiOutboundChannel;
  const recipient = outreachDispatchRecipient(msg, candidate).trim();
  // Interviewer prep without override → skip (do not Autopilot to candidate).
  if (!recipient) return null;
  return {
    messageId: msg.id,
    campaignId: msg.campaignId,
    candidateId: msg.candidateId,
    channel,
    subject: msg.subject,
    body: msg.body,
    recipient,
    qualityStatus: msg.qualityStatus ?? "unknown",
    criticsPassed: msg.qualityStatus === "ready" && msg.qualityCriticsUsed === true,
    persistScheduled,
  };
}

/**
 * Autopilot first-touch send — only when profiles.autopilot_enabled + sequences armed.
 * Mints autopilot_critics approval after critics already green on the draft, then
 * durable-queues Email / WhatsApp / LinkedIn (HeyReach).
 * Uses post-0074 slice RPCs (never full workspace blob).
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
  const workspaceId = parsed.data.workspaceId;

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
      persistScheduled: false,
    });
  } else if (parsed.data.messageId) {
    const msg = await loadOutreachMessageForLoop(svc, workspaceId, parsed.data.messageId);
    if (!msg) {
      return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
    }
    const target = await targetFromMessage(svc, workspaceId, msg, true);
    if (target) targets.push(target);
  } else if (parsed.data.campaignId && parsed.data.candidateId) {
    const msg = await loadCandidateOutreachForLoop(
      svc,
      workspaceId,
      parsed.data.campaignId,
      parsed.data.candidateId,
    );
    if (!msg) {
      return NextResponse.json({ ok: false, status: "not_found" }, { status: 404 });
    }
    const target = await targetFromMessage(svc, workspaceId, msg, true);
    if (target) targets.push(target);
  } else if (parsed.data.sweep) {
    const msgs = await loadReadyAutopilotOutreachSweep(svc, workspaceId, 20);
    for (const msg of msgs) {
      const target = await targetFromMessage(svc, workspaceId, msg, true);
      if (target) targets.push(target);
    }
  } else {
    return NextResponse.json({ ok: false, status: "invalid_request" }, { status: 400 });
  }

  const results: Array<{
    messageId: string;
    result: Awaited<ReturnType<typeof runAutopilotOutreachDispatch>>;
    workspacePatch?: string;
  }> = [];

  for (const target of targets) {
    const result = await runAutopilotOutreachDispatch(svc, {
      workspaceId,
      messageId: target.messageId,
      campaignId: target.campaignId,
      candidateId: target.candidateId,
      channel: target.channel,
      subject: target.subject,
      body: target.body,
      recipient: target.recipient,
      qualityStatus: target.qualityStatus,
      criticsPassed: target.criticsPassed,
    });
    let workspacePatch: string | undefined;
    if (
      target.persistScheduled &&
      (result.status === "sent" || result.status === "queued")
    ) {
      const patched = await mergeOutreachMessageScheduled(
        svc,
        workspaceId,
        target.messageId,
        result.status,
      );
      workspacePatch = patched.status;
    }
    results.push({ messageId: target.messageId, result, workspacePatch });
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
