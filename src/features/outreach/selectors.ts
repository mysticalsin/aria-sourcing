import type { OutreachMessage } from "@/lib/types";

export interface OutreachQueueView {
  messages: OutreachMessage[];
  pending: OutreachMessage[];
  pendingManual: OutreachMessage[];
  scheduled: OutreachMessage[];
}

export function filterByCampaign<T extends { campaignId: string }>(
  rows: readonly T[],
  campaignFilter: string,
): T[] {
  if (campaignFilter === "all") return [...rows];
  return rows.filter((row) => row.campaignId === campaignFilter);
}

export function readOutreach(messages: OutreachMessage[]): OutreachQueueView {
  return {
    messages,
    pending: messages.filter((message) => message.status === "Needs Approval"),
    pendingManual: messages.filter((message) => message.status === "Pending Manual Send"),
    scheduled: messages.filter((message) => message.status === "Scheduled"),
  };
}
