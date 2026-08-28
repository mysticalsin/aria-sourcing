// A single, prioritized recommendation queue -- replaces the topbar bell and the
// dashboard "Attention needed" panel's duplicate rendering of the same three KPI
// counts. Derived fresh from live state every call (not a persisted event log):
// it cannot drift from reality, needs no read/unread bookkeeping, and is
// structurally capped + ranked + rolled-up so volume can't fan out into a
// notification firehose. Items disappear on their own once acted on through the
// existing flows (approve a draft, answer a reply, book an interview) -- there is
// no separate "dismiss" state to maintain.
//
// Priority ordering (approved): SLA risk first, then match score, then stage
// leverage. The score bands below are scaled so each tier can never be
// overridden by the one below it (SLA urgency dominates at up to 20,000 --
// 10,000 while still ticking down to a breach, escalating past that ceiling
// once breached so an overdue reply always outranks a merely-imminent one;
// match score contributes 0-100; stage leverage is a single-digit tiebreak).

import type { HermesState, OutreachMessage } from "./types";
import type { Tone } from "./utils";
import { daysSince } from "./rules";

export type RecommendationKind =
  | "hot_reply"
  | "approve_outreach"
  | "send_outreach"
  | "book_interview"
  | "follow_up_due"
  | "stalled_draft"
  | "source_campaign";

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  title: string;
  why: string;
  href: string;
  tone: Tone;
  priorityScore: number;
  /** >1 when this row is a rolled-up group ("+N more ...") rather than one item. */
  count: number;
}

/** Hard cap on individual rows shown; everything beyond this rolls up by kind. */
const MAX_ROWS = 8;

const STAGE_LEVERAGE: Record<RecommendationKind, number> = {
  hot_reply: 1,
  follow_up_due: 2,
  source_campaign: 3,
  approve_outreach: 5,
  send_outreach: 5,
  stalled_draft: 6,
  book_interview: 8,
};

const ROLLUP_LABEL: Record<RecommendationKind, string> = {
  hot_reply: "replies to answer",
  approve_outreach: "drafts to approve",
  send_outreach: "approved messages to send",
  book_interview: "candidates to book",
  follow_up_due: "follow-ups due",
  stalled_draft: "stalled drafts",
  source_campaign: "campaigns to source",
};

const KIND_TONE: Record<RecommendationKind, Tone> = {
  hot_reply: "tangerine",
  approve_outreach: "warning",
  send_outreach: "danger",
  book_interview: "violet",
  follow_up_due: "aqua",
  stalled_draft: "danger",
  source_campaign: "electric",
};

const KIND_HREF: Record<RecommendationKind, string> = {
  hot_reply: "/replies",
  approve_outreach: "/outreach",
  send_outreach: "/outreach",
  book_interview: "/calendar",
  follow_up_due: "/outreach",
  stalled_draft: "/outreach",
  source_campaign: "/campaigns",
};

/** Outreach messages sitting in Draft/Needs Approval this long without action
 *  escalate to a stalled-draft nudge instead of quietly aging in place. */
const STALLED_DRAFT_DAYS = 2;

/**
 * 0 (no SLA / not urgent) to 1000 (imminent), climbing as the deadline
 * approaches over ~48h out. Once the deadline has passed, escalates past that
 * 1000 ceiling (up to 2000, growing with how long it's been overdue) instead
 * of plateauing at the same score as "about to breach" -- a breached reply
 * must always outrank every not-yet-breached one, even a lower-match one, so
 * it sorts to the top rather than sinking as fresher SLAs pile up.
 */
function slaUrgency(dueAt: string | null, now: number): number {
  if (!dueAt) return 0;
  const hoursLeft = (new Date(dueAt).getTime() - now) / (60 * 60 * 1000);
  if (hoursLeft <= 0) {
    const hoursOverdue = -hoursLeft;
    return 1100 + Math.min(900, hoursOverdue * (900 / 48));
  }
  return Math.max(0, Math.min(1000, 1000 - hoursLeft * (1000 / 48)));
}

/* ---- Follow-up sequences: derived due-queue, no background job ----------- */

export interface FollowUpDueItem {
  candidateId: string;
  campaignId: string;
  matchScore: number;
  /** Days since lastContactedAt, at the `now` the selector was evaluated with. */
  daysSinceContact: number;
  /** The sequenceStep the next drafted follow-up should use (prior max + 1). */
  nextSequenceStep: number;
}

function maxSequenceStepFor(outreach: OutreachMessage[], candidateId: string): number {
  return outreach
    .filter((m) => m.candidateId === candidateId)
    .reduce((max, m) => Math.max(max, m.sequenceStep), 0);
}

/** True when this candidate already has an un-actioned draft sitting in the
 *  approval queue -- either from a prior follow-up draft or any other source.
 *  Guards against re-drafting the same follow-up on every call. */
export function hasPendingDraft(outreach: OutreachMessage[], candidateId: string): boolean {
  return outreach.some(
    (m) => m.candidateId === candidateId && (m.status === "Needs Approval" || m.status === "Draft"),
  );
}

/**
 * Candidates who were contacted, never replied, and have gone quiet longer
 * than the campaign/settings follow-up gap. Pure and derived fresh from live
 * state every call, matching deriveRecommendations' style: the UI promises
 * "auto follow-up after Nd of silence" (outreach-message-card.tsx), and this
 * is the selector that makes that promise real -- as a due-queue feeding the
 * human approval gate, never as a background job that sends anything itself.
 */
export function deriveFollowUpsDue(state: HermesState, now: number = Date.now()): FollowUpDueItem[] {
  const gapDays = state.settings.rateLimits.followUpGapDays;
  // OOO is a pause signal, not a real reply (the state machine deliberately
  // leaves stage as Contacted for it — see classifyAndStoreReply) -- excluded
  // here too so an auto-responder doesn't permanently block re-nomination.
  const repliedCandidateIds = new Set(
    state.replies.filter((r) => r.intent !== "OOO").map((r) => r.candidateId),
  );
  const out: FollowUpDueItem[] = [];

  for (const c of state.candidates) {
    if (c.stage !== "Contacted") continue;
    if (!c.lastContactedAt) continue;
    if (c.complianceFlags.doNotContact || c.complianceFlags.unsubscribed || c.complianceFlags.suppressed) continue;
    // Belt-and-suspenders: the state machine already flips Contacted -> Replied
    // the moment a non-OOO reply lands, so these two checks are normally
    // redundant -- keep both anyway so a candidate can never be nudged for a
    // follow-up when a real reply already exists in either record.
    if (c.replyHistory.some((r) => r.intent !== "OOO") || repliedCandidateIds.has(c.id)) continue;
    const daysSinceContact = daysSince(c.lastContactedAt, now);
    if (daysSinceContact < gapDays) continue;
    if (hasPendingDraft(state.outreach, c.id)) continue;

    out.push({
      candidateId: c.id,
      campaignId: c.campaignId,
      matchScore: c.matchScore,
      daysSinceContact,
      nextSequenceStep: maxSequenceStepFor(state.outreach, c.id) + 1,
    });
  }

  return out;
}

interface ScoredItem {
  kind: RecommendationKind;
  entityId: string;
  title: string;
  slaDueAt: string | null;
  matchScore: number;
  priorityScore: number;
  /** Overrides the default SLA/match-score "why" text when set. */
  why?: string;
}

export function deriveRecommendations(state: HermesState, now: number = Date.now()): Recommendation[] {
  const candidateById = new Map(state.candidates.map((c) => [c.id, c]));
  const items: ScoredItem[] = [];

  for (const r of state.replies) {
    if (r.handled) continue;
    if (r.intent !== "INTERESTED" && r.intent !== "QUALIFIED_INTEREST") continue;
    const cand = candidateById.get(r.candidateId);
    const matchScore = cand?.matchScore ?? 0;
    items.push({
      kind: "hot_reply",
      entityId: r.id,
      title: cand ? `Reply from ${cand.name}` : "Reply from an interested candidate",
      slaDueAt: r.slaDueAt,
      matchScore,
      priorityScore: slaUrgency(r.slaDueAt, now) * 10 + matchScore + STAGE_LEVERAGE.hot_reply,
    });
  }

  for (const m of state.outreach) {
    if (m.status !== "Draft" && m.status !== "Needs Approval" && m.status !== "Pending Manual Send") continue;
    const cand = candidateById.get(m.candidateId);
    const matchScore = cand?.matchScore ?? 0;

    // Draft / Needs Approval messages that have sat unapproved too long escalate
    // to a stalled nudge -- this is also the only place a plain Draft (which
    // otherwise never reaches the approval queue) can surface at all.
    if (m.status !== "Pending Manual Send" && daysSince(m.createdAt, now) >= STALLED_DRAFT_DAYS) {
      items.push({
        kind: "stalled_draft",
        entityId: m.id,
        title: cand ? `Stalled draft to ${cand.name}` : "A stalled outreach draft",
        slaDueAt: null,
        matchScore,
        why: `Unapproved for ${Math.floor(daysSince(m.createdAt, now))}d`,
        priorityScore: matchScore + STAGE_LEVERAGE.stalled_draft,
      });
      continue;
    }

    if (m.status === "Draft") continue; // fresh drafts aren't actionable yet

    items.push({
      kind: "approve_outreach",
      entityId: m.id,
      title: cand ? `Approve outreach to ${cand.name}` : "Approve an outreach draft",
      slaDueAt: null,
      matchScore,
      priorityScore: matchScore + STAGE_LEVERAGE.approve_outreach,
    });
  }

  for (const m of state.outreach) {
    if (m.status !== "Approved" || m.dryRun === true) continue;
    const cand = candidateById.get(m.candidateId);
    const matchScore = cand?.matchScore ?? 0;
    items.push({
      kind: "send_outreach",
      entityId: m.id,
      title: cand ? `Send approved outreach to ${cand.name}` : "Send an approved outreach message",
      slaDueAt: null,
      matchScore,
      priorityScore: matchScore + STAGE_LEVERAGE.send_outreach,
    });
  }

  for (const c of state.candidates) {
    if (c.stage !== "Interested" || c.booking) continue;
    items.push({
      kind: "book_interview",
      entityId: c.id,
      title: `Book an interview with ${c.name}`,
      slaDueAt: null,
      matchScore: c.matchScore,
      priorityScore: c.matchScore + STAGE_LEVERAGE.book_interview,
    });
  }

  for (const f of deriveFollowUpsDue(state, now)) {
    const cand = candidateById.get(f.candidateId);
    items.push({
      kind: "follow_up_due",
      entityId: f.candidateId,
      title: cand ? `Follow up with ${cand.name}` : "Follow up with a candidate",
      slaDueAt: null,
      matchScore: f.matchScore,
      why: `${Math.floor(f.daysSinceContact)}d of silence, no reply yet`,
      priorityScore: f.matchScore + STAGE_LEVERAGE.follow_up_due,
    });
  }

  for (const c of state.campaigns) {
    if (c.status !== "Sourcing") continue;
    const campaignCandidates = state.candidates.filter((cand) => cand.campaignId === c.id);
    const noneSourced = campaignCandidates.length === 0;
    const noneProgressed = !noneSourced && campaignCandidates.every((cand) => cand.stage === "Sourced");
    if (!noneSourced && !noneProgressed) continue;

    items.push({
      kind: "source_campaign",
      entityId: c.id,
      title: `Source candidates for ${c.title}`,
      slaDueAt: null,
      matchScore: 0,
      why: noneSourced ? "No candidates sourced yet" : `${campaignCandidates.length} sourced, none contacted yet`,
      priorityScore: STAGE_LEVERAGE.source_campaign,
    });
  }

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  const top = items.slice(0, MAX_ROWS);
  const rest = items.slice(MAX_ROWS);

  const recs: Recommendation[] = top.map((it) => ({
    id: `${it.kind}:${it.entityId}`,
    kind: it.kind,
    title: it.title,
    why: it.why ?? (it.slaDueAt ? `SLA due ${new Date(it.slaDueAt).toLocaleString()}` : `Match score ${it.matchScore}`),
    href: KIND_HREF[it.kind],
    tone: KIND_TONE[it.kind],
    priorityScore: it.priorityScore,
    count: 1,
  }));

  // Roll up anything beyond the cap, grouped by kind, so volume can't fan out into rows.
  const restByKind = new Map<RecommendationKind, ScoredItem[]>();
  for (const it of rest) {
    const list = restByKind.get(it.kind) ?? [];
    list.push(it);
    restByKind.set(it.kind, list);
  }
  for (const [kind, list] of restByKind) {
    recs.push({
      id: `${kind}:rollup`,
      kind,
      title: `+${list.length} more ${ROLLUP_LABEL[kind]}`,
      why: "",
      href: KIND_HREF[kind],
      tone: KIND_TONE[kind],
      // Sits just below the individually-shown items of the same kind so it never outranks them.
      priorityScore: Math.max(...list.map((x) => x.priorityScore)) - 0.01,
      count: list.length,
    });
  }

  return recs.sort((a, b) => b.priorityScore - a.priorityScore);
}
