/**
 * Service-role autopilot first-touch dispatch after live critics pass.
 * Mints approval_source=autopilot_critics, then durable-queues by channel.
 */

import { approvalHash, approvalScopeHash, sanitizeOutreachSubject } from "@/lib/outreach-content";
import { decideReiAutopilotSend, type ReiOutboundChannel } from "@/lib/rei-autopilot-send";
import { resolveWhatsAppAutopilotShape } from "@/lib/rei-autopilot-whatsapp";
import {
  heyReachDeliveryReadyFromEnv,
  resolveHeyReachConfigForWorkspace,
} from "@/lib/heyreach-delivery";
import { isMailboxSeatProvider } from "@/lib/outreach-send-mode";
import { dispatchDue } from "@/lib/dispatch-outbound";
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
  | { status: "sent" | "queued" | "dry-run"; detail: string; channel: ReiOutboundChannel }
  | { status: "skipped"; detail: string; reason: string }
  | { status: "error"; detail: string };

type ServiceClient = SupabaseClient;

async function loadAutopilotContext(svc: ServiceClient, workspaceId: string) {
  const controls = await svc
    .from("sourcing_loop_controls")
    .select("kill_switch, sequences_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const sequencesArmed =
    controls.data?.kill_switch === false && controls.data?.sequences_enabled === true;

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
    .select("id, provider, status, mode, domain_verified, operator_email")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  const rows = seats.data ?? [];
  const liveMailbox = rows.find(
    (s) =>
      s.mode === "live" &&
      isMailboxSeatProvider(String(s.provider ?? "")) &&
      s.domain_verified === true,
  );
  const liveWhatsApp = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "WhatsApp Cloud",
  );
  const liveLinkedInVendor = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "LinkedIn Vendor API",
  );
  const liveHeyReach = rows.find(
    (s) => s.mode === "live" && String(s.provider) === "HeyReach",
  );

  const heyReachApiReady =
    heyReachDeliveryReadyFromEnv() || Boolean(await resolveHeyReachConfigForWorkspace(workspaceId));

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
    await dispatchDue(svc, 1, queuedObj.id);
    return {
      status: "queued",
      detail: "Email already queued — dispatcher re-checked.",
      channel: "Email",
    };
  }
  if (queuedObj?.ok !== true || !queuedObj.id) {
    return {
      status: "skipped",
      detail: queuedObj?.reason ?? "email_enqueue_failed",
      reason: queuedObj?.reason ?? "enqueue_failed",
    };
  }
  await dispatchDue(svc, 1, queuedObj.id);
  return {
    status: "queued",
    detail: "Email queued for policy-checked dispatch.",
    channel: "Email",
  };
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
  await dispatchDue(svc, 1, queuedObj.id);
  return {
    status: "queued",
    detail:
      shape.kind === "approved_template"
        ? "WhatsApp approved template queued for policy-checked delivery."
        : "WhatsApp reply queued for policy-checked delivery.",
    channel: "WhatsApp",
  };
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
    await dispatchDue(svc, 1, queuedObj.id);
    return {
      status: "queued",
      detail: "LinkedIn queued for HeyReach/vendor dispatch.",
      channel: "LinkedIn",
    };
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
