/* ============================================================================
   ARIA <-> Odoo mapping. Pure functions, no I/O.

   Direction of truth (ADR 0003):
   - Odoo owns the job position (hr.job) and, once a candidate is handed off,
     the application (hr.applicant): stages, interviews, offer, hire.
   - ARIA owns sourcing, scoring, outreach and everything before the hand-off.
   So ARIA reads jobs and applicant stages from Odoo, and writes to Odoo only
   the hand-off itself (one applicant + one note), on a recruiter's click.
   ========================================================================== */

import { z } from "zod";
import { stageRank, withStage } from "@/lib/metrics";
import { makeActivity, recomputeMetrics, withActivity } from "@/lib/store/workspace-transitions";
import { CANDIDATE_STAGES, type CandidateStage, type WorkspaceState } from "@/lib/types";
import { genId } from "@/lib/utils";

/** utm.source name ARIA creates (once) and sets on every applicant it hands off. */
export const ODOO_SOURCE_NAME = "ARIA";

/* ---- Text helpers --------------------------------------------------------- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Odoo Html field -> plain text for the intake parser. Not a sanitizer: the
 *  output is only ever used as text (never rendered as HTML). */
export function htmlToText(html: string, maxLength = 12_000): string {
  const text = html
    .slice(0, maxLength * 4)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) return safeCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return safeCodePoint(Number.parseInt(lower.slice(1), 10));
      return ENTITIES[lower] ?? match;
    })
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, maxLength);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

/** An http(s) URL safe to place in an href, or null. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2_000) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,}$/;

export function validEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return EMAIL_RE.test(value) ? value : null;
}

/* ---- Many2one helpers ----------------------------------------------------- */

/** Odoo returns a many2one as [id, display_name] or false. */
export function many2one(value: unknown): { id: number; name: string } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [id, name] = value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  return { id, name: typeof name === "string" ? name : String(id) };
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/* ---- Jobs ------------------------------------------------------------------ */

export interface OdooJob {
  id: number;
  name: string;
  department: string;
  location: string;
  recruiter: string;
  recruiterEmail: string;
  openings: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  payInterval: string;
  employmentType: string;
  skills: string[];
  descriptionText: string;
  requirementsText: string;
  applicationCount: number | null;
}

/** Fields ARIA would like from hr.job. Only those the instance has are read
 *  (field names move between Odoo versions, e.g. user_id -> recruiter_id). */
export const JOB_FIELDS = [
  "name",
  "description",
  "requirements",
  "department_id",
  "address_id",
  "no_of_recruitment",
  "recruiter_id",
  "user_id",
  "salary_min",
  "salary_max",
  "currency_id",
  "payment_interval",
  "employee_type_id",
  "contract_type_id",
  "skill_ids",
  "application_count",
  "active",
] as const;

export function jobFromOdoo(
  raw: Record<string, unknown>,
  extra: { skillNames?: string[]; recruiterEmail?: string } = {},
): OdooJob | null {
  const id = typeof raw.id === "number" && raw.id > 0 ? raw.id : null;
  const name = text(raw.name, 300);
  if (!id || !name) return null;
  const recruiter = many2one(raw.recruiter_id) ?? many2one(raw.user_id);
  return {
    id,
    name,
    department: many2one(raw.department_id)?.name ?? "",
    location: many2one(raw.address_id)?.name ?? "",
    recruiter: recruiter?.name ?? "",
    recruiterEmail: validEmail(extra.recruiterEmail) ?? "",
    openings: positiveNumber(raw.no_of_recruitment),
    salaryMin: positiveNumber(raw.salary_min),
    salaryMax: positiveNumber(raw.salary_max),
    currency: many2one(raw.currency_id)?.name ?? "",
    payInterval: text(raw.payment_interval, 40),
    employmentType: (many2one(raw.employee_type_id) ?? many2one(raw.contract_type_id))?.name ?? "",
    skills: (extra.skillNames ?? []).map((skill) => skill.trim()).filter(Boolean).slice(0, 40),
    descriptionText: typeof raw.description === "string" ? htmlToText(raw.description) : "",
    requirementsText: text(raw.requirements, 6_000),
    applicationCount: typeof raw.application_count === "number" ? raw.application_count : null,
  };
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

function money(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const value = amount % 1000 === 0 && amount >= 10_000 ? `${amount / 1000}k` : String(amount);
  return symbol ? `${symbol}${value}` : `${value}${currency ? ` ${currency}` : ""}`;
}

/** Odoo job -> the two intake fields (brief + job description), written as a
 *  plain hiring email so the generic intake parser reads it ("Position:",
 *  "Location:", "€65k - €80k"). It deliberately avoids the Mantu need-email
 *  markers ("Recruiter:", "Key required skills"), which switch the parser to
 *  the Mantu format. Odoo's pay interval defaults to "monthly" whatever the
 *  amounts are, so only a day or hour rate is stated. */
export function jobToBrief(job: OdooJob): { email: string; jd: string } {
  const lines: string[] = [];
  if (job.recruiter) lines.push(`From: ${job.recruiter}${job.recruiterEmail ? ` <${job.recruiterEmail}>` : ""}`);
  lines.push(`Subject: New position: ${job.name}`, "");
  lines.push(`Position: ${job.name}`);
  lines.push(`Odoo job position #${job.id}, open in Odoo Recruitment.`);
  if (job.department) lines.push(`Department: ${job.department}`);
  if (job.location) lines.push(`Location: ${job.location}`);
  if (job.employmentType) lines.push(`Contract: ${job.employmentType}`);
  if (job.openings) lines.push(`Openings: ${job.openings}`);
  if (job.salaryMin || job.salaryMax) {
    const range = [job.salaryMin, job.salaryMax]
      .filter((n): n is number => n !== null)
      .map((n) => money(n, job.currency))
      .join(" - ");
    const rate = job.payInterval === "daily" ? "Day rate" : job.payInterval === "hourly" ? "Hourly rate" : "Salary";
    lines.push(`${rate}: ${range}`);
  }
  if (job.skills.length > 0) lines.push(`Required skills: ${job.skills.join(", ")}`);
  const jd = [job.descriptionText, job.requirementsText ? `Requirements:\n${job.requirementsText}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return { email: lines.join("\n"), jd };
}

/* ---- Hand-off candidate ----------------------------------------------------- */

const BreakdownSchema = z
  .object({ label: z.string().max(200), score: z.number(), rationale: z.string().max(2_000).optional() })
  .loose();

/** The slice of an ARIA candidate the hand-off reads. Parsed from the server's
 *  copy of the workspace state, never from the browser request. */
export const HandoffCandidateSchema = z
  .object({
    id: z.string().min(1).max(100),
    campaignId: z.string().min(1).max(100),
    name: z.string().max(300),
    email: z.string().max(320).optional().default(""),
    phone: z.string().max(40).optional(),
    linkedinUrl: z.string().max(2_000).optional().default(""),
    githubUrl: z.string().max(2_000).optional().default(""),
    sourceUrl: z.string().max(2_000).optional(),
    currentTitle: z.string().max(300).optional().default(""),
    currentCompany: z.string().max(300).optional().default(""),
    location: z.string().max(300).optional().default(""),
    matchScore: z.number().optional().default(0),
    matchBreakdown: z.array(BreakdownSchema).max(20).optional().default([]),
    techStack: z.array(z.string().max(100)).max(100).optional().default([]),
    stage: z.enum(CANDIDATE_STAGES),
    sourcePlatform: z.string().max(60).optional().default(""),
    provenance: z.enum(["live", "manual", "synthetic"]).optional(),
    lawfulBasis: z.enum(["consent", "legitimate_interest"]).optional(),
    lawfulBasisRecordedAt: z.string().max(40).optional(),
    starRating: z.string().max(20).optional(),
    lastContactedAt: z.string().max(40).nullable().optional(),
    complianceFlags: z
      .object({
        doNotContact: z.boolean().optional(),
        suppressed: z.boolean().optional(),
        unsubscribed: z.boolean().optional(),
        anonymized: z.boolean().optional(),
      })
      .loose()
      .optional()
      .default({}),
  })
  .loose();

export type HandoffCandidate = z.infer<typeof HandoffCandidateSchema>;

/** Why this candidate must not be handed off to Odoo, if it must not. */
export function handoffBlock(candidate: HandoffCandidate): string | null {
  const flags = candidate.complianceFlags;
  if (flags.anonymized) return "This candidate's data was anonymized.";
  if (flags.doNotContact) return "This candidate is marked do-not-contact.";
  if (flags.unsubscribed) return "This candidate unsubscribed.";
  if (flags.suppressed || candidate.stage === "Suppressed") return "This candidate is on the suppression list.";
  if (candidate.provenance === "synthetic") return "Synthetic demo profiles are never sent to Odoo.";
  if (!candidate.name.trim()) return "This candidate has no name.";
  return null;
}

/** Odoo priority (0-3 stars) from the Mantu star rating, else from the score. */
export function priorityFor(candidate: HandoffCandidate): "0" | "1" | "2" | "3" {
  const star = (candidate.starRating ?? "").toLowerCase();
  if (star === "topgun") return "3";
  if (star === "a") return "2";
  if (star === "b") return "1";
  if (star === "c" || star === "d") return "0";
  const score = candidate.matchScore;
  if (score >= 85) return "3";
  if (score >= 70) return "2";
  if (score >= 50) return "1";
  return "0";
}

/** hr.applicant values for a new application. `available` = the instance's
 *  hr.applicant fields: a field this Odoo does not have is left out. */
export function applicantValues(
  candidate: HandoffCandidate,
  refs: { jobId: number; sourceId: number | null },
  available: ReadonlySet<string>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    partner_name: candidate.name.trim().slice(0, 200),
    job_id: refs.jobId,
  };
  const email = validEmail(candidate.email);
  if (email) values.email_from = email;
  const phone = (candidate.phone ?? "").trim();
  if (/^\+?[0-9 ().-]{6,30}$/.test(phone)) values.partner_phone = phone;
  const linkedin = safeHttpUrl(candidate.linkedinUrl);
  if (linkedin) values.linkedin_profile = linkedin;
  if (refs.sourceId) values.source_id = refs.sourceId;
  values.priority = priorityFor(candidate);
  return Object.fromEntries(Object.entries(values).filter(([field]) => field === "partner_name" || available.has(field)));
}

const BASIS_LABEL: Record<string, string> = {
  consent: "consent",
  legitimate_interest: "legitimate interest",
};

function link(url: string | null, label: string): string {
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

/** The chatter note posted on the applicant: why ARIA proposed this person and
 *  where the evidence is. Every candidate-derived string is escaped (profiles
 *  come from public web pages) and links are http(s) only. */
export function handoffNoteHtml(
  candidate: HandoffCandidate,
  context: { campaignTitle: string; sentBy: string; sentAt: string },
): string {
  const parts: string[] = [];
  parts.push(
    `<p><b>Sourced by ARIA</b> for “${escapeHtml(context.campaignTitle || "a campaign")}”, sent to Odoo by ${escapeHtml(context.sentBy)} on ${escapeHtml(context.sentAt.slice(0, 10))}.</p>`,
  );
  const headline = [candidate.currentTitle, candidate.currentCompany].filter(Boolean).join(" @ ");
  parts.push(
    `<p>ARIA score: <b>${Math.round(candidate.matchScore)}/100</b>${candidate.starRating ? ` · rating ${escapeHtml(candidate.starRating)}` : ""}${headline ? ` · ${escapeHtml(headline)}` : ""}${candidate.location ? ` · ${escapeHtml(candidate.location)}` : ""}</p>`,
  );
  const breakdown = candidate.matchBreakdown
    .slice(0, 8)
    .map((item) => `<li>${escapeHtml(item.label)}: ${Math.round(item.score)}${item.rationale ? ` (${escapeHtml(item.rationale.slice(0, 200))})` : ""}</li>`);
  if (breakdown.length > 0) parts.push(`<ul>${breakdown.join("")}</ul>`);
  if (candidate.techStack.length > 0) parts.push(`<p>Skills seen: ${escapeHtml(candidate.techStack.slice(0, 20).join(", "))}</p>`);
  const evidence = [
    candidate.linkedinUrl ? link(safeHttpUrl(candidate.linkedinUrl), "LinkedIn") : "",
    candidate.githubUrl ? link(safeHttpUrl(candidate.githubUrl), "GitHub") : "",
    candidate.sourceUrl ? link(safeHttpUrl(candidate.sourceUrl), "Source page") : "",
  ].filter(Boolean);
  const source = candidate.sourcePlatform ? `Found via ${escapeHtml(candidate.sourcePlatform)}` : "";
  if (evidence.length > 0 || source) parts.push(`<p>${[source, ...evidence].filter(Boolean).join(" · ")}</p>`);
  const basis = candidate.lawfulBasis
    ? `Contact basis recorded in ARIA: ${BASIS_LABEL[candidate.lawfulBasis]}${candidate.lawfulBasisRecordedAt ? ` (${escapeHtml(candidate.lawfulBasisRecordedAt.slice(0, 10))})` : ""}.`
    : "No contact basis recorded in ARIA.";
  parts.push(`<p>ARIA stage at hand-off: ${escapeHtml(candidate.stage)}. ${basis}</p>`);
  return parts.join("");
}

/* ---- Stages: Odoo -> ARIA --------------------------------------------------- */

export interface OdooStage {
  id: number;
  name: string;
  sequence: number;
  hiredStage: boolean;
}

export const STAGE_MAP_IGNORE = "ignore" as const;
export type StageMapTarget = CandidateStage | typeof STAGE_MAP_IGNORE;
/** Admin overrides, keyed by Odoo stage id (as a string). */
export type StageMap = Record<string, StageMapTarget>;

export const STAGE_MAP_TARGETS: readonly StageMapTarget[] = [
  "Interested",
  "Booked",
  "Interviewed",
  "Offer",
  "Hired",
  STAGE_MAP_IGNORE,
];

export const StageMapSchema = z
  .record(z.string().regex(/^[1-9][0-9]{0,8}$/), z.enum(STAGE_MAP_TARGETS as [StageMapTarget, ...StageMapTarget[]]))
  .refine((map) => Object.keys(map).length <= 100, { message: "Too many stage mappings." });

export function stageFromOdoo(raw: Record<string, unknown>): OdooStage | null {
  const id = typeof raw.id === "number" && raw.id > 0 ? raw.id : null;
  if (!id) return null;
  return {
    id,
    name: text(raw.name, 200) || `Stage ${id}`,
    sequence: typeof raw.sequence === "number" ? raw.sequence : 0,
    hiredStage: raw.hired_stage === true,
  };
}

/** ARIA's reading of an Odoo stage when the admin set no override. The first
 *  stage ("New") says nothing ARIA does not already know, so it maps to null. */
export function defaultStageTarget(stage: OdooStage, stages: readonly OdooStage[]): StageMapTarget {
  if (stage.hiredStage) return "Hired";
  const first = stages.reduce((min, s) => Math.min(min, s.sequence), Number.POSITIVE_INFINITY);
  const name = stage.name.toLowerCase();
  if (/contract|offer|proposal|proposition|offre/.test(name)) return "Offer";
  if (/interview|intw|entretien|assessment|technical|test|qm\b/.test(name)) return "Interviewed";
  if (/book|schedul|planned|planifi/.test(name)) return "Booked";
  if (/qualif|screen|prequal|call/.test(name)) return "Interested";
  if (stage.sequence <= first) return STAGE_MAP_IGNORE;
  return "Interested";
}

export function stageTarget(stage: OdooStage, stages: readonly OdooStage[], map: StageMap): StageMapTarget {
  return map[String(stage.id)] ?? defaultStageTarget(stage, stages);
}

export type ApplicationStatus = "ongoing" | "hired" | "refused" | "archived" | "deleted";

export interface ApplicantSnapshot {
  status: ApplicationStatus;
  stage: OdooStage | null;
  refuseReason: string;
}

/** The ARIA stage an Odoo application implies, or null when it implies none. */
export function ariaStageForApplicant(
  applicant: ApplicantSnapshot,
  stages: readonly OdooStage[],
  map: StageMap,
): CandidateStage | null {
  if (applicant.status === "hired") return "Hired";
  if (applicant.status === "refused") {
    return /by applicant|not interested|declin|withdr|désist|refus.*candidat/i.test(applicant.refuseReason)
      ? "Not Interested"
      : "Rejected";
  }
  if (applicant.status !== "ongoing" || !applicant.stage) return null;
  const target = stageTarget(applicant.stage, stages, map);
  return target === STAGE_MAP_IGNORE ? null : target;
}

const TERMINAL: ReadonlySet<CandidateStage> = new Set(["Hired", "Rejected", "Not Interested"]);

/**
 * The stage ARIA should move to, or null to leave it. Odoo is the system of
 * record after the hand-off, so its outcomes (hired, refused, reopened) apply;
 * otherwise ARIA only moves forward, never back to a stage it is already past.
 * A suppressed candidate is never moved (compliance wins).
 */
export function stageUpdate(current: CandidateStage, next: CandidateStage | null): CandidateStage | null {
  if (!next || next === current || current === "Suppressed") return null;
  if (TERMINAL.has(next)) return next;
  if (TERMINAL.has(current)) return next;
  return stageRank(next) > stageRank(current) ? next : null;
}

/* ---- Confidentiality ------------------------------------------------------- */

/** How long an audited "reveal" of a confidential profile allows its hand-off. */
export const HANDOFF_REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

const OUTREACH_PURPOSE: ReadonlySet<CandidateStage> = new Set(["Contacted", "Replied", "Interested", "Booked", "Interviewed", "Offer", "Hired"]);

/**
 * Why a confidential profile may not be sent to Odoo yet, if it may not. Same
 * rule as the drawer: with confidentiality mode on, a profile without an
 * outreach purpose (stage Contacted onward) is masked until an operator
 * reveals it, which the app logs as "Candidate PII revealed".
 */
export function confidentialityBlock(
  input: { confidentialityMode: boolean; stage: CandidateStage; lastRevealAt: string | null },
  now: number,
): string | null {
  if (!input.confidentialityMode || OUTREACH_PURPOSE.has(input.stage)) return null;
  const revealedAt = input.lastRevealAt ? Date.parse(input.lastRevealAt) : Number.NaN;
  if (Number.isFinite(revealedAt) && revealedAt <= now + 60_000 && now - revealedAt <= HANDOFF_REVEAL_WINDOW_MS) return null;
  return "Confidentiality mode hides this profile. Reveal it first (the reveal is logged), then send it to Odoo.";
}

/* ---- Workspace changes the server makes ----------------------------------- */

export interface ApplicantUpdate {
  candidateId: string;
  applicantId: number;
  ariaStage: CandidateStage | null;
  odooStage: string | null;
  status: ApplicationStatus;
  refuseReason: string | null;
}

export interface StageSyncChange {
  candidateId: string;
  from: CandidateStage;
  to: CandidateStage;
  odooStage: string | null;
  status: ApplicationStatus;
}

const STATUS_WORD: Record<ApplicationStatus, string> = {
  ongoing: "in progress",
  hired: "hired",
  refused: "refused",
  archived: "archived",
  deleted: "deleted",
};

/**
 * Apply Odoo's applicant states to the workspace: each candidate that should
 * move (stageUpdate) gets its stage (with the funnel high-water mark), a note,
 * Odoo's refuse reason when rejected, and one activity; campaign metrics are
 * recomputed. Pure: the server runs it inside mutateWorkspace.
 */
export function applyOdooUpdates(
  state: WorkspaceState,
  updates: readonly ApplicantUpdate[],
  at: string,
): { state: WorkspaceState; changes: StageSyncChange[] } {
  const byCandidate = new Map(updates.map((update) => [update.candidateId, update]));
  const changes: StageSyncChange[] = [];
  const candidates = state.candidates.map((candidate) => {
    const update = byCandidate.get(candidate.id);
    if (!update) return candidate;
    const to = stageUpdate(candidate.stage, update.ariaStage);
    if (!to) return candidate;
    changes.push({ candidateId: candidate.id, from: candidate.stage, to, odooStage: update.odooStage, status: update.status });
    const text = `Odoo: ${update.odooStage ?? "application"} (${STATUS_WORD[update.status]}${update.refuseReason ? `, ${update.refuseReason}` : ""}). ARIA stage ${candidate.stage} → ${to}.`;
    return {
      ...candidate,
      ...withStage(candidate, to),
      notes: [{ id: genId("note"), text, at }, ...(candidate.notes ?? [])],
      ...(to === "Rejected" && update.refuseReason ? { rejectionReason: `Odoo: ${update.refuseReason}`.slice(0, 300) } : {}),
    };
  });
  if (changes.length === 0) return { state, changes };
  let next: WorkspaceState = { ...state, candidates };
  const campaigns = new Set<string>();
  for (const change of changes) {
    const candidate = next.candidates.find((c) => c.id === change.candidateId)!;
    campaigns.add(candidate.campaignId);
    next = withActivity(
      next,
      makeActivity({
        type: "system",
        title: `Odoo moved ${candidate.name} to ${change.to}`,
        notes: `Odoo Recruitment: ${change.odooStage ?? "application"} (${STATUS_WORD[change.status]}). Odoo is the system of record after the hand-off.`,
        outcome: `${change.from} → ${change.to}`,
        campaignId: candidate.campaignId,
        linkedEntityType: "candidate",
        linkedEntityId: candidate.id,
        createdAt: at,
      }),
      candidate.campaignId,
    );
  }
  for (const campaignId of campaigns) next = recomputeMetrics(next, campaignId);
  return { state: next, changes };
}

/** The audit trail of a hand-off in ARIA: a candidate note and an activity. */
export function recordHandoff(
  state: WorkspaceState,
  input: { candidateId: string; applicantId: number; jobName: string; sentBy: string; created: boolean },
  at: string,
): WorkspaceState | null {
  const candidate = state.candidates.find((c) => c.id === input.candidateId);
  if (!candidate) return null;
  const verb = input.created ? "Sent to Odoo" : "Linked to the existing Odoo application";
  const text = `${verb}: applicant #${input.applicantId} on “${input.jobName}”, by ${input.sentBy}.`;
  const next: WorkspaceState = {
    ...state,
    candidates: state.candidates.map((c) => (c.id === candidate.id ? { ...c, notes: [{ id: genId("note"), text, at }, ...(c.notes ?? [])] } : c)),
  };
  return withActivity(
    next,
    makeActivity({
      type: "compliance",
      title: `${verb}: ${candidate.name}`,
      notes: `Profile, score and evidence copied to Odoo Recruitment (applicant #${input.applicantId}) by ${input.sentBy}.`,
      outcome: "Handed off to Odoo",
      campaignId: candidate.campaignId,
      linkedEntityType: "candidate",
      linkedEntityId: candidate.id,
      createdAt: at,
    }),
    candidate.campaignId,
  );
}

/** Link to the applicant in Odoo's web client. */
export function applicantUrl(publicBase: string, applicantId: number): string {
  return `${publicBase.replace(/\/+$/, "")}/odoo/hr.applicant/${applicantId}`;
}

export function jobUrl(publicBase: string, jobId: number): string {
  return `${publicBase.replace(/\/+$/, "")}/odoo/hr.job/${jobId}`;
}
