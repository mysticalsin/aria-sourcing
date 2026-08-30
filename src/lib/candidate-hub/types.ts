/**
 * Candidate Hub — Omogen-competitive public apply + async screening + self-serve next step.
 * Deliberately excludes voice/phone calling (owner scope).
 */

export type HubLocale = "fr" | "en" | "es";

export type HubCriterionId =
  | "location"
  | "visa"
  | "experience"
  | "core_skills"
  | "tools"
  | "availability"
  | "language";

export interface HubCriterion {
  id: HubCriterionId;
  label: Record<HubLocale, string>;
  weight: number; // sums to 100 across catalog role
}

export interface HubScreeningQuestion {
  id: string;
  kind: "yesno" | "stars" | "choice" | "text";
  criterionId: HubCriterionId;
  prompt: Record<HubLocale, string>;
  choices?: { value: string; label: Record<HubLocale, string> }[];
}

export interface HubRole {
  slug: string;
  title: Record<HubLocale, string>;
  department: string;
  seniority: string;
  employmentType: string;
  locationType: string;
  regions: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  summary: Record<HubLocale, string>;
  criteria: HubCriterion[];
  questions: HubScreeningQuestion[];
  /** LinkedIn-ready search hint for recruiters sourcing this hub. */
  linkedInSearchHint: string;
}

export interface HubApplyAnswer {
  questionId: string;
  value: string;
  stars?: number;
}

export interface HubApplyInput {
  locale: HubLocale;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedInUrl?: string;
  cvFileName?: string;
  skills?: string[];
  answers: HubApplyAnswer[];
}

export interface HubCriterionScore {
  id: HubCriterionId;
  label: string;
  weight: number;
  score: number; // 0–100 contribution already weighted
  pct: number; // 0–1 raw fit
  detail: string;
}

export interface HubCompatibilityReport {
  reportId: string;
  slug: string;
  roleTitle: string;
  candidateName: string;
  email: string;
  locale: HubLocale;
  total: number;
  recommendation: "strong_yes" | "yes" | "maybe" | "no";
  starRating: "TopGun" | "A" | "B" | "C" | "D";
  criteria: HubCriterionScore[];
  nextStepUnlocked: boolean;
  nextStepStatus: "none" | "requested" | "confirmed";
  nextStep?: {
    day?: string;
    time?: string;
    note?: string;
    requestedAt?: string;
  };
  createdAt: string;
  /** Never claim live phone screening — async text only. */
  screeningMode: "async_text";
}

export interface HubNextStepInput {
  day: string;
  time: string;
  note?: string;
}
