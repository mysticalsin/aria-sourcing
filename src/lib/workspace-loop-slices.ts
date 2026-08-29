/**
 * Bounded workspace reads for loop/cron paths after migration 0074
 * (read_workspace_state_for_loop returns revision only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Booking, Campaign, Candidate, OutreachMessage } from "@/lib/types";

type ServiceClient = SupabaseClient;

export async function loadCampaignForLoop(
  svc: ServiceClient,
  workspaceId: string,
  campaignId: string,
): Promise<Campaign | null> {
  const res = await svc.rpc("read_workspace_campaign_for_loop", {
    p_workspace_id: workspaceId,
    p_campaign_id: campaignId,
  });
  const body = res.data as { status?: string; campaign?: Campaign } | null;
  if (res.error || body?.status !== "ok" || !body.campaign) return null;
  return body.campaign;
}

export async function loadCandidateForLoop(
  svc: ServiceClient,
  workspaceId: string,
  candidateId: string,
): Promise<Candidate | null> {
  const res = await svc.rpc("read_workspace_candidates_for_loop", {
    p_workspace_id: workspaceId,
    p_candidate_ids: [candidateId],
  });
  const body = res.data as { status?: string; candidates?: Candidate[] } | null;
  if (res.error || body?.status !== "ok" || !Array.isArray(body.candidates)) return null;
  return body.candidates.find((c) => c.id === candidateId) ?? null;
}

export async function loadBookingForLoop(
  svc: ServiceClient,
  workspaceId: string,
  bookingId: string,
): Promise<Booking | null> {
  const res = await svc.rpc("read_workspace_booking_for_loop", {
    p_workspace_id: workspaceId,
    p_booking_id: bookingId,
  });
  const body = res.data as { status?: string; booking?: Booking } | null;
  if (res.error || body?.status !== "ok" || !body.booking) return null;
  return body.booking;
}

export async function loadSkillsForLoop(
  svc: ServiceClient,
  workspaceId: string,
): Promise<import("@/lib/types").AgentSkill[] | null> {
  const res = await svc.rpc("read_workspace_skills_for_loop", {
    p_workspace_id: workspaceId,
  });
  const body = res.data as { status?: string; skills?: import("@/lib/types").AgentSkill[] } | null;
  if (res.error || body?.status !== "ok") return null;
  return Array.isArray(body.skills) ? body.skills : [];
}

export async function loadOutreachMessageForLoop(
  svc: ServiceClient,
  workspaceId: string,
  messageId: string,
): Promise<OutreachMessage | null> {
  const res = await svc.rpc("read_workspace_outreach_for_loop", {
    p_workspace_id: workspaceId,
    p_message_id: messageId,
    p_ready_sweep: false,
    p_limit: 1,
  });
  const body = res.data as { status?: string; outreach?: OutreachMessage[] } | null;
  if (res.error || body?.status !== "ok" || !Array.isArray(body.outreach)) return null;
  return body.outreach.find((m) => m.id === messageId) ?? null;
}

export async function loadCandidateOutreachForLoop(
  svc: ServiceClient,
  workspaceId: string,
  campaignId: string,
  candidateId: string,
): Promise<OutreachMessage | null> {
  const res = await svc.rpc("read_workspace_candidate_outreach_for_loop", {
    p_workspace_id: workspaceId,
    p_campaign_id: campaignId,
    p_candidate_id: candidateId,
  });
  const body = res.data as { status?: string; outreach?: OutreachMessage } | null;
  if (res.error || body?.status !== "ok" || !body.outreach) return null;
  return body.outreach;
}

export type ReadyAutopilotSweepLoad =
  | { ok: true; outreach: OutreachMessage[] }
  | { ok: false; status: string; detail?: string };

export async function loadReadyAutopilotOutreachSweep(
  svc: ServiceClient,
  workspaceId: string,
  limit = 20,
): Promise<ReadyAutopilotSweepLoad> {
  const res = await svc.rpc("read_workspace_outreach_for_loop", {
    p_workspace_id: workspaceId,
    p_message_id: null,
    p_ready_sweep: true,
    p_limit: limit,
  });
  if (res.error) {
    return { ok: false, status: "sweep_rpc_error", detail: res.error.message };
  }
  const body = res.data as { status?: string; outreach?: OutreachMessage[] } | null;
  if (!body || body.status !== "ok") {
    return {
      ok: false,
      status: "sweep_read_failed",
      detail: typeof body?.status === "string" ? body.status : "invalid_response",
    };
  }
  return { ok: true, outreach: Array.isArray(body.outreach) ? body.outreach : [] };
}

/** After durable queue, flip workspace outreach row to Scheduled (sweep honesty). */
export async function mergeOutreachMessageScheduled(
  svc: ServiceClient,
  workspaceId: string,
  messageId: string,
  outcome: "sent" | "queued",
): Promise<{ ok: boolean; status: string }> {
  const now = new Date().toISOString();
  const patch = {
    id: messageId,
    patch: {
      status: "Scheduled",
      dryRun: false,
      scheduledFor: now,
      ...(outcome === "sent" ? { sentAt: now } : {}),
    },
  };
  const receiptKey = `autopilot_sched:${messageId}:${outcome}`;

  // One stale-token retry — sweep may patch several messages in one tick.
  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = await svc.rpc("read_workspace_state_for_loop", {
      p_workspace_id: workspaceId,
    });
    const rev = revision.data as { status?: string; updated_at?: string } | null;
    if (revision.error || rev?.status !== "ok" || typeof rev.updated_at !== "string") {
      return { ok: false, status: "revision_unavailable" };
    }
    const patched = await svc.rpc("apply_workspace_patch", {
      p_workspace_id: workspaceId,
      p_expected_updated_at: rev.updated_at,
      p_patch_kind: "merge_outreach_message",
      p_patch: patch,
      p_receipt_key: receiptKey,
    });
    const status =
      patched.data && typeof patched.data === "object" && "status" in patched.data
        ? String((patched.data as { status: string }).status)
        : "";
    if (patched.error) return { ok: false, status: patched.error.message };
    if (status === "applied" || status === "already_applied") return { ok: true, status };
    if (status === "stale_token" && attempt === 0) continue;
    return { ok: false, status: status || "patch_failed" };
  }
  return { ok: false, status: "stale_token" };
}
