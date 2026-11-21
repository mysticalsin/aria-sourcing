import type { OutreachMessage } from "@/lib/types";

export interface ApprovalQueueView {
  /** Drafts waiting for a person to approve the exact text. */
  pending: OutreachMessage[];
}

export function readApprovals(messages: readonly OutreachMessage[]): ApprovalQueueView {
  return {
    pending: messages.filter((message) => message.status === "Needs Approval"),
  };
}
