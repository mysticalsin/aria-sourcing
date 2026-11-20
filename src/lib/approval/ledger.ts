import { recipientAllowlist } from "./allowlist";
import { AuditLog, type AuditEntry, type AuditKind } from "./audit-log";
import { evaluateManualApproval, evaluateQcRecord, evaluateSend } from "./dispatch-guard";
import type { QcEvaluation, QualityCheckAgent } from "./qc";
import type { ExactMessage, LedgerDecision, SendMode } from "./types";

export interface LedgerOptions {
  runMode: "demo" | "test";
  allowlist?: string;
  killSwitch?: boolean;
  channelCaps: Readonly<Record<string, number>>;
  now?: () => string;
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
  private readonly approvals = new Map<string, string>();
  private readonly qcPasses = new Map<string, string>();
  private readonly automatic = new Set<string>();
  private readonly sent = new Map<string, number>();
  private readonly authorized = new Map<string, string>();
  private killSwitch: boolean;

  constructor(options: LedgerOptions) {
    if (options.runMode !== "demo" && options.runMode !== "test") {
      throw new Error("Live mode is refused.");
    }
    this.allowlist = recipientAllowlist(options.runMode, options.allowlist);
    this.caps = options.channelCaps;
    this.now = options.now ?? (() => new Date().toISOString());
    this.killSwitch = options.killSwitch === true;
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
    const decision = evaluateManualApproval(message, this.allowlist);
    if (decision.allowed && decision.bodyHash) this.approvals.set(message.messageId, decision.bodyHash);
    return this.record("manual-approval", decision, message, actor);
  }

  approveManualBatch(messages: readonly ExactMessage[], actor: string): LedgerDecision[] {
    return messages.map((message) => this.approveManual(message, actor));
  }

  recordQualityCheck(message: ExactMessage, evaluation: QcEvaluation, actor: string): LedgerDecision {
    const decision = evaluateQcRecord(message, evaluation, this.allowlist);
    if (decision.allowed && decision.bodyHash) this.qcPasses.set(message.messageId, decision.bodyHash);
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
    const decision = evaluateSend({
      message,
      allowlist: this.allowlist,
      killSwitch: this.killSwitch,
      mode: this.sendMode(message.campaignId, message.channel),
      humanApprovalHash: this.approvals.get(message.messageId) ?? null,
      qcPassHash: this.qcPasses.get(message.messageId) ?? null,
      sentOnChannel: this.sent.get(message.channel) ?? 0,
      channelCap: capFor(this.caps, message.channel),
      authorizedHash: this.authorized.get(message.messageId) ?? null,
    });
    if (decision.allowed && decision.bodyHash) {
      this.authorized.set(message.messageId, decision.bodyHash);
      this.sent.set(message.channel, (this.sent.get(message.channel) ?? 0) + 1);
    }
    return this.record("send", decision, message, actor);
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
