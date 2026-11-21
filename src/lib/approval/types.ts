/** Exact text a person would receive. The ledger binds every decision to this. */
export interface ExactMessage {
  messageId: string;
  campaignId: string;
  candidateId: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  noticeVersion: string;
}

export interface LedgerDecision {
  allowed: boolean;
  reason: string;
  bodyHash: string | null;
  messageId: string | null;
}

export type SendMode = "manual" | "automatic";

export type PolicyEnv = {
  ARIA_MODE?: string;
  ARIA_RECIPIENT_ALLOWLIST?: string;
  ARIA_SEND_KILL_SWITCH?: string;
  [key: string]: string | undefined;
};

export type PolicyResult =
  | { ok: true }
  | { ok: false; status: number; error: string; reason: string };
