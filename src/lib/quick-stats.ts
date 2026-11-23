/**
 * Command Center quick stats. Each selector is one metric card.
 * A missing collection is null. An empty collection is zero.
 */

import type { Tone } from "./utils";
import { formatNumber, SEED_NOW } from "./utils";

export const QUICK_STAT_IDS = [
  "toRate",
  "inAssessment",
  "interviewsThisWeek",
  "awaitingApproval",
  "replies",
  "hires",
] as const;

export type QuickStatId = (typeof QUICK_STAT_IDS)[number];

export interface QuickStatCandidate {
  stage?: string | null;
}

export interface QuickStatInterview {
  startTime?: string | null;
  status?: string | null;
}

export interface QuickStatApproval {
  status?: string | null;
}

export interface QuickStatReply {
  id?: string | null;
}

export interface QuickStatSource {
  candidates?: readonly QuickStatCandidate[] | null;
  interviews?: readonly QuickStatInterview[] | null;
  approvals?: readonly QuickStatApproval[] | null;
  replies?: readonly QuickStatReply[] | null;
  now?: Date;
}

export interface QuickStat {
  id: QuickStatId;
  label: string;
  value: number | null;
  hint: string;
  tone: Tone;
}

const TO_RATE = new Set(["Sourced", "To Rate"]);
const IN_ASSESSMENT = new Set(["Contacted", "To Assess"]);
const HIRED = new Set(["Hired"]);
const AWAITING = new Set(["Needs Approval"]);
const CLOSED_INTERVIEW = new Set(["Cancelled", "No Show"]);
const WEEK_MS = 7 * 86_400_000;

const PRESENT: Record<QuickStatId, { label: string; hint: string; tone: Tone }> = {
  toRate: {
    label: "Candidates to rate",
    hint: "Sourced profiles waiting for a human rating",
    tone: "tangerine",
  },
  inAssessment: {
    label: "In assessment",
    hint: "Contacted profiles in assessment",
    tone: "electric",
  },
  interviewsThisWeek: {
    label: "Interviews this week",
    hint: "Booked inside this UTC week, cancellations excluded",
    tone: "violet",
  },
  awaitingApproval: {
    label: "Outreach awaiting approval",
    hint: "Exact text still waiting for approval",
    tone: "warning",
  },
  replies: {
    label: "Replies",
    hint: "Replies received",
    tone: "aqua",
  },
  hires: {
    label: "Hires",
    hint: "Stage Hired",
    tone: "success",
  },
};

function countWhere<T>(rows: readonly T[] | null | undefined, include: (row: T) => boolean): number | null {
  if (rows == null) return null;
  let count = 0;
  for (const row of rows) if (include(row)) count += 1;
  return count;
}

export function selectCandidatesToRate(
  candidates: readonly QuickStatCandidate[] | null | undefined,
): number | null {
  return countWhere(candidates, (candidate) => candidate.stage != null && TO_RATE.has(candidate.stage));
}

export function selectInAssessment(
  candidates: readonly QuickStatCandidate[] | null | undefined,
): number | null {
  return countWhere(candidates, (candidate) => candidate.stage != null && IN_ASSESSMENT.has(candidate.stage));
}

/** Monday 00:00 UTC through the following Monday, in milliseconds. */
export function startOfUtcWeek(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysFromMonday = (now.getUTCDay() + 6) % 7;
  return midnight - daysFromMonday * 86_400_000;
}

/**
 * Demo stats use the seed clock. A live workspace passes synthetic: false
 * and gets the wall clock. Callers may inject `now` in tests.
 */
export function quickStatNow(input?: { now?: Date; synthetic?: boolean }): Date {
  if (input?.now) return input.now;
  if (input?.synthetic === false) return new Date();
  return SEED_NOW;
}

export function selectInterviewsThisWeek(
  interviews: readonly QuickStatInterview[] | null | undefined,
  now: Date,
): number | null {
  if (interviews == null) return null;
  const start = startOfUtcWeek(now);
  const end = start + WEEK_MS;
  let count = 0;
  for (const interview of interviews) {
    if (!interview.startTime) continue;
    if (interview.status && CLOSED_INTERVIEW.has(interview.status)) continue;
    const time = Date.parse(interview.startTime);
    if (Number.isNaN(time) || time < start || time >= end) continue;
    count += 1;
  }
  return count;
}

export function selectAwaitingApproval(
  approvals: readonly QuickStatApproval[] | null | undefined,
): number | null {
  return countWhere(approvals, (approval) => approval.status != null && AWAITING.has(approval.status));
}

export function selectReplies(replies: readonly QuickStatReply[] | null | undefined): number | null {
  if (replies == null) return null;
  return replies.length;
}

export function selectHires(candidates: readonly QuickStatCandidate[] | null | undefined): number | null {
  return countWhere(candidates, (candidate) => candidate.stage != null && HIRED.has(candidate.stage));
}

export function formatQuickStatValue(value: number | null): string {
  if (value == null) return "—";
  return formatNumber(value);
}

function stat(id: QuickStatId, value: number | null): QuickStat {
  const present = PRESENT[id];
  return {
    id,
    label: present.label,
    value,
    hint: value == null ? "Count unavailable" : present.hint,
    tone: present.tone,
  };
}

export function selectQuickStats(source: QuickStatSource): QuickStat[] {
  const now = source.now ?? new Date();
  return [
    stat("toRate", selectCandidatesToRate(source.candidates)),
    stat("inAssessment", selectInAssessment(source.candidates)),
    stat("interviewsThisWeek", selectInterviewsThisWeek(source.interviews, now)),
    stat("awaitingApproval", selectAwaitingApproval(source.approvals)),
    stat("replies", selectReplies(source.replies)),
    stat("hires", selectHires(source.candidates)),
  ];
}
