import { approvalIsCurrent, approvalTtlMs, DEFAULT_APPROVAL_TTL_MS, recipientAllowlist } from "./allowlist";
import { AuditLog, type AuditEntry, type AuditKind } from "./audit-log";
import {
  deliveryTargetForChannel,
  evaluateManualApproval,
  evaluateQcRecord,
  evaluateSend,
  sendPolicyFromEnv,
} from "./dispatch-guard";
import { exactBodyHash } from "./hash";
import { approvalHash } from "../outreach-content";
import type { QcEvaluation, QualityCheckAgent } from "./qc";
import type { ExactMessage, LedgerDecision, PolicyEnv, SendMode } from "./types";

export type ApprovalLifecycleState = "draft" | "pending" | "approved" | "sent" | "invalidated";

const LEGAL_TRANSITIONS: Record<ApprovalLifecycleState, readonly ApprovalLifecycleState[]> = {
  draft: ["pending", "invalidated"],
  pending: ["approved", "invalidated"],
  approved: ["sent", "invalidated"],
  sent: ["invalidated"],
  invalidated: [],
};

/** draft -> pending -> approved -> sent, and any of those may become invalidated. Anything else throws. */
export function transitionApprovalState(from: string, to: string): ApprovalLifecycleState {
  const allowed = LEGAL_TRANSITIONS[from as ApprovalLifecycleState];
  if (!allowed || !allowed.includes(to as ApprovalLifecycleState)) {
    throw new Error(`illegal approval transition: ${from} -> ${to}`);
  }
  return to as ApprovalLifecycleState;
}

export interface LedgerOptions {
  runMode: "demo" | "test";
  allowlist?: string;
  killSwitch?: boolean;
  channelCaps: Readonly<Record<string, number>>;
  now?: () => string;
  /** How long a recorded approval or QC pass can authorize a send. Default 7 days. */
  approvalTtlMs?: number;
  /** Per-workspace LinkedIn token switch. Off unless explicitly true. */
  linkedinTokenEnabled?: boolean;
}

/**
 * In-memory approval ledger. Manual mode is the default. Automatic mode is an
 * opt-in per campaign and channel, and it authorizes a send only from a QC
 * pass bound to the exact body hash. Nothing in this module delivers a message.
 */
export class ApprovalLedger {
  private readonly allowlist;
  private readonly caps: Readonly<Record<string, number>>;
  private readonly now: () => string;
  private readonly audit = new AuditLog();
  private readonly approvalTtlMs: number;
  private readonly approvals = new Map<string, { hash: string; at: string; approverId: string }>();
  private readonly qcPasses = new Map<string, { hash: string; at: string; approverId: string }>();
  private readonly automatic = new Set<string>();
  private readonly sentByDay = new Map<string, number>();
  private readonly states = new Map<string, ApprovalLifecycleState>();
  private readonly authorized = new Map<string, string>();
  private killSwitch: boolean;
  private readonly linkedinTokenEnabled: boolean;

  constructor(options: LedgerOptions) {
    if (options.runMode !== "demo" && options.runMode !== "test") {
      throw new Error("Live mode is refused.");
    }
    this.allowlist = recipientAllowlist(options.runMode, options.allowlist);
    this.caps = options.channelCaps;
    this.now = options.now ?? (() => new Date().toISOString());
    this.killSwitch = options.killSwitch === true;
    this.linkedinTokenEnabled = options.linkedinTokenEnabled === true;
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  auditLog(): AuditEntry[] {
    return this.audit.snapshot();
  }

  sendMode(campaignId: string, channel: string): SendMode {
    return this.automatic.has(modeKey(campaignId, channel)) ? "automatic" : "manual";
  }

  enableAutomatic(campaignId: string, channel: string, actor: string): LedgerDecision {
    if (!campaignId.trim() || !channel.trim()) {
      return this.record("auto-mode", { allowed: false, reason: "invalid-message", bodyHash: null, messageId: null }, null, actor);
    }
    this.automatic.add(modeKey(campaignId, channel));
    return this.record(
      "auto-mode",
      { allowed: true, reason: "automatic-enabled", bodyHash: null, messageId: null },
      null,
      actor,
      campaignId,
      channel,
    );
  }

  setKillSwitch(on: boolean, actor: string): LedgerDecision {
    this.killSwitch = on;
    return this.record(
      "kill-switch",
      {
        allowed: true,
        reason: on ? "kill-switch-engaged" : "kill-switch-released",
        bodyHash: null,
        messageId: null,
      },
      null,
      actor,
    );
  }

  approveManual(message: ExactMessage, actor: string): LedgerDecision {
    const at = this.now();
    const decision = evaluateManualApproval(message, this.allowlist, { approverId: actor, approvedAt: at });
    if (decision.allowed && decision.bodyHash) {
      this.approvals.set(message.messageId, { hash: decision.bodyHash, at, approverId: actor });
      this.enterApproved(message.messageId);
    }
    return this.record("manual-approval", decision, message, actor);
  }

  approveManualBatch(messages: readonly ExactMessage[], actor: string): LedgerDecision[] {
    return messages.map((message) => this.approveManual(message, actor));
  }

  recordQualityCheck(message: ExactMessage, evaluation: QcEvaluation, actor: string): LedgerDecision {
    const at = this.now();
    const decision = evaluateQcRecord(message, evaluation, this.allowlist, { approverId: actor, approvedAt: at });
    if (decision.allowed && decision.bodyHash) {
      this.qcPasses.set(message.messageId, { hash: decision.bodyHash, at, approverId: actor });
      this.enterApproved(message.messageId);
    }
    return this.record("qc-pass", decision, message, actor);
  }

  async recordQualityCheckFromAgent(
    message: ExactMessage,
    agent: QualityCheckAgent,
    actor: string,
  ): Promise<LedgerDecision> {
    try {
      const evaluation = await agent.evaluate(message);
      return this.recordQualityCheck(message, evaluation, actor);
    } catch {
      return this.record(
        "qc-pass",
        { allowed: false, reason: "qc-rejected", bodyHash: null, messageId: message.messageId },
        message,
        actor,
      );
    }
  }

  decideSend(message: ExactMessage, actor: string): LedgerDecision {
    const nowMs = Date.parse(this.now());
    const human = this.approvals.get(message.messageId);
    const qc = this.qcPasses.get(message.messageId);
    const mode = this.sendMode(message.campaignId, message.channel);
    const binding = mode === "automatic" ? qc : human;
    const decision = evaluateSend({
      message,
      allowlist: this.allowlist,
      killSwitch: this.killSwitch,
      mode,
      humanApprovalHash: human?.hash ?? null,
      qcPassHash: qc?.hash ?? null,
      humanApprovalExpired: Boolean(human && !approvalIsCurrent(human.at, nowMs, this.approvalTtlMs)),
      qcPassExpired: Boolean(qc && !approvalIsCurrent(qc.at, nowMs, this.approvalTtlMs)),
      sentOnChannel: this.sentToday(message.channel),
      channelCap: capFor(this.caps, message.channel),
      authorizedHash: this.authorized.get(message.messageId) ?? null,
      approverId: binding?.approverId ?? "",
      approvedAt: binding?.at ?? "",
      linkedinTokenEnabled: this.linkedinTokenEnabled,
    });
    if (decision.allowed && decision.bodyHash) {
      this.authorized.set(message.messageId, decision.bodyHash);
      this.markSentToday(message.channel);
      this.markSent(message.messageId);
    }
    return this.record("send", decision, message, actor);
  }

  private sentToday(channel: string): number {
    return this.sentByDay.get(this.dayKey(channel)) ?? 0;
  }

  private markSentToday(channel: string): void {
    const key = this.dayKey(channel);
    this.sentByDay.set(key, (this.sentByDay.get(key) ?? 0) + 1);
  }

  private dayKey(channel: string): string {
    return `${channel}\n${this.now().slice(0, 10)}`;
  }

  private enterApproved(messageId: string): void {
    if (this.states.has(messageId)) return;
    const pending = transitionApprovalState("draft", "pending");
    this.states.set(messageId, transitionApprovalState(pending, "approved"));
  }

  private markSent(messageId: string): void {
    const from = this.states.get(messageId);
    if (from !== "approved") return;
    this.states.set(messageId, transitionApprovalState(from, "sent"));
  }

  private record(
    kind: AuditKind,
    decision: LedgerDecision,
    message: ExactMessage | null,
    actor: string,
    campaignId: string | null = message?.campaignId ?? null,
    channel: string | null = message?.channel ?? null,
  ): LedgerDecision {
    this.audit.append({
      at: this.now(),
      kind,
      outcome: decision.allowed ? "allowed" : "refused",
      reason: decision.reason,
      actor,
      messageId: decision.messageId,
      campaignId,
      channel,
      bodyHash: decision.bodyHash,
    });
    return decision;
  }
}

function modeKey(campaignId: string, channel: string): string {
  return `${campaignId}\n${channel}`;
}

function capFor(caps: Readonly<Record<string, number>>, channel: string): number {
  const value = caps[channel];
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export interface LedgerConsultInput {
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  noticeVersion: string;
  approverId: string;
  approvedAt: string | null | undefined;
  storedBodyHash: string | null | undefined;
  /** Wire hash sha256(subject + newline + body). Checked when the caller has one. */
  storedWireHash?: string | null;
  env: PolicyEnv;
  nowMs?: number;
  profileUrl?: string | null;
  /** Cap for this channel. The count is sentToday from Postgres, not this process. */
  dailyCap?: number;
  sentToday?: number;
}

/**
 * The send route and the dispatcher both call this. It re-checks the exact
 * approved text, the wire hash when supplied, the approval TTL, the allowlist
 * target, and the persisted per-day count. It does not keep a process-local cap.
 */
export function consultApprovalLedger(input: LedgerConsultInput): { allowed: boolean; reason: string } {
  const nowMs = input.nowMs ?? Date.now();
  const exact = exactBodyHash({
    channel: input.channel,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    noticeVersion: input.noticeVersion,
    approverId: input.approverId,
    approvedAt: input.approvedAt ?? "",
  });
  if (!input.storedBodyHash || input.storedBodyHash !== exact) {
    return { allowed: false, reason: "body-hash-mismatch" };
  }
  if (input.storedWireHash && input.storedWireHash !== approvalHash(input.subject, input.body)) {
    return { allowed: false, reason: "body-hash-mismatch" };
  }
  if (!approvalIsCurrent(input.approvedAt, nowMs, approvalTtlMs(input.env))) {
    return { allowed: false, reason: "approval-expired" };
  }
  const target = deliveryTargetForChannel(input.channel, {
    toAddress: input.recipient,
    profileUrl: input.profileUrl,
  });
  const policy = sendPolicyFromEnv(input.env, target);
  if (!policy.ok) return { allowed: false, reason: policy.reason };
  if (typeof input.dailyCap === "number" && (input.sentToday ?? 0) >= input.dailyCap) {
    return { allowed: false, reason: "channel-cap" };
  }
  return { allowed: true, reason: "authorized" };
}
