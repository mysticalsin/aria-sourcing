/**
 * Routes signed inbound email webhooks to the correct loop job — no inbox polling.
 *
 * - Hiring-need / JD emails → requisition_parse → campaign → source → top 10 → draft
 * - Candidate replies (In-Reply-To correlated or reply-shaped) → inbound_classify
 *
 * Idle loop ticks never scan mailboxes; only webhook activation drives the pipeline.
 */

import { isNeedEmail } from "./mock-ai";
import type { ClassifyEnqueueDecision } from "./inbound-reply-trigger";
import { decideInboundClassifyEnqueue } from "./inbound-reply-trigger";

export type InboundRecordResult = {
  ok?: boolean;
  inbound_id?: string;
  duplicate?: boolean;
};

export type NeedEnqueueDecision =
  | { enqueue: false; reason: string }
  | {
      enqueue: true;
      inboundId: string;
      kind: "requisition_parse";
      idempotencyKey: string;
      payload: {
        inboundId: string;
      };
      priority: number;
    };

export type InboundRouteInput = {
  record: InboundRecordResult | null | undefined;
  from: string;
  subject: string;
  body: string;
  mailbox: string;
  inReplyTo?: string;
  correlated?: boolean;
};

export type InboundRouteDecision =
  | { route: "none"; reason: string }
  | { route: "reply_classify"; decision: Extract<ClassifyEnqueueDecision, { enqueue: true }> }
  | { route: "hiring_need"; decision: Extract<NeedEnqueueDecision, { enqueue: true }> };

/**
 * Decide whether an inbound webhook should trigger reply classification or
 * a new hiring-need intake (requisition parse → sourcing pipeline).
 */
export function routeInboundEmail(input: InboundRouteInput): InboundRouteDecision {
  const classifyDecision = decideInboundClassifyEnqueue(input.record);

  if (classifyDecision.enqueue === false) {
    if (classifyDecision.reason === "duplicate") {
      return { route: "none", reason: "duplicate" };
    }
    if (classifyDecision.reason !== "not_recorded") {
      return { route: "none", reason: classifyDecision.reason };
    }
    return { route: "none", reason: "not_recorded" };
  }

  const inboundId = classifyDecision.inboundId;
  const isReply =
    Boolean(input.inReplyTo?.trim()) ||
    input.correlated === true ||
    /^re:\s/i.test(input.subject.trim());

  const looksLikeNeed = isNeedEmail(input.subject, input.body);

  // Reply path takes precedence when correlated or clearly a reply thread.
  if (isReply && !looksLikeNeed) {
    return { route: "reply_classify", decision: classifyDecision };
  }

  // New hiring need — webhook-triggered intake (no mailbox polling).
  if (looksLikeNeed) {
    return {
      route: "hiring_need",
      decision: {
        enqueue: true,
        inboundId,
        kind: "requisition_parse",
        idempotencyKey: `need:${inboundId}`,
        payload: { inboundId },
        priority: 90,
      },
    };
  }

  // Ambiguous: default to reply classify when In-Reply-To present, else need if JD keywords
  if (input.inReplyTo?.trim()) {
    return { route: "reply_classify", decision: classifyDecision };
  }

  return { route: "reply_classify", decision: classifyDecision };
}
