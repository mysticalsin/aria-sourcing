import type { ReplyIntent } from "./types";

export const REPLY_INTENT_LABELS: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  QUALIFIED_INTEREST: "Qualified interest",
  NOT_INTERESTED: "Not interested",
  REFERRAL: "Referral",
  OOO: "Out of office",
  UNCLEAR: "Unclear",
  NEGATIVE: "Negative",
};

export const HOT_REPLY_INTENTS: ReplyIntent[] = ["INTERESTED", "QUALIFIED_INTEREST"];

export type ReplyChannelFilter = "all" | "Email" | "LinkedIn" | "WhatsApp";
export type ReplyStatusFilter = "all" | "needs_action" | "sla" | "handled";
