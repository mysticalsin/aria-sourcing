/**
 * Service-role autopilot first-touch dispatch after live critics pass.
 * Mints approval_source=autopilot_critics, then durable-queues by channel.
 */

import { approvalHash, approvalScopeHash, sanitizeOutreachSubject } from "@/lib/outreach-content";
import { decideReiAutopilotSend, type ReiOutboundChannel } from "@/lib/rei-autopilot-send";
import { resolveWhatsAppAutopilotShape } from "@/lib/rei-autopilot-whatsapp";
import {
  inspectHeyReachDeliveryPartsForWorkspace,
} from "@/lib/heyreach-delivery";
import { isMailboxSeatProvider } from "@/lib/outreach-send-mode";
import { dispatchDue } from "@/lib/dispatch-outbound";
import {
  loadSourcingLoopControls,
  sequencesArmedFromControls,
} from "@/lib/sourcing-loop-controls";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import { normalizeLinkedInProfileUrl } from "@/lib/linkedin-connections";
import { safeLog } from "@/lib/log-redact";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AutopilotDispatchInput = {
  workspaceId: string;
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

export type AutopilotDispatchResult =
  | {
      status: "sent" | "queued" | "dry-run";
      detail: string;
      channel: ReiOutboundChannel;
      /** Wire-dispatch counters from dispatchDue (post-enqueue). */
      dispatch?: { sent: number; blocked: number; failed: number; unconfigured: number };
    }
  | { status: "skipped"; detail: string; reason: string }
  | { status: "error"; detail: string };

type ServiceClient = SupabaseClient;

type SeatRow = {
  id: string;
  provider?: string | null;
  status?: string | null;
  mode?: string | null;
  domain_verified?: boolean | null;
  operator_email?: string | null;
  connected_account?: string | null;
};

/**
 * Align Autopilot mailbox pick with Approve→Send / seatMailboxLiveReady:
 * Graph live + connected mailbox skips vanity DNS; API-key senders need domain_verified.
 */
export function mailboxSeatReadyForAutopilot(seat: SeatRow): boolean {
  if (!isMailboxSeatProvider(String(seat.provider ?? ""))) return false;
  if (seat.mode !== "live") return false;
  const connected =
    String(seat.connected_account ?? "").trim() || String(seat.operator_email ?? "").trim();
  if (!connected.includes("@")) return false;
  if (String(seat.provider) === "Microsoft Graph") return true;
  return seat.domain_verified === true;
}

async function loadAutopilotContext(svc: ServiceClient, workspaceId: string) {
  const controls = await loadSourcingLoopControls(svc, workspaceId);
  const sequencesArmed = controls.ok && sequencesArmedFromControls(controls.row);

  const entitled = await svc
    .from("profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("autopilot_enabled", true)
    .in("role", ["admin", "member"])
    .limit(1)
    .maybeSingle();
  const entitledId = typeof entitled.data?.id === "string" ? entitled.data.id : "";

  const seats = await svc
    .from("agent_seats")
    .select("id, provider, status, mode, domain_verified, operator_email, connected_account")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  const rows = (seats.data ?? []) as SeatRow[];
  let liveMailbox = rows.find((s) => mailboxSeatReadyForAutopilot(s));
  // Mirror Approve→Send: heal Graph domain_verified so claim_* accepts the seat.
  if (
    liveMailbox
    && String(liveMailbox.provider) === "Microsoft Graph"
    && liveMailbox.domain_verified !== true
  ) {
    const { error: healErr } = await svc
      .from("agent_seats")
      .update({ domain_verified: true })
      .eq("id", liveMailbox.id);
    if (healErr) {
      safeLog("autopilot Graph domain_verified heal failed", {
        message: healErr.message,
        code: healErr.code,
      });
      // Fail closed — claim_* still requires DB domain_verified; do not mint/enqueue.
      liveMailbox = undefined;
    } else {
      liveMailbox.domain_verified = true;
    }
  }
  const liveWhatsApp = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "WhatsApp Cloud",
  );
  const liveLinkedInVendor = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "LinkedIn Vendor API",
  );
  const liveHeyReach = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "HeyReach",
  );

  const heyReachParts = await inspectHeyReachDeliveryPartsForWorkspace(workspaceId);
  const heyReachApiReady = heyReachParts.keyPresent && heyReachParts.campaignPresent;

  return {
    sequencesArmed,
    entitledId,
    autopilotEnabled: Boolean(entitledId),
    liveMailbox,
    liveWhatsApp,
    liveLinkedInVendor,
    liveHeyReach,
    hasLiveMailbox: Boolean(liveMailbox),
    hasLiveWhatsApp: Boolean(liveWhatsApp),
    heyReachConfigured: heyReachApiReady && Boolean(liveHeyReach),
    heyReachKeyPresent: heyReachParts.keyPresent,
    heyReachCampaignPresent: heyReachParts.campaignPresent,
    liveHeyReachSeat: Boolean(liveHeyReach),
    linkedInVendorConfigured:
      Boolean(process.env.LINKEDIN_VENDOR_API_URL && process.env.LINKEDIN_VENDOR_API_KEY) &&
      Boolean(liveLinkedInVendor),
  };
}

async function mintApproval(
  svc: ServiceClient,
  input: AutopilotDispatchInput,
  entitledId: string,
  recipient: string,
  subject: string,
  body: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const safeSubject = sanitizeOutreachSubject(subject);
  const bodyHash = approvalHash(safeSubject, body);
  const scopeHash = approvalScopeHash({
    candidateId: input.candidateId,
    channel: input.channel,
    recipient,
  });
  if (!scopeHash) {
    return { ok: false, detail: "Invalid approval recipient for scope hash." };
  }
  const minted = await svc.rpc("mint_autopilot_critics_approval", {
    p_workspace_id: input.workspaceId,
    p_message_id: input.messageId,
    p_body_hash: bodyHash,
    p_approval_scope_hash: scopeHash,
    p_entitled_approver_id: entitledId,
  });
  const status =
    minted.data && typeof minted.data === "object" && "status" in minted.data
      ? String((minted.data as { status: string }).status)
      : "";
  if (minted.error || status !== "ok") {
    return {
      ok: false,
      detail: minted.error?.message ?? `mint_failed:${status || "unknown"}`,
    };
  }
  return { ok: true };
}

function afterQueuedDispatch(
  channel: ReiOutboundChannel,
  detail: string,
  stats: Awaited<ReturnType<typeof dispatchDue>>,
): AutopilotDispatchResult {
  const dispatch = {
    sent: stats.sent,
    blocked: stats.blocked,
    failed: stats.failed,
    unconfigured: stats.unconfigured,
  };
  if (stats.sent > 0) {
    return { status: "sent", detail: `${detail} Wire sent.`, channel, dispatch };
  }
  if (stats.blocked > 0 || stats.failed > 0 || stats.unconfigured > 0) {
    return {
      status: "queued",
      detail: `${detail} Wire did not send (blocked=${stats.blocked} failed=${stats.failed} unconfigured=${stats.unconfigured}).`,
      channel,
      dispatch,
    };
  }
  return { status: "queued", detail, channel, dispatch };
}

async function dispatchEmail(
  svc: ServiceClient,
  input: AutopilotDispatchInput,
  seatId: string,
): Promise<AutopilotDispatchResult> {
  const email = input.recipient.trim().toLowerCase();
  if (!email.includes("@")) {
    return { status: "skipped", detail: "No email on file.", reason: "no_email" };
  }
  const subject = sanitizeOutreachSubject(input.subject);
  const queued = await svc.rpc("enqueue_email_outbound_service", {
    p_workspace_id: input.workspaceId,
    p_message_id: input.messageId,
    p_candidate_id: input.candidateId,
    p_campaign_id: input.campaignId,
    p_seat_id: seatId,
    p_recipient: email,
    p_subject: subject,
    p_body: input.body,
  });
  const queuedObj = queued.data as { ok?: boolean; status?: string; id?: string; reason?: string } | null;
  if (queued.error) {
    return { status: "error", detail: queued.error.message };
  }
  if (queuedObj?.reason === "duplicate" && queuedObj.id) {
    const stats = await dispatchDue(svc, 1, queuedObj.id);
    return afterQueuedDispatch(
      "Email",
      "Email already queued — dispatcher re-checked.",
      stats,
    );
  }
  if (queuedObj?.ok !== true || !queuedObj.id) {
    return {
      status: "skipped",
      detail: queuedObj?.reason ?? "email_enqueue_failed",
      reason: queuedObj?.reason ?? "enqueue_failed",
    };
  }
  const stats = await dispatchDue(svc, 1, queuedObj.id);
  return afterQueuedDispatch("Email", "Email queued for policy-checked dispatch.", stats);
}

async function dispatchWhatsApp(
  svc: ServiceClient,
  input: AutopilotDispatchInput,
  seatId: string,
  entitledId: string,
): Promise<AutopilotDispatchResult> {
  const shape = await resolveWhatsAppAutopilotShape(svc, {
    workspaceId: input.workspaceId,
    seatId,
    recipient: input.recipient,
    subject: sanitizeOutreachSubject(input.subject),
    body: input.body,
  });
  if (shape.kind === "skip") {
    return { status: "skipped", detail: shape.detail, reason: shape.reason };
  }

  const minted = await mintApproval(
    svc,
    input,
    entitledId,
    shape.recipient,
    shape.subject,
    shape.body,
  );
  if (!minted.ok) {
    return { status: "error", detail: minted.detail };
  }

  const queued = await svc.rpc("enqueue_whatsapp_outbound_service", {
    p_workspace_id: input.workspaceId,
    p_message_id: input.messageId,
    p_candidate_id: input.candidateId,
    p_campaign_id: input.campaignId,
    p_seat_id: seatId,
    p_recipient: shape.recipient,
    p_type: shape.kind,
    p_subject: shape.subject,
    p_body: shape.body,
    p_template_id: shape.templateId,
    p_template_parameters: shape.templateParameters,
  });
  const queuedObj = queued.data as { ok?: boolean; status?: string; id?: string; reason?: string } | null;
  if (queued.error || (queuedObj?.ok !== true && queuedObj?.reason !== "duplicate") || !queuedObj?.id) {
    return {
      status: "skipped",
      detail: queued.error?.message ?? queuedObj?.reason ?? "whatsapp_enqueue_failed",
      reason: queuedObj?.reason ?? "enqueue_failed",
    };
  }
  const stats = await dispatchDue(svc, 1, queuedObj.id);
  return afterQueuedDispatch(
    "WhatsApp",
    shape.kind === "approved_template"
      ? "WhatsApp approved template queued for policy-checked delivery."
      : "WhatsApp reply queued for policy-checked delivery.",
    stats,
  );
}

async function dispatchLinkedIn(
  svc: ServiceClient,
  input: AutopilotDispatchInput,
  seatId: string,
): Promise<AutopilotDispatchResult> {
  const profileUrl = normalizeLinkedInProfileUrl(input.recipient) ?? input.recipient.trim();
  if (!profileUrl || !/linkedin\.com\//i.test(profileUrl)) {
    return { status: "skipped", detail: "No LinkedIn profile URL.", reason: "no_linkedin" };
  }
  const subject = sanitizeOutreachSubject(input.subject);
  const normalized = profileUrl.toLowerCase();

  const queued = await svc.rpc("enqueue_linkedin_outbound_service", {
    p_workspace_id: input.workspaceId,
    p_message_id: input.messageId,
    p_candidate_id: input.candidateId,
    p_campaign_id: input.campaignId,
    p_seat_id: seatId,
    p_profile_url: normalized,
    p_subject: subject,
    p_body: input.body,
  });
  const queuedObj = queued.data as { ok?: boolean; id?: string; reason?: string } | null;
  if (!queued.error && (queuedObj?.ok === true || queuedObj?.reason === "duplicate") && queuedObj.id) {
    const stats = await dispatchDue(svc, 1, queuedObj.id);
    return afterQueuedDispatch("LinkedIn", "LinkedIn queued for HeyReach/vendor dispatch.", stats);
  }
  return {
    status: "skipped",
    detail: queued.error?.message ?? queuedObj?.reason ?? "linkedin_enqueue_failed",
    reason: queuedObj?.reason ?? "enqueue_failed",
  };
}

/** Run one autopilot first-touch send. Fail-closed to skipped when seats/keys missing. */
export async function runAutopilotOutreachDispatch(
  svc: ServiceClient,
  input: AutopilotDispatchInput,
): Promise<AutopilotDispatchResult> {
  const ctx = await loadAutopilotContext(svc, input.workspaceId);
  if (!ctx.entitledId) {
    return { status: "skipped", detail: "No autopilot-entitled profile.", reason: "no_entitlement" };
  }

  const verdict = decideReiAutopilotSend({
    autopilotEnabled: ctx.autopilotEnabled,
    sequencesArmed: ctx.sequencesArmed,
    criticsPassed: input.criticsPassed,
    qualityStatus: input.qualityStatus,
    channel: input.channel,
    hasLiveMailbox: ctx.hasLiveMailbox,
    hasLiveWhatsApp: ctx.hasLiveWhatsApp,
    heyReachConfigured: ctx.heyReachConfigured,
    linkedInVendorConfigured: ctx.linkedInVendorConfigured,
    heyReachKeyPresent: ctx.heyReachKeyPresent,
    heyReachCampaignPresent: ctx.heyReachCampaignPresent,
    liveHeyReachSeat: ctx.liveHeyReachSeat,
  });

  if (verdict.mode !== "autopilot_dispatch") {
    return {
      status: "skipped",
      detail: `Human review required (${verdict.reason}).`,
      reason: verdict.reason,
    };
  }

  let recipient = input.recipient.trim();
  if (input.channel === "LinkedIn") {
    recipient = (normalizeLinkedInProfileUrl(recipient) ?? recipient).toLowerCase();
  } else if (input.channel === "Email") {
    recipient = recipient.toLowerCase();
  } else if (input.channel === "WhatsApp") {
    recipient = normalizeWhatsAppAddress(recipient) ?? "";
  }

  try {
    switch (verdict.channel) {
      case "Email": {
        if (!ctx.liveMailbox) {
          return { status: "skipped", detail: "No live mailbox.", reason: "no_live_mailbox" };
        }
        const minted = await mintApproval(
          svc,
          { ...input, recipient },
          ctx.entitledId,
          recipient,
          input.subject,
          input.body,
        );
        if (!minted.ok) {
          safeLog("autopilot mint approval failed", { detail: minted.detail });
          return { status: "error", detail: minted.detail };
        }
        return await dispatchEmail(svc, { ...input, recipient }, ctx.liveMailbox.id);
      }
      case "WhatsApp":
        if (!ctx.liveWhatsApp) {
          return { status: "skipped", detail: "No live WhatsApp seat.", reason: "no_live_whatsapp" };
        }
        // Mint happens inside after reply-window vs cold-template shape is known.
        return await dispatchWhatsApp(svc, { ...input, recipient }, ctx.liveWhatsApp.id, ctx.entitledId);
      case "LinkedIn": {
        const seatId = ctx.liveHeyReach?.id ?? ctx.liveLinkedInVendor?.id;
        if (!seatId) {
          return {
            status: "skipped",
            detail: "Live HeyReach or LinkedIn Vendor seat required for durable LinkedIn queue.",
            reason: "linkedin_seat_required",
          };
        }
        if (verdict.linkedInDelivery !== "heyreach" && verdict.linkedInDelivery !== "vendor") {
          return {
            status: "skipped",
            detail: "LinkedIn assisted-manual only.",
            reason: "linkedin_assisted_manual_only",
          };
        }
        const minted = await mintApproval(
          svc,
          { ...input, recipient },
          ctx.entitledId,
          recipient,
          input.subject,
          input.body,
        );
        if (!minted.ok) {
          safeLog("autopilot mint approval failed", { detail: minted.detail });
          return { status: "error", detail: minted.detail };
        }
        return await dispatchLinkedIn(svc, { ...input, recipient }, seatId);
      }
      default:
        return { status: "skipped", detail: "Channel disabled.", reason: "channel_disabled" };
    }
  } catch (err) {
    safeLog("autopilot dispatch error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return {
      status: "error",
      detail: err instanceof Error ? err.message : "Autopilot dispatch failed.",
    };
  }
}
