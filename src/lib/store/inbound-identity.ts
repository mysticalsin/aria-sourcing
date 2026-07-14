import type { Candidate, ClassifiedReply, OutreachMessage } from "../types";

export type InboundEmailIdentity =
  | { status: "matched"; candidateId: string; campaignId: string }
  | { status: "ambiguous" }
  | { status: "unmatched" };

/**
 * Resolve an auto-ingested inbound email to a candidate. Replies route by
 * provider context and the canonical conversation, never by the active
 * campaign or an arbitrary first match:
 *
 *   (a) Canonical conversation — the provider thread id (Gmail threadId /
 *       Graph conversationId) is the strongest identity. A prior classified
 *       reply or an outbound draft already bound to this exact thread names
 *       the candidate, regardless of address collisions across campaigns.
 *   (b) Address identity — only an UNAMBIGUOUS address match may auto-assign.
 *       Two candidates sharing the sender address is an ambiguous outcome and
 *       fails closed ('ambiguous') so the reply lands unassigned in the
 *       Replies stream for human triage.
 *
 * Kept beside matchCandidateByEmail (email-match.ts) rather than replacing it:
 * that helper's first-match, campaign-scoped semantics are pinned by
 * tests/email-match.mts and still serve explicit-scope callers.
 */
export function resolveInboundEmailIdentity(input: {
  candidates: Candidate[];
  replies: ClassifiedReply[];
  outreach: OutreachMessage[];
  fromAddress?: string;
  inboxThreadId?: string;
}): InboundEmailIdentity {
  if (input.inboxThreadId) {
    const priorReply = input.replies.find(
      (r) => r.inboxThreadId === input.inboxThreadId && r.candidateId,
    );
    if (priorReply) {
      return {
        status: "matched",
        candidateId: priorReply.candidateId,
        campaignId: priorReply.campaignId,
      };
    }
    const priorOutbound = input.outreach.find(
      (m) => m.inboxThreadId === input.inboxThreadId && m.candidateId,
    );
    if (priorOutbound) {
      return {
        status: "matched",
        candidateId: priorOutbound.candidateId,
        campaignId: priorOutbound.campaignId,
      };
    }
  }

  const addr = (input.fromAddress ?? "").trim().toLowerCase();
  if (!addr) return { status: "unmatched" };
  const matchedIds = new Set<string>();
  let matched: Candidate | undefined;
  for (const c of input.candidates) {
    if (c.email.trim().toLowerCase() === addr) {
      matchedIds.add(c.id);
      matched ??= c;
    }
  }
  if (matchedIds.size > 1) return { status: "ambiguous" };
  if (matchedIds.size === 1 && matched) {
    return { status: "matched", candidateId: matched.id, campaignId: matched.campaignId };
  }
  return { status: "unmatched" };
}
