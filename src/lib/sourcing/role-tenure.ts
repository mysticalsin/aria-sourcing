/**
 * Role-tenure contact timing — skip people who just started a new job.
 * Preferred outreach window is 6–12 months in the current role.
 */

import type { Candidate } from "../types";

export const MIN_MONTHS_BEFORE_CONTACT = 6;
export const PREFERRED_MONTHS_IN_ROLE_MAX = 12;

export type RoleTenureTiming = "too_early" | "preferred" | "established" | "unknown";

export interface RoleTenureAssessment {
  monthsInRole: number | null;
  timing: RoleTenureTiming;
  label: string;
  detail: string;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const PRESENT_RE = /\b(?:present|current|now)\b/i;
const START_TO_PRESENT_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\s*[-–—to]+\s*(?:present|current|now)\b/i;
const YEAR_TO_PRESENT_RE = /\b(20\d{2})\s*[-–—to]+\s*(?:present|current|now)\b/i;
const EXPLICIT_TENURE_RE =
  /\b(?:(\d+)\s*yrs?(?:\s+(\d+)\s*mos?)?|(?<![–—\-]\s*)(\d+)\s*mo(?:nth)?s?\b)(?!\s*[-–—]\s*\d)/i;
const JUST_STARTED_RE =
  /\b(?:just\s+started|recently\s+(?:joined|started)|new\s+(?:to\s+the\s+)?role|started\s+(?:this|last)\s+month)\b/i;

function monthsBetween(start: Date, now: Date): number {
  const years = now.getUTCFullYear() - start.getUTCFullYear();
  const months = now.getUTCMonth() - start.getUTCMonth();
  const total = years * 12 + months;
  // If the day-of-month hasn't arrived yet this month, still count the started month.
  return Math.max(0, total);
}

function parseStartMonthYear(text: string): Date | null {
  const match = START_TO_PRESENT_RE.exec(text);
  if (!match) {
    const yearOnly = YEAR_TO_PRESENT_RE.exec(text);
    if (!yearOnly) return null;
    const year = Number(yearOnly[1]);
    if (!Number.isFinite(year) || year < 1990 || year > 2100) return null;
    return new Date(Date.UTC(year, 0, 1));
  }
  const month = MONTH_INDEX[match[1].toLowerCase()];
  const year = Number(match[2]);
  if (month === undefined || !Number.isFinite(year) || year < 1990 || year > 2100) return null;
  return new Date(Date.UTC(year, month, 1));
}

function parseExplicitTenureMonths(text: string): number | null {
  const match = EXPLICIT_TENURE_RE.exec(text);
  if (!match) return null;
  if (match[1] !== undefined) {
    const years = Number(match[1]);
    const months = match[2] !== undefined ? Number(match[2]) : 0;
    if (!Number.isFinite(years) || !Number.isFinite(months)) return null;
    return years * 12 + months;
  }
  const monthsOnly = Number(match[3]);
  return Number.isFinite(monthsOnly) ? monthsOnly : null;
}

/** Prefer current-role signals from experience lines, then recentActivity. */
export function roleTenureCorpus(
  candidate: Pick<Candidate, "recentActivity" | "experience" | "currentTitle" | "currentCompany">,
): string {
  const currentExp = (candidate.experience ?? []).find((line) => PRESENT_RE.test(line)) ?? "";
  return [currentExp, candidate.recentActivity, candidate.currentTitle, candidate.currentCompany]
    .filter(Boolean)
    .join("\n");
}

export function inferMonthsInCurrentRole(
  candidate: Pick<Candidate, "recentActivity" | "experience" | "currentTitle" | "currentCompany">,
  now: Date = new Date(),
): number | null {
  const corpus = roleTenureCorpus(candidate);
  if (!corpus.trim()) return null;

  if (JUST_STARTED_RE.test(corpus)) return 1;

  // Prefer an explicit start→Present date over free-text "N mo" counts, so
  // advisory copy like "6–12 month window" cannot override the real start.
  const start = parseStartMonthYear(corpus);
  if (start) return monthsBetween(start, now);

  const explicit = parseExplicitTenureMonths(corpus);
  if (explicit !== null) return explicit;

  return null;
}

export function roleTenureTiming(monthsInRole: number | null): RoleTenureTiming {
  if (monthsInRole === null) return "unknown";
  if (monthsInRole < MIN_MONTHS_BEFORE_CONTACT) return "too_early";
  if (monthsInRole <= PREFERRED_MONTHS_IN_ROLE_MAX) return "preferred";
  return "established";
}

export function assessRoleTenure(
  candidate: Pick<Candidate, "recentActivity" | "experience" | "currentTitle" | "currentCompany">,
  now: Date = new Date(),
): RoleTenureAssessment {
  const monthsInRole = inferMonthsInCurrentRole(candidate, now);
  const timing = roleTenureTiming(monthsInRole);

  if (timing === "too_early") {
    return {
      monthsInRole,
      timing,
      label: "Too early",
      detail: `Only ~${monthsInRole} mo in current role — wait until ${MIN_MONTHS_BEFORE_CONTACT}–${PREFERRED_MONTHS_IN_ROLE_MAX} months before outreach.`,
    };
  }
  if (timing === "preferred") {
    return {
      monthsInRole,
      timing,
      label: "Contact window",
      detail: `~${monthsInRole} mo in current role — inside the preferred ${MIN_MONTHS_BEFORE_CONTACT}–${PREFERRED_MONTHS_IN_ROLE_MAX} month outreach window.`,
    };
  }
  if (timing === "established") {
    return {
      monthsInRole,
      timing,
      label: "Established",
      detail: `~${monthsInRole} mo in current role — past the preferred ${MIN_MONTHS_BEFORE_CONTACT}–${PREFERRED_MONTHS_IN_ROLE_MAX} month window; still contactable.`,
    };
  }
  return {
    monthsInRole: null,
    timing: "unknown",
    label: "Tenure unknown",
    detail: `Current-role tenure not confirmed — prefer people ${MIN_MONTHS_BEFORE_CONTACT}–${PREFERRED_MONTHS_IN_ROLE_MAX} months into a role.`,
  };
}

/** True when auto-draft / contact should proceed (blocks only explicit too-early). */
export function isContactReadyByTenure(
  candidate: Pick<Candidate, "recentActivity" | "experience" | "currentTitle" | "currentCompany">,
  now: Date = new Date(),
): boolean {
  return assessRoleTenure(candidate, now).timing !== "too_early";
}
