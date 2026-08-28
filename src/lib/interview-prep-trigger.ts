/**
 * Interview prep dispatch — enqueue after a live calendar booking is confirmed.
 * Job kind remains `interview_prep_send` (0071 DB contract) but the handler only
 * drafts Needs Approval / dryRun outreach — nothing sends without human review.
 */

export type InterviewPrepEnqueueDecision =
  | { enqueue: false; reason: "missing_booking" | "missing_candidate" | "missing_campaign" | "no_provider_event" }
  | {
      enqueue: true;
      kind: "interview_prep_send";
      idempotencyKey: string;
      payload: {
        campaignId: string;
        candidateId: string;
        bookingId: string;
        trigger: "create_booking";
      };
      priority: number;
    };

/** Enqueue prep drafts only when a provider calendar event was created. */
export function decideInterviewPrepEnqueue(input: {
  bookingId?: string | null;
  candidateId?: string | null;
  campaignId?: string | null;
  providerEventCreated?: boolean;
}): InterviewPrepEnqueueDecision {
  if (!input.providerEventCreated) {
    return { enqueue: false, reason: "no_provider_event" };
  }
  const bookingId = input.bookingId?.trim() ?? "";
  const candidateId = input.candidateId?.trim() ?? "";
  const campaignId = input.campaignId?.trim() ?? "";
  if (!bookingId) return { enqueue: false, reason: "missing_booking" };
  if (!candidateId) return { enqueue: false, reason: "missing_candidate" };
  if (!campaignId) return { enqueue: false, reason: "missing_campaign" };
  return {
    enqueue: true,
    kind: "interview_prep_send",
    idempotencyKey: `prep:${bookingId}`,
    payload: {
      campaignId,
      candidateId,
      bookingId,
      trigger: "create_booking",
    },
    priority: 55,
  };
}

/** Parse Subject:/body blocks from mock-ai prep templates. */
export function parsePrepEmailTemplate(text: string): { subject: string; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^Subject:\s*(.+?)(?:\r?\n\r?\n|\n)([\s\S]*)$/);
  if (match) {
    return { subject: match[1].trim(), body: match[2].trim() };
  }
  return { subject: "Interview correspondence", body: trimmed };
}
