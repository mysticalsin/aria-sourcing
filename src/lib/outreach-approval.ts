import type { OutreachChannel } from "./types";

export interface OutreachApprovalRequest {
  messageId: string;
  candidateId: string;
  channel: OutreachChannel;
  recipient: string;
  subject: string;
  body: string;
}

export type OutreachApprovalPersistence =
  | { ok: true }
  | { ok: false; error: string };

type ApprovalFetch = typeof fetch;

const APPROVAL_NOT_RECORDED = "Approval was not recorded. The draft remains pending.";

/**
 * Persist the exact copy a human approved before the client changes local
 * workflow state. A non-2xx, malformed, or non-confirming response is always
 * treated as a failed approval: never optimistically advance the draft.
 */
export async function recordOutreachApproval(
  request: OutreachApprovalRequest,
  fetcher: ApprovalFetch = fetch,
): Promise<OutreachApprovalPersistence> {
  try {
    const response = await fetcher("/api/outreach/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    if (!response.ok || payload?.ok !== true) {
      return { ok: false, error: APPROVAL_NOT_RECORDED };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: APPROVAL_NOT_RECORDED };
  }
}

/**
 * Revoke a recorded approval before the durable delivery claim begins. The
 * server returns success for a missing/already-revoked row, but rejects the
 * explicit send cutoff so the UI never says a live message was cancelled.
 */
export async function revokeOutreachApproval(
  messageId: string,
  fetcher: ApprovalFetch = fetch,
): Promise<OutreachApprovalPersistence> {
  try {
    const response = await fetcher("/api/outreach/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    if (!response.ok || payload?.ok !== true) {
      return { ok: false, error: "Approval could not be revoked. The draft remains unchanged." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Approval could not be revoked. The draft remains unchanged." };
  }
}
