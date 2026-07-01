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
// overridden by the one below it (SLA urgency dominates at up to 10,000; match
// score contributes 0-100; stage leverage is a single-digit tiebreak).

import type { HermesState } from "./types";
import type { Tone } from "./utils";

export type RecommendationKind = "hot_reply" | "approve_outreach" | "book_interview";

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
  approve_outreach: 5,
  book_interview: 8,
};

const ROLLUP_LABEL: Record<RecommendationKind, string> = {
  hot_reply: "replies to answer",
  approve_outreach: "drafts to approve",
  book_interview: "candidates to book",
};

const KIND_TONE: Record<RecommendationKind, Tone> = {
  hot_reply: "tangerine",
  approve_outreach: "warning",
  book_interview: "violet",
};

const KIND_HREF: Record<RecommendationKind, string> = {
  hot_reply: "/replies",
  approve_outreach: "/outreach",
  book_interview: "/calendar",
};

/** 0 (no SLA / not urgent) to 1000 (breached or imminent), decaying to 0 over ~48h out. */
function slaUrgency(dueAt: string | null, now: number): number {
  if (!dueAt) return 0;
  const hoursLeft = (new Date(dueAt).getTime() - now) / (60 * 60 * 1000);
  return Math.max(0, Math.min(1000, 1000 - hoursLeft * (1000 / 48)));
}

interface ScoredItem {
  kind: RecommendationKind;
  entityId: string;
  title: string;
  slaDueAt: string | null;
  matchScore: number;
  priorityScore: number;
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
    if (m.status !== "Needs Approval" && m.status !== "Pending Manual Send") continue;
    const cand = candidateById.get(m.candidateId);
    const matchScore = cand?.matchScore ?? 0;
    items.push({
      kind: "approve_outreach",
      entityId: m.id,
      title: cand ? `Approve outreach to ${cand.name}` : "Approve an outreach draft",
      slaDueAt: null,
      matchScore,
      priorityScore: matchScore + STAGE_LEVERAGE.approve_outreach,
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

  items.sort((a, b) => b.priorityScore - a.priorityScore);

  const top = items.slice(0, MAX_ROWS);
  const rest = items.slice(MAX_ROWS);

  const recs: Recommendation[] = top.map((it) => ({
    id: `${it.kind}:${it.entityId}`,
    kind: it.kind,
    title: it.title,
    why: it.slaDueAt ? `SLA due ${new Date(it.slaDueAt).toLocaleString()}` : `Match score ${it.matchScore}`,
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
