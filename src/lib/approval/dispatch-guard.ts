import { sanitizeOutreachSubject } from "../outreach-content";
import { killSwitchEngaged, approvalPolicyFromEnv, recipientAllowed, type RecipientAllowlist } from "./allowlist";
import { exactBodyHash } from "./hash";
import { qcGateAccepts, type QcEvaluation } from "./qc";
import type { ExactMessage, LedgerDecision, PolicyEnv, PolicyResult, SendMode } from "./types";

export interface SendGuardInput {
  message: ExactMessage;
  allowlist: RecipientAllowlist;
  killSwitch: boolean;
  mode: SendMode;
  humanApprovalHash: string | null;
  qcPassHash: string | null;
  sentOnChannel: number;
  channelCap: number;
  authorizedHash: string | null;
  humanApprovalExpired?: boolean;
  qcPassExpired?: boolean;
  /** Per-workspace switch for the linkedin_token channel. Off unless explicitly true. */
  linkedinTokenEnabled?: boolean;
}

function refuse(messageId: string | null, reason: string, bodyHash: string | null = null): LedgerDecision {
  return { allowed: false, reason, bodyHash, messageId };
}

function validMessage(message: ExactMessage): boolean {
  return Boolean(
    message.messageId.trim() &&
      message.campaignId.trim() &&
      message.candidateId.trim() &&
      message.channel.trim() &&
      message.recipient.trim() &&
      sanitizeOutreachSubject(message.subject) &&
      message.body.trim() &&
      message.noticeVersion.trim(),
  );
}

export function evaluateManualApproval(message: ExactMessage, allowlist: RecipientAllowlist): LedgerDecision {
  if (!validMessage(message)) return refuse(message.messageId.trim() || null, "invalid-message");
  const bodyHash = exactBodyHash(message);
  if (!recipientAllowed(allowlist, message.recipient)) {
    return refuse(message.messageId, "allowlist", bodyHash);
  }
  return { allowed: true, reason: "approved", bodyHash, messageId: message.messageId };
}

export function evaluateQcRecord(
  message: ExactMessage,
  evaluation: QcEvaluation,
  allowlist: RecipientAllowlist,
): LedgerDecision {
  if (!validMessage(message)) return refuse(message.messageId.trim() || null, "invalid-message");
  const bodyHash = exactBodyHash(message);
  if (!recipientAllowed(allowlist, message.recipient)) {
    return refuse(message.messageId, "allowlist", bodyHash);
  }
  if (!qcGateAccepts(evaluation)) {
    return refuse(message.messageId, "qc-rejected", bodyHash);
  }
  return { allowed: true, reason: "qc-passed", bodyHash, messageId: message.messageId };
}

/** Named channel for the off-by-default LinkedIn token option. A later PR performs the send. */
export const LINKEDIN_TOKEN_CHANNEL = "linkedin_token";

/**
 * Send decision for both modes. This does not deliver anything.
 * Order is fail-closed: kill switch, LinkedIn refusal, allowlist, hash-bound authorization, then cap.
 */
export function evaluateSend(input: SendGuardInput): LedgerDecision {
  const { message } = input;
  if (!validMessage(message)) return refuse(message.messageId.trim() || null, "invalid-message");
  const bodyHash = exactBodyHash(message);
  const decision = (allowed: boolean, reason: string): LedgerDecision => ({
    allowed,
    reason,
    bodyHash,
    messageId: message.messageId,
  });

  if (input.killSwitch) return decision(false, "kill-switch");
  if (message.channel === "LinkedIn") return decision(false, "linkedin-delivery-refused");
  if (message.channel === LINKEDIN_TOKEN_CHANNEL && input.linkedinTokenEnabled !== true) {
    return decision(false, "linkedin-token-disabled");
  }
  if (!recipientAllowed(input.allowlist, message.recipient)) return decision(false, "allowlist");

  if (input.mode === "automatic") {
    if (!input.qcPassHash) return decision(false, "qc-required");
    if (input.qcPassHash !== bodyHash) return decision(false, "body-hash-mismatch");
    if (input.qcPassExpired) return decision(false, "approval-expired");
  } else if (!input.humanApprovalHash) {
    return decision(false, "approval-required");
  } else if (input.humanApprovalHash !== bodyHash) {
    return decision(false, "body-hash-mismatch");
  } else if (input.humanApprovalExpired) {
    return decision(false, "approval-expired");
  }

  if (input.authorizedHash === bodyHash) return decision(false, "already-authorized");
  const cap = Number.isFinite(input.channelCap) ? Math.max(0, Math.floor(input.channelCap)) : 0;
  if (input.sentOnChannel >= cap) return decision(false, "channel-cap");
  return decision(true, "authorized");
}

export interface DeliveryTarget {
  toAddress?: string | null;
  profileUrl?: string | null;
}

/** Email delivers to toAddress. LinkedIn delivers to profileUrl when that is the claim target. */
export function deliveryTargetForChannel(channel: string, row: DeliveryTarget): string {
  if (channel === "LinkedIn" || channel === LINKEDIN_TOKEN_CHANNEL) {
    const profile = (row.profileUrl ?? "").trim();
    return profile || (row.toAddress ?? "").trim();
  }
  return (row.toAddress ?? "").trim();
}

/** Aria never delivers a LinkedIn message. Callers still resolve the real target first. */
export function linkedInDeliveryRefusal(): Extract<PolicyResult, { ok: false }> {
  return {
    ok: false,
    status: 410,
    error: "Aria does not deliver to LinkedIn.",
    reason: "linkedin-delivery-refused",
  };
}

/**
 * Kill switch, then the allowlist on the channel's real delivery target.
 * LinkedIn is refused after that, even when the profile is allowlisted.
 */
export function dispatchChannelDecision(env: PolicyEnv, channel: string, row: DeliveryTarget): PolicyResult {
  const target = deliveryTargetForChannel(channel, row);
  if (killSwitchEngaged(env)) {
    return {
      ok: false,
      status: 403,
      error: "Kill switch is on. Nothing sent.",
      reason: "kill-switch",
    };
  }
  if (channel === "LinkedIn" || channel === LINKEDIN_TOKEN_CHANNEL) {
    const listed = sendPolicyFromEnv(env, target);
    if (!listed.ok && listed.reason === "allowlist") return listed;
    return linkedInDeliveryRefusal();
  }
  return sendPolicyFromEnv(env, target);
}

/** Extra stop on the existing send and dispatch paths. Does not replace the human body-hash check. */
export function sendPolicyFromEnv(env: PolicyEnv, recipient: string): PolicyResult {
  if (killSwitchEngaged(env)) {
    return {
      ok: false,
      status: 403,
      error: "Kill switch is on. Nothing sent.",
      reason: "kill-switch",
    };
  }
  return approvalPolicyFromEnv(env, recipient);
}
