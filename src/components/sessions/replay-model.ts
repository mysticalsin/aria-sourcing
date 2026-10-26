import type {
  Booking,
  ClassifiedReply,
  InterviewRecord,
  OutreachMessage,
} from "@/lib/types";

export type ReplayStepKind =
  | "sourced"
  | "scored"
  | "drafted"
  | "approved"
  | "sent"
  | "rejected"
  | "replied"
  | "booked"
  | "compliance"
  | "note"
  | "other";

export interface ReplayStep {
  key: string;
  kind: ReplayStepKind;
  at: string;
  title: string;
  outcome: string;
  notes: string;
  /** The human or agent signature behind this step. */
  who: string;
  /** True for opening steps synthesized from the candidate record because no
   *  candidate-level activity row exists for those events. */
  synthesized: boolean;
  message?: OutreachMessage;
  reply?: ClassifiedReply;
  booking?: Booking;
  interview?: InterviewRecord;
}
