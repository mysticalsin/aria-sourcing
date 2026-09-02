// Persistence boundary for the LinkedIn connect primitive (plan S5). The
// campaign dispatcher and the accepted-event ingest talk to this interface;
// the in-memory store in tests/linkedin-connect.mts proves the fail-closed
// decisions, the Supabase implementation below binds them to messages_outbound
// rows of type 'connection_request', the 0056 connect ledger, the 0059 event
// table and the 0059 claim and outcome RPCs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeLog } from "@/lib/log-redact";
import { loopDayStart } from "@/lib/linkedin-loop";
import {
  supabaseLinkedInLoopStore,
  type LinkedInLoopStore,
  type LoopClaim,
  type WriteResult,
} from "@/lib/linkedin-loop-store";

/** A queued connection request whose scheduled time has passed. */
export interface QueuedConnect {
  id: string;
  workspaceId: string;
  candidateId: string;
  seatId: string | null;
  specId: string | null;
  profileUrl: string;
  /** The connection note exactly as approved (may be empty). */
  note: string;
  /** The approval row the launch wrote for this note (0057 binds it to the grant). */
  approvalMessageId: string;
  scheduledAt: string;
}

export interface LaunchApproval {
  /** The launch that approved the draft; null means the approval was not written by a launch. */
  grantId: string | null;
  revokedAt: string | null;
}

/** A row of the connect ledger, as the accepted-event ingest reads it. */
export interface ConnectAttemptRow {
  workspaceId: string;
  grantId: string;
  candidateId: string;
  profileUrl: string;
  status: "claimed" | "sent" | "skipped" | "ambiguous";
}

export interface ConnectEventInsert {
  workspaceId: string;
  grantId: string | null;
  profileUrl: string;
  providerId: string;
  receivedAt: string;
}

export type FirstMessageSchedule =
  | { ok: true; id: string }
  | { ok: false; reason: "no-first-message-draft" | "draft-not-launched" | "already-scheduled" | "already-sent" | "write-failed" };

export interface LinkedInConnectStore
  extends Pick<
    LinkedInLoopStore,
    "readControls" | "getGrant" | "readSeat" | "readRoleBrief" | "isSuppressed" | "countWorkspaceMessagesToday" | "findGrantForInbound"
  > {
  listDueConnects(now: Date, limit: number): Promise<QueuedConnect[] | null>;
  /** The approval row for a shown draft. null on a read error or when no approval exists. */
  readLaunchApproval(workspaceId: string, messageId: string): Promise<LaunchApproval | null>;
  /** Connection requests claimed or sent in the workspace's local day. */
  countWorkspaceConnectsToday(workspaceId: string, timezone: string, now: Date): Promise<number | null>;
  updateConnect(
    connectId: string,
    patch: { status?: "blocked" | "failed"; gateResult?: unknown; scheduledAt?: string },
  ): Promise<boolean>;
  claimConnect(connectId: string): Promise<LoopClaim | null>;
  recordConnectOutcome(
    connectId: string,
    deliveryAttemptId: string,
    outcome: "sent" | "skipped" | "ambiguous",
    reason: string | null,
    providerRequestId: string | null,
  ): Promise<boolean>;
  /** Every open or sent connection request for a profile, across workspaces:
   *  the vendor webhook carries no tenant, the ledger is how one is found. */
  findConnectAttempts(profileUrl: string): Promise<ConnectAttemptRow[] | null>;
  insertConnectEvent(row: ConnectEventInsert): Promise<WriteResult>;
  markConnectEvent(
    eventId: string,
    patch: { status: "held" | "scheduled"; reason?: string | null; outboundMessageId?: string | null },
  ): Promise<boolean>;
  /** Queue the first message the launch approved for this person: the composed
   *  first-touch row for the campaign and profile becomes queued at
   *  `scheduledAt`. Never creates a row, never touches one the launch did not approve. */
  scheduleFirstMessageAfterAccept(input: {
    workspaceId: string;
    grantId: string;
    campaignId: string;
    profileUrl: string;
    scheduledAt: string;
  }): Promise<FirstMessageSchedule>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function supabaseLinkedInConnectStore(supabase: SupabaseClient): LinkedInConnectStore {
  const loop = supabaseLinkedInLoopStore(supabase);
  return {
    readControls: loop.readControls,
    getGrant: loop.getGrant,
    readSeat: loop.readSeat,
    readRoleBrief: loop.readRoleBrief,
    isSuppressed: loop.isSuppressed,
    countWorkspaceMessagesToday: loop.countWorkspaceMessagesToday,
    findGrantForInbound: loop.findGrantForInbound,

    async listDueConnects(now, limit) {
      const { data, error } = await supabase
        .from("messages_outbound")
        .select("id, workspace_id, candidate_id, seat_id, spec_id, to_address, body, approval_message_id, scheduled_at")
        .eq("status", "queued")
        .eq("channel", "LinkedIn")
        .eq("type", "connection_request")
        .is("linkedin_reply_grant_id", null)
        .lte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(limit);
      if (error) {
        safeLog("linkedin connect: due select error", { message: error.message });
        return null;
      }
      const rows: QueuedConnect[] = [];
      for (const raw of data ?? []) {
        const row = record(raw);
        if (!row || typeof row.id !== "string") continue;
        rows.push({
          id: row.id,
          workspaceId: text(row.workspace_id),
          candidateId: text(row.candidate_id),
          seatId: typeof row.seat_id === "string" ? row.seat_id : null,
          specId: typeof row.spec_id === "string" ? row.spec_id : null,
          profileUrl: text(row.to_address),
          note: text(row.body),
          // Same fallback as the SQL coalesce: only a null approval id means the row's own id.
          approvalMessageId: typeof row.approval_message_id === "string" ? row.approval_message_id : row.id,
          scheduledAt: text(row.scheduled_at),
        });
      }
      return rows;
    },
    async readLaunchApproval(workspaceId, messageId) {
      const { data, error } = await supabase
        .from("outreach_approvals")
        .select("linkedin_reply_grant_id, revoked_at")
        .eq("workspace_id", workspaceId)
        .eq("message_id", messageId)
        .maybeSingle();
      if (error) {
        safeLog("linkedin connect: approval lookup error", { message: error.message });
        return null;
      }
      const row = record(data);
      if (!row) return null;
      return {
        grantId: typeof row.linkedin_reply_grant_id === "string" && row.linkedin_reply_grant_id ? row.linkedin_reply_grant_id : null,
        revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      };
    },
    async countWorkspaceConnectsToday(workspaceId, timezone, now) {
      const dayStart = loopDayStart(now, timezone).toISOString();
      const { count, error } = await supabase
        .from("linkedin_connect_attempts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("status", ["claimed", "sent", "ambiguous"])
        .gte("at", dayStart);
      if (error) {
        safeLog("linkedin connect: workspace connect count error", { message: error.message });
        return null;
      }
      return count ?? 0;
    },
    async updateConnect(connectId, patch) {
      const update: Record<string, unknown> = {};
      if (patch.status) update.status = patch.status;
      if (patch.gateResult !== undefined) update.gate_result = patch.gateResult;
      if (patch.scheduledAt) update.scheduled_at = patch.scheduledAt;
      const { error } = await supabase.from("messages_outbound").update(update).eq("id", connectId).eq("status", "queued");
      if (error) safeLog("linkedin connect: row update error", { message: error.message });
      return !error;
    },
    async claimConnect(connectId) {
      const { data, error } = await supabase.rpc("claim_linkedin_connect", { p_message_id: connectId });
      if (error) {
        safeLog("linkedin connect: claim error", { message: error.message });
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
    async recordConnectOutcome(connectId, deliveryAttemptId, outcome, reason, providerRequestId) {
      const { data, error } = await supabase.rpc("record_linkedin_connect_outcome", {
        p_message_id: connectId,
        p_delivery_attempt_id: deliveryAttemptId,
        p_outcome: outcome,
        p_reason: reason,
        p_provider_request_id: providerRequestId,
      });
      if (error) {
        safeLog("linkedin connect: outcome reconciliation error", { message: error.message });
        return false;
      }
      return record(data)?.allowed === true;
    },
    async findConnectAttempts(profileUrl) {
      const { data, error } = await supabase
        .from("linkedin_connect_attempts")
        .select("workspace_id, grant_id, candidate_id, profile_url, status")
        .eq("profile_url", profileUrl)
        .in("status", ["claimed", "sent", "ambiguous"])
        .order("at", { ascending: false })
        .limit(20);
      if (error) {
        safeLog("linkedin connect: attempt lookup error", { message: error.message });
        return null;
      }
      const rows: ConnectAttemptRow[] = [];
      for (const raw of data ?? []) {
        const row = record(raw);
        if (!row || typeof row.workspace_id !== "string" || typeof row.grant_id !== "string") continue;
        const status = row.status;
        if (status !== "claimed" && status !== "sent" && status !== "skipped" && status !== "ambiguous") continue;
        rows.push({
          workspaceId: row.workspace_id,
          grantId: row.grant_id,
          candidateId: text(row.candidate_id),
          profileUrl: text(row.profile_url),
          status,
        });
      }
      return rows;
    },
    async insertConnectEvent(row) {
      const { data, error } = await supabase
        .from("linkedin_connect_events")
        .insert({
          workspace_id: row.workspaceId,
          grant_id: row.grantId,
          profile_url: row.profileUrl,
          event_type: "accepted",
          provider_id: row.providerId,
          received_at: row.receivedAt,
          status: "held",
        })
        .select("id")
        .maybeSingle();
      if (error?.code === "23505") return { ok: false, duplicate: true };
      if (error || typeof data?.id !== "string") return { ok: false, error: error?.message ?? "no-id" };
      return { ok: true, id: data.id };
    },
    async markConnectEvent(eventId, patch) {
      const update: Record<string, unknown> = { status: patch.status };
      if (patch.reason !== undefined) update.reason = patch.reason;
      if (patch.outboundMessageId !== undefined) update.outbound_message_id = patch.outboundMessageId;
      const { error } = await supabase.from("linkedin_connect_events").update(update).eq("id", eventId);
      if (error) safeLog("linkedin connect: event update error", { message: error.message });
      return !error;
    },
    async scheduleFirstMessageAfterAccept(input) {
      const { data, error } = await supabase
        .from("messages_outbound")
        .select("id, status, approval_message_id")
        .eq("workspace_id", input.workspaceId)
        .eq("channel", "LinkedIn")
        .eq("type", "candidate_reply")
        .eq("campaign_id", input.campaignId)
        .eq("to_address", input.profileUrl)
        .is("linkedin_reply_grant_id", null)
        .in("status", ["composed", "queued", "dispatching", "sent"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        safeLog("linkedin connect: first message lookup error", { message: error.message });
        return { ok: false, reason: "write-failed" };
      }
      const row = record(data);
      if (!row || typeof row.id !== "string") return { ok: false, reason: "no-first-message-draft" };
      if (row.status === "queued") return { ok: false, reason: "already-scheduled" };
      if (row.status === "dispatching" || row.status === "sent") return { ok: false, reason: "already-sent" };

      // Only a draft the launch approved may be queued: its approval row must
      // be live and bound to this grant.
      const approvalId = typeof row.approval_message_id === "string" && row.approval_message_id ? row.approval_message_id : row.id;
      const { data: approval, error: approvalErr } = await supabase
        .from("outreach_approvals")
        .select("linkedin_reply_grant_id, revoked_at")
        .eq("workspace_id", input.workspaceId)
        .eq("message_id", approvalId)
        .maybeSingle();
      if (approvalErr) {
        safeLog("linkedin connect: first message approval lookup error", { message: approvalErr.message });
        return { ok: false, reason: "write-failed" };
      }
      const approvalRow = record(approval);
      if (!approvalRow || approvalRow.linkedin_reply_grant_id !== input.grantId || approvalRow.revoked_at) {
        return { ok: false, reason: "draft-not-launched" };
      }

      const { data: queued, error: queueErr } = await supabase
        .from("messages_outbound")
        .update({ status: "queued", scheduled_at: input.scheduledAt, gate_result: { pass: true, reasons: ["linkedin-campaign:connection-accepted"] } })
        .eq("id", row.id)
        .eq("status", "composed")
        .select("id")
        .maybeSingle();
      if (queueErr || typeof queued?.id !== "string") {
        safeLog("linkedin connect: first message queue error", { message: queueErr?.message ?? "no-row" });
        return { ok: false, reason: "write-failed" };
      }
      return { ok: true, id: queued.id };
    },
  };
}
