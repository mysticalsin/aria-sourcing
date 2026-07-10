/**
 * Pure decisions shared by the signed webhook and the authenticated review
 * surface. Database state remains authoritative; these helpers only make the
 * safe retry and eligibility rules explicit and testable.
 */

export interface WhatsAppReceiptPersistence {
  senderKnown: boolean;
  persisted: boolean;
}

/** Unknown provider IDs are safe no-ops. A known sender with a failed durable
 * write must receive a retryable response from the webhook provider. */
export function shouldAcknowledgeWhatsAppReceipt({ senderKnown, persisted }: WhatsAppReceiptPersistence): boolean {
  return !senderKnown || persisted;
}

export interface WhatsAppReceiptRpcResult {
  recorded?: boolean;
  retryable?: boolean;
  reason?: string;
}

export interface WhatsAppReceiptAcknowledgement {
  acknowledge: boolean;
  reason: string;
}

/**
 * A known sender's receipt may arrive while the provider-acceptance transaction
 * is still making the outbound row addressable. Only an explicit, durable
 * `recorded` result or an explicitly classified unknown provider id may be
 * acknowledged. Every other result fails closed so Meta can retry it.
 */
export function decideWhatsAppReceiptAcknowledgement(input: {
  senderKnown: boolean;
  rpcResult: WhatsAppReceiptRpcResult | null;
}): WhatsAppReceiptAcknowledgement {
  if (!input.senderKnown) return { acknowledge: true, reason: "unknown-sender" };
  if (input.rpcResult?.recorded === true) return { acknowledge: true, reason: "recorded" };
  if (
    input.rpcResult?.recorded === false &&
    input.rpcResult.retryable === false &&
    input.rpcResult.reason === "unknown-provider-message"
  ) {
    return { acknowledge: true, reason: "unknown-provider-message" };
  }
  return { acknowledge: false, reason: input.rpcResult?.reason ?? "receipt-reconciliation-unavailable" };
}

export interface WhatsAppInboundDisposition {
  store: boolean;
  process: boolean;
  initiallyProcessed: boolean;
}

/**
 * Inbound text is always retained for a registered sender. Paused and revoked
 * senders accept only deterministic opt-outs. Other late messages are marked
 * processed immediately, so a later reactivation cannot turn them into a
 * candidate reply through recovery.
 */
export function decideWhatsAppInboundDisposition(input: {
  senderStatus: string | null | undefined;
  isOptOut: boolean;
}): WhatsAppInboundDisposition {
  const active = input.senderStatus === "active";
  const process = active || input.isOptOut;
  return { store: true, process, initiallyProcessed: !process };
}

export interface WhatsAppReviewableDraft {
  channel: string;
  status: string;
  type: string;
  reviewDecision: string | null;
}

/** Only an untouched, human-review candidate reply can be released. */
export function isReviewableWhatsAppDraft(draft: WhatsAppReviewableDraft): boolean {
  return (
    draft.channel === "WhatsApp" &&
    draft.status === "blocked" &&
    draft.type === "candidate_reply" &&
    draft.reviewDecision === null
  );
}

/** A transient dispatch-policy block must put a previously approved candidate
 * reply back into the same explicit human-review path, never orphan it. */
export function shouldReopenWhatsAppReview(draft: WhatsAppReviewableDraft): boolean {
  return (
    draft.channel === "WhatsApp" &&
    draft.status === "blocked" &&
    draft.type === "candidate_reply" &&
    draft.reviewDecision === "approved"
  );
}

export interface StoredWhatsAppInbound {
  processed: boolean;
  senderId: string | null;
}

/** A stored inbound record is safe to automate only with an unambiguous sender
 * mapping. Older unmapped records stay visible for manual triage. */
export function canRecoverStoredWhatsAppInbound(inbound: StoredWhatsAppInbound): boolean {
  return !inbound.processed && Boolean(inbound.senderId);
}
