// Inbound half of the LinkedIn reply loop. A vendor webhook delivers a candidate
// reply; this module stores it, resolves the launched campaign and the thread,
// decides whether an automatic reply is allowed (never without a live launch
// grant), composes the reply, books a meeting when the candidate named a time,
// and queues the reply 2 to 10 minutes out. Every refusal leaves the inbound
// visible for a human with a reason.

import { dedupeHash, gateOutbound } from "@/lib/gate";
import { humanizeText } from "@/lib/humanizer";
import {
  candidateDisclosureContextForCampaignLike,
  detectInjection,
  validateCandidateBoundText,
} from "@/lib/agent-disclosure-policy";
import {
  bookingConfirmCopy,
  decideLoopReply,
  detectBookingIntent,
  formatMeetingTime,
  isLoopOptOut,
  type LoopInboundEvent,
} from "@/lib/linkedin-loop";
import type { LinkedInLoopStore, LoopGrantRow, LoopThread } from "@/lib/linkedin-loop-store";
import { bookMeetingFromLoop, type LoopBookingDeps } from "@/lib/linkedin-booking";
import type { ReplyComposer } from "@/lib/reply-compose";

export interface LinkedInIngestDeps {
  store: LinkedInLoopStore;
  compose: ReplyComposer;
  /** Absent booking deps means booking intent goes to a human. */
  booking?: LoopBookingDeps;
  now?: () => Date;
}

export type LinkedInIngestResult =
  | { outcome: "scheduled"; replyId: string; sendAt: string; booked: boolean }
  | { outcome: "held"; reason: string; inboundId: string | null }
  | { outcome: "triage"; reason: string; inboundId: string | null }
  | { outcome: "skipped"; reason: string }
  | { outcome: "retry"; reason: string };

function briefRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function disclosureInternal(brief: Record<string, unknown>) {
  return {
    salaryMin: typeof brief.salaryMin === "number" ? brief.salaryMin : null,
    salaryMax: typeof brief.salaryMax === "number" ? brief.salaryMax : null,
    forbidden: [brief.department, brief.teamSize, brief.reportingTo, brief.currency].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ),
  };
}

/** Same wall as every other candidate-bound message: soft humanize, then the
 *  hard gate, disclosure and injection checks. Returns the sendable text or the
 *  reasons it must wait for a human. */
export function gateLoopReply(draft: string, brief: Record<string, unknown>, inbound: string): { text: string; reasons: string[] } {
  const cleaned = humanizeText(draft ?? "");
  const reasons: string[] = [];
  const gate = gateOutbound(cleaned);
  if (!gate.pass) reasons.push(...gate.reasons.map((r) => `gate:${r}`));
  const text = gate.pass ? gate.text : cleaned;
  const disclosure = validateCandidateBoundText(text, disclosureInternal(brief));
  if (!disclosure.safe && disclosure.reason) reasons.push(disclosure.reason);
  if (detectInjection(text).flagged || detectInjection(inbound).flagged) reasons.push("injection-suspected");
  return { text, reasons };
}

export async function ingestLinkedInInbound(deps: LinkedInIngestDeps, event: LoopInboundEvent): Promise<LinkedInIngestResult> {
  const now = deps.now?.() ?? new Date();
  const { store } = deps;

  // 1. Tenant comes from the launch grant that owns the vendor campaign.
  //    Unknown campaign: never guess a workspace, never store.
  const grant = await store.findGrantForInbound({ vendorCampaignId: event.vendorCampaignId });
  if (!grant) return { outcome: "skipped", reason: "no-campaign-launch" };

  // 2. Durable inbound, idempotent on the vendor message id.
  const receivedAt = new Date(Math.min(event.receivedAt, now.getTime() + 5 * 60_000)).toISOString();
  const inserted = await store.insertInbound({
    workspaceId: grant.workspaceId,
    profileUrl: event.profileUrl,
    body: event.text,
    providerId: event.providerId,
    receivedAt,
    campaignId: grant.campaignId,
  });
  if (!inserted.ok) {
    if ("duplicate" in inserted) return { outcome: "skipped", reason: "duplicate-inbound" };
    return { outcome: "retry", reason: "inbound-write-failed" };
  }
  const inboundId = inserted.id;

  const triage = async (reason: string): Promise<LinkedInIngestResult> => {
    await store.markInbound(inboundId, { processed: true, reason });
    return { outcome: "triage", reason, inboundId };
  };
  const hold = async (reason: string, conversationId?: string): Promise<LinkedInIngestResult> => {
    await store.markInbound(inboundId, { processed: true, reason, conversationId: conversationId ?? null });
    return { outcome: "held", reason, inboundId };
  };

  // 3. Opt-out is honored before any other decision, grant or not.
  if (isLoopOptOut(event.text)) {
    const recorded = await store.recordOptOut(grant.workspaceId, event.profileUrl, { providerId: event.providerId, at: receivedAt });
    if (!recorded) return { outcome: "retry", reason: "opt-out-write-failed" };
    if (!(await store.cancelQueuedReplies(grant.workspaceId, event.profileUrl))) {
      return { outcome: "retry", reason: "opt-out-cancellation-failed" };
    }
    return hold("opted-out");
  }

  // 4. Thread identity: only a profile Aria actually messaged inside this
  //    campaign has a conversation. Anyone else waits for a human.
  const thread: LoopThread | null = await store.resolveThread(grant.workspaceId, grant.campaignId, event.profileUrl);
  if (!thread) return triage("no-conversation");
  await store.markInbound(inboundId, { processed: false, conversationId: thread.conversationId });

  // 5. The fail-closed decision: launch grant live, kill switch off, loop
  //    enabled, not suppressed, daily cap left.
  const [controls, suppressed, sentToday] = await Promise.all([
    store.readControls(grant.workspaceId),
    store.isSuppressed(grant.workspaceId, event.profileUrl),
    store.countAttemptsToday(grant, now),
  ]);
  if (sentToday === null) return { outcome: "retry", reason: "attempt-count-unavailable" };
  const decision = decideLoopReply({
    now,
    seed: inboundId,
    grant,
    controls,
    inboundText: event.text,
    optedOut: suppressed,
    sentToday,
  });
  if (decision.action === "hold") return hold(decision.reason, thread.conversationId);

  // 6. Booking: a named time creates the real event now; the confirmation
  //    still waits the human delay. A failed calendar is never a booking.
  const brief = briefRecord(thread.roleBrief);
  const intent = detectBookingIntent(event.text, new Date(receivedAt), grant.timezone);
  let booked = false;
  let draft: string | null = null;
  if (intent.intent === "book" && intent.proposedStart) {
    if (!deps.booking) return triage("booking-needs-human");
    const result = await bookMeetingFromLoop(deps.booking, {
      workspaceId: grant.workspaceId,
      candidateId: thread.candidateId,
      candidateName: thread.candidateName || event.firstName,
      candidateEmail: "",
      role: grant.roleTitle || (typeof brief.title === "string" ? brief.title : ""),
      start: intent.proposedStart,
      timezone: grant.timezone,
      calendarSeatId: grant.calendarSeatId,
      interviewerEmail: grant.interviewerEmail,
      requestId: inboundId,
    });
    if (!result.booked) return triage(`booking-failed:${result.reason}`);
    booked = true;
    draft = bookingConfirmCopy({
      firstName: event.firstName,
      when: formatMeetingTime(intent.proposedStart, grant.timezone),
      link: result.link,
    });
  } else {
    const hint =
      intent.intent === "book"
        ? "They agreed to talk but named no time. Ask for one or two concrete slots this week or next, with their timezone."
        : undefined;
    draft = await deps.compose({
      inbound: event.text,
      lastOutbound: thread.lastOutboundBody,
      roleSummary: candidateDisclosureContextForCampaignLike(brief).slice(0, 2_000),
      hint,
    });
    if (!draft) return triage("reply-provider-unavailable");
  }

  // 7. Gate. A blocked draft is stored for review, never auto-sent.
  const gated = gateLoopReply(draft, brief, event.text);
  const status = gated.reasons.length === 0 ? "queued" : "blocked";
  const written = await store.insertReply({
    workspaceId: grant.workspaceId,
    grantId: grant.id,
    inboundId,
    conversationId: thread.conversationId,
    campaignId: grant.campaignId,
    candidateId: thread.candidateId,
    seatId: thread.seatId ?? grant.seatId,
    specId: thread.specId,
    ownerId: thread.ownerId,
    profileUrl: event.profileUrl,
    body: gated.text,
    status,
    gateResult: status === "queued" ? { pass: true, reasons: ["campaign-launch-grant"] } : { pass: false, reasons: gated.reasons },
    dedupeHash: dedupeHash(thread.candidateId, "LinkedIn", gated.text),
    scheduledAt: status === "queued" ? decision.sendAt.toISOString() : null,
  });
  if (!written.ok) {
    if ("duplicate" in written) return triage("reply-dedupe-conflict");
    return { outcome: "retry", reason: "reply-write-failed" };
  }
  await store.markInbound(inboundId, { processed: true, reason: null });
  if (status === "blocked") return { outcome: "triage", reason: `gate:${gated.reasons.join(",")}`, inboundId };
  return { outcome: "scheduled", replyId: written.id, sendAt: decision.sendAt.toISOString(), booked };
}
