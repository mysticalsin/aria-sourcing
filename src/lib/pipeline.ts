/* ============================================================================
   Pipeline board model — pure, dependency-free.
   Orders active candidates by what the recruiter has to do next, one column
   per next action, and flags the cards that have waited too long. Columns
   group under the TAnIA funnel stages (Leads / Candidates / Offered /
   Employees) so the board reads the same as the rest of the app.
   ========================================================================== */

import type { Candidate, CandidateStage, TaniaStage } from "./types";

export type PipelineColumnKey =
  | "toContact"
  | "awaitingReply"
  | "replied"
  | "toBook"
  | "interviewing"
  | "offer"
  | "hired";

export interface PipelineColumn {
  key: PipelineColumnKey;
  label: string;
  /** Underlying candidate stages shown in this column. */
  stages: CandidateStage[];
  /** TAnIA funnel stage the column belongs to. */
  group: TaniaStage;
  /** The recruiter's next action for a card here. */
  nextAction: string;
  /** Days of inactivity before a card is flagged overdue; "followUpGap" reads
   *  the workspace follow-up gap; null never flags. */
  overdueAfterDays: number | "followUpGap" | null;
  /** Stage a dropped card is set to. Absent = not a drop target: those stages
   *  move through outreach and replies, not by hand (same set as the drawer). */
  dropStage?: CandidateStage;
}

export const PIPELINE_COLUMNS: readonly PipelineColumn[] = [
  {
    key: "toContact",
    label: "To contact",
    stages: ["Sourced"],
    group: "Leads",
    nextAction: "Check the fit, find a contact, approve the first message",
    overdueAfterDays: 3,
  },
  {
    key: "awaitingReply",
    label: "Awaiting reply",
    stages: ["Contacted"],
    group: "Leads",
    nextAction: "Follow up after the silence gap",
    overdueAfterDays: "followUpGap",
  },
  {
    key: "replied",
    label: "Replied",
    stages: ["Replied"],
    group: "Leads",
    nextAction: "Read the reply and answer",
    overdueAfterDays: 1,
  },
  {
    key: "toBook",
    label: "To book",
    stages: ["Interested"],
    group: "Candidates",
    nextAction: "Book the prequal call",
    overdueAfterDays: 2,
  },
  {
    key: "interviewing",
    label: "Interviewing",
    stages: ["Booked", "Interviewed"],
    group: "Candidates",
    nextAction: "Collect the feedback and decide",
    overdueAfterDays: 7,
    dropStage: "Interviewed",
  },
  {
    key: "offer",
    label: "Offer out",
    stages: ["Offer"],
    group: "Offered",
    nextAction: "Chase the answer and the signature",
    overdueAfterDays: 7,
    dropStage: "Offer",
  },
  {
    key: "hired",
    label: "Hired",
    stages: ["Hired"],
    group: "Employees",
    nextAction: "Hand over to onboarding",
    overdueAfterDays: null,
    dropStage: "Hired",
  },
];

export function pipelineColumnFor(stage: CandidateStage): PipelineColumn | null {
  return PIPELINE_COLUMNS.find((col) => col.stages.includes(stage)) ?? null;
}

const DAY_MS = 86_400_000;

/** Latest dated thing that happened to a candidate, never in the future. */
export function lastActivityAt(c: Candidate, now: number): number {
  const stamps = [
    c.createdAt,
    c.lastContactedAt,
    c.lastRepliedAt,
    c.booking?.startTime,
    ...(c.notes ?? []).map((n) => n.at),
    ...(c.interviews ?? []).map((i) => i.scheduledFor),
  ];
  let latest = 0;
  for (const iso of stamps) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isFinite(t) && t <= now && t > latest) latest = t;
  }
  return latest || now;
}

function contactBlocked(c: Candidate): boolean {
  const f = c.complianceFlags;
  return f.doNotContact || f.suppressed || f.unsubscribed;
}

export interface PipelineEntry {
  candidate: Candidate;
  column: PipelineColumnKey;
  /** Whole days since the last activity (since first contact while awaiting a reply). */
  waitingDays: number;
  overdue: boolean;
}

export interface PipelineBoard {
  columns: Record<PipelineColumnKey, PipelineEntry[]>;
  overdue: number;
  /** Rejected, not interested or suppressed, outside the talent pool. */
  closed: number;
  /** Closed but kept warm in the talent pool. */
  pooled: number;
}

export function buildPipeline(
  candidates: readonly Candidate[],
  opts: { now: number; followUpGapDays: number },
): PipelineBoard {
  const columns = Object.fromEntries(PIPELINE_COLUMNS.map((col) => [col.key, [] as PipelineEntry[]])) as Record<
    PipelineColumnKey,
    PipelineEntry[]
  >;
  let overdue = 0;
  let closed = 0;
  let pooled = 0;

  for (const c of candidates) {
    const col = pipelineColumnFor(c.stage);
    if (!col) {
      if (c.vivier) pooled += 1;
      else closed += 1;
      continue;
    }
    // Awaiting a reply counts from the last message, like the follow-up queue.
    const since =
      col.key === "awaitingReply" && c.lastContactedAt
        ? new Date(c.lastContactedAt).getTime()
        : lastActivityAt(c, opts.now);
    const waitingDays = Math.max(0, Math.floor((opts.now - since) / DAY_MS));
    const limit = col.overdueAfterDays === "followUpGap" ? opts.followUpGapDays : col.overdueAfterDays;
    const isOverdue = limit !== null && waitingDays >= limit && !contactBlocked(c);
    if (isOverdue) overdue += 1;
    columns[col.key].push({ candidate: c, column: col.key, waitingDays, overdue: isOverdue });
  }

  // Overdue first (longest wait on top), then the best match.
  for (const list of Object.values(columns)) {
    list.sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (a.overdue ? b.waitingDays - a.waitingDays : 0) ||
        b.candidate.matchScore - a.candidate.matchScore,
    );
  }

  return { columns, overdue, closed, pooled };
}
