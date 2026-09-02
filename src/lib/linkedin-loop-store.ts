// Persistence boundary for the LinkedIn reply loop. The ingest and dispatch
// modules only ever talk to this interface, so the fail-closed decisions are
// unit-tested against an in-memory store while the Supabase implementation
// below binds them to messages_inbound, agent_conversations, messages_outbound
// and the 0055 loop authority RPCs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeLog } from "@/lib/log-redact";
import { loopDayStart, type LoopControls, type LoopGrant } from "@/lib/linkedin-loop";

export interface LoopGrantRow extends LoopGrant {
  workspaceId: string;
  /** 'replies' answers inbound only; 'campaign' also covers the launched first touches (0057). */
  scope: "replies" | "campaign";
  seatId: string;
  calendarSeatId: string | null;
  vendorCampaignId: string | null;
  interviewerEmail: string;
  roleTitle: string;
}

export interface LoopInboundInsert {
  workspaceId: string;
  profileUrl: string;
  body: string;
  providerId: string;
  receivedAt: string;
  campaignId: string;
}

export interface LoopThread {
  conversationId: string;
  candidateId: string;
  candidateName: string;
  seatId: string | null;
  specId: string | null;
  ownerId: string | null;
  lastOutboundBody: string;
  roleBrief: unknown;
}

export interface LoopReplyInsert {
  workspaceId: string;
  grantId: string;
  inboundId: string;
  conversationId: string;
  campaignId: string;
  candidateId: string;
  seatId: string | null;
  specId: string | null;
  ownerId: string | null;
  profileUrl: string;
  body: string;
  status: "queued" | "blocked";
  gateResult: unknown;
  dedupeHash: string;
  scheduledAt: string | null;
}

export interface LoopQueuedReply {
  id: string;
  workspaceId: string;
  grantId: string;
  candidateId: string;
  seatId: string | null;
  specId: string | null;
  profileUrl: string;
  subject: string;
  body: string;
  scheduledAt: string;
}

export type WriteResult = { ok: true; id: string } | { ok: false; duplicate: true } | { ok: false; error: string };

export interface LoopClaim {
  allowed: boolean;
  reason?: string;
  deliveryAttemptId?: string;
  profileUrl?: string;
}

export interface LinkedInLoopStore {
  findGrantForInbound(input: { vendorCampaignId: string | null }): Promise<LoopGrantRow | null>;
  getGrant(grantId: string): Promise<LoopGrantRow | null>;
  readControls(workspaceId: string): Promise<LoopControls | null>;
  insertInbound(row: LoopInboundInsert): Promise<WriteResult>;
  markInbound(
    inboundId: string,
    patch: { processed: boolean; reason?: string | null; conversationId?: string | null },
  ): Promise<boolean>;
  /** Thread identity comes from the latest LinkedIn outbound Aria sent to this
   *  profile inside this campaign. Never guessed from the bare URL. */
  resolveThread(workspaceId: string, campaignId: string, profileUrl: string): Promise<LoopThread | null>;
  isSuppressed(workspaceId: string, profileUrl: string): Promise<boolean>;
  recordOptOut(workspaceId: string, profileUrl: string, evidence: { providerId: string; at: string }): Promise<boolean>;
  cancelQueuedReplies(workspaceId: string, profileUrl: string): Promise<boolean>;
  /** Attempts on the grant's local day (its timezone), not the UTC day. */
  countAttemptsToday(grant: LoopGrant, now: Date): Promise<number | null>;
  /** Every LinkedIn message claimed or sent in the workspace's local day:
   *  first touches (outreach_ledger) plus loop replies (linkedin_reply_attempts). */
  countWorkspaceMessagesToday(workspaceId: string, timezone: string, now: Date): Promise<number | null>;
  insertReply(row: LoopReplyInsert): Promise<WriteResult>;
  listDueReplies(now: Date, limit: number): Promise<LoopQueuedReply[] | null>;
  readSeat(workspaceId: string, seatId: string): Promise<{ provider: string; status: string; mode: string } | null>;
  readRoleBrief(workspaceId: string, specId: string): Promise<unknown>;
  updateReply(
    replyId: string,
    patch: { status?: "blocked" | "failed"; gateResult?: unknown; scheduledAt?: string },
  ): Promise<boolean>;
  claimReply(replyId: string): Promise<LoopClaim | null>;
  recordOutcome(
    replyId: string,
    deliveryAttemptId: string,
    outcome: "sent" | "skipped" | "ambiguous",
    reason: string | null,
    providerMessageId: string | null,
  ): Promise<boolean>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function grantFromRow(row: Record<string, unknown> | null): LoopGrantRow | null {
  if (!row || typeof row.id !== "string" || typeof row.workspace_id !== "string") return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    scope: row.scope === "campaign" ? "campaign" : "replies",
    channel: row.channel === "WhatsApp" ? "WhatsApp" : "LinkedIn",
    campaignId: text(row.campaign_id),
    vendorCampaignId: typeof row.vendor_campaign_id === "string" && row.vendor_campaign_id ? row.vendor_campaign_id : null,
    seatId: text(row.seat_id),
    calendarSeatId: typeof row.calendar_seat_id === "string" && row.calendar_seat_id ? row.calendar_seat_id : null,
    interviewerEmail: text(row.interviewer_email),
    roleTitle: text(row.role_title),
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    dailyCap: typeof row.daily_cap === "number" ? row.daily_cap : 0,
    quietStart: typeof row.quiet_start === "number" ? row.quiet_start : 21,
    quietEnd: typeof row.quiet_end === "number" ? row.quiet_end : 8,
    timezone: text(row.timezone, "UTC") || "UTC",
  };
}

const GRANT_COLUMNS =
  "id, workspace_id, scope, channel, campaign_id, vendor_campaign_id, seat_id, calendar_seat_id, interviewer_email, role_title, revoked_at, daily_cap, quiet_start, quiet_end, timezone";

export function supabaseLinkedInLoopStore(supabase: SupabaseClient): LinkedInLoopStore {
  return {
    async findGrantForInbound({ vendorCampaignId }) {
      if (!vendorCampaignId) return null;
      // Newest grant wins so a re-launch after a revoke resolves to the live
      // one; a revoked-only history still resolves (and then holds) so the
      // inbound is stored for the operator instead of vanishing.
      const { data, error } = await supabase
        .from("linkedin_reply_grants")
        .select(GRANT_COLUMNS)
        .eq("vendor_campaign_id", vendorCampaignId)
        .order("revoked_at", { ascending: true, nullsFirst: true })
        .order("granted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        safeLog("linkedin loop: grant lookup error", { message: error.message });
        return null;
      }
      return grantFromRow(record(data));
    },
    async getGrant(grantId) {
      const { data, error } = await supabase.from("linkedin_reply_grants").select(GRANT_COLUMNS).eq("id", grantId).maybeSingle();
      if (error) {
        safeLog("linkedin loop: grant read error", { message: error.message });
        return null;
      }
      return grantFromRow(record(data));
    },
    async readControls(workspaceId) {
      const { data, error } = await supabase
        .from("sourcing_loop_controls")
        .select("kill_switch, linkedin_reply_loop_enabled, linkedin_daily_message_cap, linkedin_daily_connect_cap, linkedin_timezone")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        safeLog("linkedin loop: controls lookup error", { message: error.message });
        return null;
      }
      const row = record(data);
      if (!row) return null;
      return {
        killSwitch: row.kill_switch !== false,
        loopEnabled: row.linkedin_reply_loop_enabled === true,
        messageCap: typeof row.linkedin_daily_message_cap === "number" ? row.linkedin_daily_message_cap : 0,
        connectCap: typeof row.linkedin_daily_connect_cap === "number" ? row.linkedin_daily_connect_cap : 0,
        timezone: text(row.linkedin_timezone, "UTC") || "UTC",
      };
    },
    async insertInbound(row) {
      const { data, error } = await supabase
        .from("messages_inbound")
        .insert({
          workspace_id: row.workspaceId,
          channel: "LinkedIn",
          from_address: row.profileUrl,
          body: row.body,
          provider_id: row.providerId,
          received_at: row.receivedAt,
          campaign_id: row.campaignId,
          processed: false,
        })
        .select("id")
        .maybeSingle();
      if (error?.code === "23505") return { ok: false, duplicate: true };
      if (error || typeof data?.id !== "string") return { ok: false, error: error?.message ?? "no-id" };
      return { ok: true, id: data.id };
    },
    async markInbound(inboundId, patch) {
      const update: Record<string, unknown> = { processed: patch.processed };
      if (patch.reason !== undefined) update.last_processing_error = patch.reason;
      if (patch.conversationId !== undefined) update.conversation_id = patch.conversationId;
      const { error } = await supabase.from("messages_inbound").update(update).eq("id", inboundId);
      if (error) safeLog("linkedin loop: inbound update error", { message: error.message });
      return !error;
    },
    async resolveThread(workspaceId, campaignId, profileUrl) {
      const { data: outbound, error: outboundErr } = await supabase
        .from("messages_outbound")
        .select("candidate_id, seat_id, spec_id, owner_id, body")
        .eq("workspace_id", workspaceId)
        .eq("channel", "LinkedIn")
        .eq("to_address", profileUrl)
        .in("status", ["sent", "dispatching"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (outboundErr) {
        safeLog("linkedin loop: thread lookup error", { message: outboundErr.message });
        return null;
      }
      const row = record(outbound);
      if (!row || typeof row.candidate_id !== "string" || !row.candidate_id) return null;
      const { data: convo, error: convoErr } = await supabase
        .from("agent_conversations")
        .upsert(
          {
            workspace_id: workspaceId,
            channel: "LinkedIn",
            provider_thread_key: `${campaignId}:${profileUrl}`,
            candidate_id: row.candidate_id,
            spec_id: typeof row.spec_id === "string" ? row.spec_id : null,
            last_inbound_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,channel,provider_thread_key" },
        )
        .select("id")
        .maybeSingle();
      if (convoErr || typeof convo?.id !== "string") {
        safeLog("linkedin loop: conversation upsert error", { message: convoErr?.message ?? "no-id" });
        return null;
      }
      let roleBrief: unknown = null;
      if (typeof row.spec_id === "string" && row.spec_id) {
        const { data: spec } = await supabase
          .from("agent_specs")
          .select("role_brief")
          .eq("id", row.spec_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        roleBrief = record(spec)?.role_brief ?? null;
      }
      return {
        conversationId: convo.id,
        candidateId: row.candidate_id,
        candidateName: "",
        seatId: typeof row.seat_id === "string" ? row.seat_id : null,
        specId: typeof row.spec_id === "string" ? row.spec_id : null,
        ownerId: typeof row.owner_id === "string" ? row.owner_id : null,
        lastOutboundBody: text(row.body),
        roleBrief,
      };
    },
    async isSuppressed(workspaceId, profileUrl) {
      const { data, error } = await supabase
        .from("suppression_list")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("type", "linkedin")
        .eq("value", profileUrl)
        .limit(1);
      if (error) {
        safeLog("linkedin loop: suppression lookup error", { message: error.message });
        return true;
      }
      return Array.isArray(data) && data.length > 0;
    },
    async recordOptOut(workspaceId, profileUrl, evidence) {
      const { error } = await supabase.from("suppression_list").upsert(
        {
          workspace_id: workspaceId,
          type: "linkedin",
          value: profileUrl,
          reason: "Candidate asked to stop on LinkedIn.",
          source: `LinkedIn candidate message ${evidence.providerId} at ${evidence.at}`,
        },
        { onConflict: "workspace_id,type,value" },
      );
      if (error) safeLog("linkedin loop: opt-out write error", { message: error.message });
      return !error;
    },
    async cancelQueuedReplies(workspaceId, profileUrl) {
      const { error } = await supabase
        .from("messages_outbound")
        .update({ status: "blocked", gate_result: { pass: false, reasons: ["linkedin:opted-out"] } })
        .eq("workspace_id", workspaceId)
        .eq("channel", "LinkedIn")
        .eq("to_address", profileUrl)
        .not("linkedin_reply_grant_id", "is", null)
        .in("status", ["composed", "queued"]);
      if (error) safeLog("linkedin loop: opt-out cancellation error", { message: error.message });
      return !error;
    },
    async countAttemptsToday(grant, now) {
      const dayStart = loopDayStart(now, grant.timezone);
      const { count, error } = await supabase
        .from("linkedin_reply_attempts")
        .select("id", { count: "exact", head: true })
        .eq("grant_id", grant.id)
        .in("status", ["claimed", "sent", "ambiguous"])
        .gte("at", dayStart.toISOString());
      if (error) {
        safeLog("linkedin loop: attempt count error", { message: error.message });
        return null;
      }
      return count ?? 0;
    },
    async countWorkspaceMessagesToday(workspaceId, timezone, now) {
      const dayStart = loopDayStart(now, timezone).toISOString();
      const [firstTouch, replies] = await Promise.all([
        supabase
          .from("outreach_ledger")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("channel", "LinkedIn")
          .in("status", ["claimed", "sent", "ambiguous"])
          .gte("at", dayStart),
        supabase
          .from("linkedin_reply_attempts")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .in("status", ["claimed", "sent", "ambiguous"])
          .gte("at", dayStart),
      ]);
      if (firstTouch.error || replies.error) {
        safeLog("linkedin loop: workspace message count error", {
          message: firstTouch.error?.message ?? replies.error?.message ?? "unknown",
        });
        return null;
      }
      return (firstTouch.count ?? 0) + (replies.count ?? 0);
    },
    async insertReply(row) {
      const { data, error } = await supabase
        .from("messages_outbound")
        .insert({
          workspace_id: row.workspaceId,
          owner_id: row.ownerId,
          inbound_message_id: row.inboundId,
          conversation_id: row.conversationId,
          spec_id: row.specId,
          candidate_id: row.candidateId,
          seat_id: row.seatId,
          channel: "LinkedIn",
          to_address: row.profileUrl,
          type: "candidate_reply",
          subject: "",
          body: row.body,
          status: row.status,
          gate_result: row.gateResult,
          dedupe_hash: row.dedupeHash,
          scheduled_at: row.scheduledAt,
          campaign_id: row.campaignId,
          linkedin_reply_grant_id: row.grantId,
        })
        .select("id")
        .maybeSingle();
      if (error?.code === "23505") return { ok: false, duplicate: true };
      if (error || typeof data?.id !== "string") return { ok: false, error: error?.message ?? "no-id" };
      return { ok: true, id: data.id };
    },
    async listDueReplies(now, limit) {
      const { data, error } = await supabase
        .from("messages_outbound")
        .select("id, workspace_id, linkedin_reply_grant_id, candidate_id, seat_id, spec_id, to_address, subject, body, scheduled_at")
        .eq("status", "queued")
        .eq("channel", "LinkedIn")
        .not("linkedin_reply_grant_id", "is", null)
        .lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(limit);
      if (error) {
        safeLog("linkedin loop: due select error", { message: error.message });
        return null;
      }
      const rows: LoopQueuedReply[] = [];
      for (const raw of data ?? []) {
        const row = record(raw);
        if (!row || typeof row.id !== "string" || typeof row.linkedin_reply_grant_id !== "string") continue;
        rows.push({
          id: row.id,
          workspaceId: text(row.workspace_id),
          grantId: row.linkedin_reply_grant_id,
          candidateId: text(row.candidate_id),
          seatId: typeof row.seat_id === "string" ? row.seat_id : null,
          specId: typeof row.spec_id === "string" ? row.spec_id : null,
          profileUrl: text(row.to_address),
          subject: text(row.subject),
          body: text(row.body),
          scheduledAt: text(row.scheduled_at),
        });
      }
      return rows;
    },
    async readSeat(workspaceId, seatId) {
      const { data, error } = await supabase
        .from("agent_seats")
        .select("id, provider, status, mode")
        .eq("id", seatId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) {
        safeLog("linkedin loop: seat lookup error", { message: error.message });
        return null;
      }
      const row = record(data);
      if (!row) return null;
      return { provider: text(row.provider), status: text(row.status), mode: text(row.mode) };
    },
    async readRoleBrief(workspaceId, specId) {
      const { data } = await supabase
        .from("agent_specs")
        .select("role_brief")
        .eq("id", specId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return record(data)?.role_brief ?? null;
    },
    async updateReply(replyId, patch) {
      const update: Record<string, unknown> = {};
      if (patch.status) update.status = patch.status;
      if (patch.gateResult !== undefined) update.gate_result = patch.gateResult;
      if (patch.scheduledAt) update.scheduled_at = patch.scheduledAt;
      const { error } = await supabase.from("messages_outbound").update(update).eq("id", replyId).eq("status", "queued");
      if (error) safeLog("linkedin loop: reply update error", { message: error.message });
      return !error;
    },
    async claimReply(replyId) {
      const { data, error } = await supabase.rpc("claim_linkedin_loop_reply", { p_message_id: replyId });
      if (error) {
        safeLog("linkedin loop: claim error", { message: error.message });
        return null;
      }
      const row = record(data);
      if (!row) return null;
      return {
        allowed: row.allowed === true,
        reason: typeof row.reason === "string" ? row.reason : undefined,
        deliveryAttemptId: typeof row.delivery_attempt_id === "string" ? row.delivery_attempt_id : undefined,
        profileUrl: typeof row.profile_url === "string" ? row.profile_url : undefined,
      };
    },
    async recordOutcome(replyId, deliveryAttemptId, outcome, reason, providerMessageId) {
      const { data, error } = await supabase.rpc("record_linkedin_loop_outcome", {
        p_message_id: replyId,
        p_delivery_attempt_id: deliveryAttemptId,
        p_outcome: outcome,
        p_reason: reason,
        p_provider_message_id: providerMessageId,
      });
      if (error) {
        safeLog("linkedin loop: outcome reconciliation error", { message: error.message });
        return false;
      }
      return record(data)?.allowed === true;
    },
  };
}
