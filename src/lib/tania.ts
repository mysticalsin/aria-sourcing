/* ============================================================================
   TAnIA — Talent Acquisition funnel logic
   Pure, dependency-free derivations + metadata shared by the UI, the seed and
   the test suite. Maps the base Candidate model onto the Mantu 4-stage funnel,
   the Star Rating and the three lead sources.
   Ref: "TAnIA Architecture & Candidate Journey" v6.0 (Mantu / Amaris, Jun 2026).
   ========================================================================== */

import type {
  Candidate,
  CandidateStage,
  ChatboxScore,
  ChatboxScreeningAnswer,
  LeadSource,
  OutreachTone,
  StarRating,
  TaniaStage,
} from "./types";

// Re-export the TAnIA enums alongside their metadata so consumers can pull the
// value list and the *_META from one module.
export { LEAD_SOURCES, STAR_RATINGS, TANIA_STAGES, INTERVIEW_KINDS } from "./types";

/* ---- Star Rating --------------------------------------------------------- */

export interface StarThresholds {
  topGun: number;
  a: number;
  b: number;
  c: number;
}

/** Default match-score cutoffs. TAnIA §5: score ≥ 80 → TopGun/A, 60–79 → B, <60 → C/D. */
export const DEFAULT_STAR_THRESHOLDS: StarThresholds = {
  topGun: 88,
  a: 80,
  b: 65,
  c: 50,
};

/** Map a 0–100 match/chatbox score onto the Mantu Star Rating. */
export function deriveStarRating(
  score: number,
  t: StarThresholds = DEFAULT_STAR_THRESHOLDS,
): StarRating {
  if (score >= t.topGun) return "TopGun";
  if (score >= t.a) return "A";
  if (score >= t.b) return "B";
  if (score >= t.c) return "C";
  return "D";
}

/** Ordinal for sorting — TopGun highest. */
export function starRatingScore(r: StarRating): number {
  return { TopGun: 5, A: 4, B: 3, C: 2, D: 1 }[r];
}

export interface StarMeta {
  key: StarRating;
  label: string;
  criteria: string;
  /** How many of the five criteria are "YES". */
  yes: string;
  /** Design-token colour family (see globals.css). */
  tone: "mantu-yellow" | "electric" | "aqua" | "muted" | "danger";
  /** Recruiter action / SLA per TAnIA §4. */
  action: string;
}

export const STAR_RATING_META: Record<StarRating, StarMeta> = {
  TopGun: {
    key: "TopGun",
    label: "Top Gun",
    criteria: "Truly impressive on all 5 criteria",
    yes: "5 YES",
    tone: "mantu-yellow",
    action: "Instant pop-up · max 24h to Prequal",
  },
  A: {
    key: "A",
    label: "A Player",
    criteria: "Excellent — strong fit",
    yes: "4 YES",
    tone: "electric",
    action: "Instant pop-up · max 24h to Prequal",
  },
  B: {
    key: "B",
    label: "B Player",
    criteria: "Good — worth considering / client fit",
    yes: "3 YES + potential",
    tone: "aqua",
    action: "Recruiter pop-up · max 48h to Prequal",
  },
  C: {
    key: "C",
    label: "C",
    criteria: "Does not match selection criteria",
    yes: "Not our profile",
    tone: "muted",
    action: "Rejection email (batch-approved) · 48h to pool",
  },
  D: {
    key: "D",
    label: "D",
    criteria: "Does not match criteria nor values",
    yes: "No fit",
    tone: "danger",
    action: "Rejection email (batch-approved)",
  },
};

/** Prequal SLA in hours by rating, or null when the rating is a rejection. */
export function prequalSlaHours(r: StarRating): number | null {
  if (r === "TopGun" || r === "A") return 24;
  if (r === "B") return 48;
  return null; // C / D → rejection, no prequal
}

/* ---- Lead Source --------------------------------------------------------- */

export interface SourceMeta {
  key: LeadSource;
  label: string;
  entry: string;
  /** Outreach posture — TAnIA §3. */
  tone: string;
  outreachTone: OutreachTone;
  approval: string;
  rejection: string;
  /** Design-token colour family. */
  color: "electric" | "violet" | "tangerine";
  /** True when this source must never be batch-processed (referrals). */
  neverBatched: boolean;
  /** Always talent-pooled on rejection (referrals & outbound). */
  alwaysPooled: boolean;
}

export const LEAD_SOURCE_META: Record<LeadSource, SourceMeta> = {
  Applicant: {
    key: "Applicant",
    label: "Applicant",
    entry: "Inbound — job ad",
    tone: "Responsive — “Thank you for applying…”",
    outreachTone: "Casual Professional",
    approval: "Batch approval",
    rejection: "Stage-appropriate (batch-approved)",
    color: "electric",
    neverBatched: false,
    alwaysPooled: false,
  },
  Referral: {
    key: "Referral",
    label: "Referral",
    entry: "Inbound — My Referral app",
    tone: "Warm — recognises referral, personal",
    outreachTone: "Casual Professional",
    approval: "Individual review — never batched",
    rejection: "Individual, most care — referrer thanked",
    color: "violet",
    neverBatched: true,
    alwaysPooled: true,
  },
  Outbound: {
    key: "Outbound",
    label: "Outbound",
    entry: "Headhunted / sourced",
    tone: "Proactive — opportunity-led, personalised",
    outreachTone: "Executive",
    approval: "Recruiter-controlled — lead approved first",
    rejection: "Relationship preserved — always pooled",
    color: "tangerine",
    neverBatched: false,
    alwaysPooled: true,
  },
};

/** Derive the lead source from the base sourcePlatform when not set explicitly. */
export function deriveLeadSource(c: Pick<Candidate, "leadSource" | "sourcePlatform">): LeadSource {
  if (c.leadSource) return c.leadSource;
  if (c.sourcePlatform === "Referral") return "Referral";
  if (c.sourcePlatform === "Talent Pool") return "Outbound";
  // GitHub / LinkedIn / Stack Overflow / Dribbble / Behance are all proactively sourced.
  return "Outbound";
}

/* ---- Funnel stage mapping ------------------------------------------------ */

export interface TaniaStageMeta {
  key: TaniaStage;
  roman: string;
  label: string;
  sub: string;
  description: string;
  color: "muted" | "electric" | "aqua" | "violet" | "tangerine" | "success";
}

export const TANIA_STAGE_META: Record<TaniaStage, TaniaStageMeta> = {
  Chatbox: {
    key: "Chatbox",
    roman: "◦",
    label: "Chatbox",
    sub: "Pre-Stage I",
    description: "External candidate entry — scored before a recruiter sees them",
    color: "muted",
  },
  Need: {
    key: "Need",
    roman: "0",
    label: "Need Brief",
    sub: "Stage 0",
    description: "Need validated, briefed & job ad ready",
    color: "electric",
  },
  Leads: {
    key: "Leads",
    roman: "I",
    label: "Leads",
    sub: "Stage I · TOFU",
    description: "People not yet prequalified — screening → prequal",
    color: "aqua",
  },
  Candidates: {
    key: "Candidates",
    roman: "II",
    label: "Candidates",
    sub: "Stage II · MOFU",
    description: "Passed prequal — Intw1 → Intw2 → Intw3 (+ QM)",
    color: "violet",
  },
  Offered: {
    key: "Offered",
    roman: "III",
    label: "Offered",
    sub: "Stage III",
    description: "Offer sent → signed → pre-boarding",
    color: "tangerine",
  },
  Employees: {
    key: "Employees",
    roman: "IV",
    label: "Employees",
    sub: "Stage IV",
    description: "Started — OneStart, Time2Proficiency, Referral Champion",
    color: "success",
  },
};

/** The disposition of a candidate relative to the active funnel. */
export type Disposition = "active" | "pooled" | "rejected";

export function candidateDisposition(c: Pick<Candidate, "stage" | "vivier">): Disposition {
  if (c.stage === "Rejected" || c.stage === "Suppressed" || c.stage === "Not Interested") {
    return c.vivier ? "pooled" : "rejected";
  }
  return "active";
}

/** Map the base CandidateStage onto the TAnIA funnel stage (null = not active). */
export function taniaStageForCandidate(
  c: Pick<Candidate, "stage" | "vivier">,
): TaniaStage | null {
  const map: Partial<Record<CandidateStage, TaniaStage>> = {
    Sourced: "Leads",
    Contacted: "Leads",
    Replied: "Leads",
    Interested: "Candidates",
    Booked: "Candidates",
    Interviewed: "Candidates",
    Offer: "Offered",
    Hired: "Employees",
  };
  return map[c.stage] ?? null;
}

/** True once a lead has been prequalified into a candidate (Stage II+). */
export function isCandidate(c: Pick<Candidate, "stage" | "vivier">): boolean {
  const s = taniaStageForCandidate(c);
  return s === "Candidates" || s === "Offered" || s === "Employees";
}

/* ---- Chatbox scoring (TAnIA §5.07) --------------------------------------- */

/** Weights (sum 100): Location 25 · Visa 20 · Key Skill 25 · Project 20 · Availability 10. */
export const CHATBOX_WEIGHTS = {
  location: 25,
  visa: 20,
  keySkill: 25,
  project: 20,
  availability: 10,
} as const;

export interface ChatboxScoreInputs {
  /** Mobility answer to the always-asked Q1. */
  mobility?: "Yes" | "No" | "Relocation required";
  /** Visa sponsorship needed? true means a visa is required (costs points). */
  needsVisa?: boolean;
  /** Key-experience star rating 1–5 (Q3). */
  keyExpStars?: number;
  /** Tool/expertise star rating 1–5 (Q4). */
  toolStars?: number;
  /** Project-specific yes/no (Q5). */
  projectYes?: boolean;
  /** Candidate expressed a contact preference. */
  hasContactPref?: boolean;
  /** Detected as based outside the target region (from CV / phone). */
  outsideRegion?: boolean;
}

/** Compute the weighted 0–100 chatbox score + its per-dimension breakdown. */
export function computeChatboxScore(inp: ChatboxScoreInputs): ChatboxScore {
  const w = CHATBOX_WEIGHTS;
  // Location: full for local, partial for relocation-willing, penalised outside region.
  let locationPct = inp.mobility === "Yes" ? 1 : inp.mobility === "Relocation required" ? 0.6 : 0.2;
  if (inp.outsideRegion) locationPct = Math.min(locationPct, 0.65);
  const location = Math.round(w.location * clamp01(locationPct));

  // Visa: full when no sponsorship needed.
  const visa = inp.needsVisa ? Math.round(w.visa * 0.35) : w.visa;

  // Key skill + tool expertise: star ratings out of 5.
  const keySkill = Math.round(w.keySkill * clamp01((inp.keyExpStars ?? 0) / 5));
  const project = Math.round(
    w.project * clamp01(((inp.projectYes ? 3 : 0) + (inp.toolStars ?? 0)) / 8),
  );

  const availability = inp.hasContactPref ? w.availability : Math.round(w.availability * 0.5);

  const total = Math.min(100, location + visa + keySkill + project + availability);
  return { total, location, visa, keySkill, project, availability };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Chatbox handoff routing (TAnIA §5.09). */
export function chatboxHandoff(rating: StarRating): {
  route: string;
  sla: string;
  action: "instant" | "digest" | "reject";
} {
  if (rating === "TopGun" || rating === "A") {
    return { route: "Instant pop-up to recruiter", sla: "Prequal within 24h", action: "instant" };
  }
  if (rating === "B") {
    return { route: "Daily digest to recruiter", sla: "Prequal within 48h", action: "digest" };
  }
  return { route: "Rejection email (batch-approved) + talent-pool offer", sla: "—", action: "reject" };
}

/** Extract a StarRating badge tone → Tailwind classes helper is in the UI layer.
 *  Kept here so tests can assert the pure mapping stays stable. */
export function screeningStars(answers: ChatboxScreeningAnswer[]): number {
  const rated = answers.filter((a) => typeof a.stars === "number");
  if (!rated.length) return 0;
  return rated.reduce((s, a) => s + (a.stars ?? 0), 0) / rated.length;
}
