/**
 * Event-driven inbound reply trigger helpers (pure).
 *
 * Candidate answers should hit a signed webhook → enqueue `inbound_classify`
 * once per inbound id. Idle loop ticks must never call the classifier LLM.
 */

export type InboundRecordResult = {
  ok?: boolean;
  inbound_id?: string;
  duplicate?: boolean;
};

export type ClassifyEnqueueDecision =
  | { enqueue: false; reason: "not_recorded" | "duplicate" | "missing_inbound_id" }
  | {
      enqueue: true;
      inboundId: string;
      kind: "inbound_classify";
      idempotencyKey: string;
      payload: { inboundId: string };
      priority: number;
    };

/** Decide whether a freshly recorded inbound email should schedule classification. */
export function decideInboundClassifyEnqueue(
  record: InboundRecordResult | null | undefined,
): ClassifyEnqueueDecision {
  if (!record?.ok) return { enqueue: false, reason: "not_recorded" };
  if (record.duplicate === true) return { enqueue: false, reason: "duplicate" };
  const inboundId = typeof record.inbound_id === "string" ? record.inbound_id.trim() : "";
  if (!inboundId) return { enqueue: false, reason: "missing_inbound_id" };
  return {
    enqueue: true,
    inboundId,
    kind: "inbound_classify",
    idempotencyKey: `reply:${inboundId}`,
    payload: { inboundId },
    priority: 80,
  };
}

const POSITIVE_REPLY_INTENTS = new Set(["INTERESTED", "QUALIFIED_INTEREST"]);

/** Positive intents that should continue autopilot (draft follow-up), not re-source. */
export function isPositiveReplyIntent(intent: string | null | undefined): boolean {
  return typeof intent === "string" && POSITIVE_REPLY_INTENTS.has(intent);
}

/**
 * After classify: optionally enqueue a draft follow-up for the same candidate.
 * Requires campaign + candidate correlation from the inbound row.
 */
export function decideReplyDraftSuccessor(input: {
  intent: string;
  campaignId?: string;
  candidateId?: string;
  entitledApproverId?: string;
}): null | {
  kind: "draft_generate";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  priority: number;
} {
  if (!isPositiveReplyIntent(input.intent)) return null;
  const campaignId = input.campaignId?.trim() ?? "";
  const candidateId = input.candidateId?.trim() ?? "";
  const approvedBy = input.entitledApproverId?.trim() ?? "";
  if (!campaignId || !candidateId || !approvedBy) return null;
  return {
    kind: "draft_generate",
    idempotencyKey: `draft:reply:${campaignId}:${candidateId}`,
    payload: {
      campaignId,
      candidateId,
      approvedBy,
      approvalSource: "autopilot_reply",
      trigger: "inbound_classify",
    },
    priority: 70,
  };
}

/**
 * After positive interest: propose a booking (operator confirms) — never silent calendar create.
 * Pure helper; store emits activity + receipts. createBookingFor stays operator-gated.
 */
export function decideBookingProposeFromInterest(input: {
  intent: string;
  campaignId?: string;
  candidateId?: string;
  seatId?: string;
  computerId?: string;
}): null | {
  kind: "booking_propose";
  idempotencyKey: string;
  payload: {
    campaignId: string;
    candidateId: string;
    seatId?: string;
    computerId?: string;
    intent: string;
    trigger: "inbound_interest";
  };
  activityTitle: string;
  activityNotes: string;
} {
  if (!isPositiveReplyIntent(input.intent)) return null;
  const campaignId = input.campaignId?.trim() ?? "";
  const candidateId = input.candidateId?.trim() ?? "";
  if (!campaignId || !candidateId) return null;
  const seatId = input.seatId?.trim() || undefined;
  const computerId = input.computerId?.trim() || undefined;
  return {
    kind: "booking_propose",
    idempotencyKey: `booking:propose:${campaignId}:${candidateId}`,
    payload: {
      campaignId,
      candidateId,
      seatId,
      computerId,
      intent: input.intent,
      trigger: "inbound_interest",
    },
    activityTitle: "Booking proposed from interested reply",
    activityNotes:
      "Positive interest — propose a meeting in Calendar (operator confirms). No silent calendar create.",
  };
}
