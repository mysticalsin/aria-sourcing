/* ============================================================================
   ARIA SOURCING — domain types
   Single source of truth for the data model. Every module imports from here.
   ========================================================================== */

/* ---- Enums (as string unions for ergonomic JSON persistence) ------------- */

export const CANDIDATE_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Interested",
  "Booked",
  "Interviewed",
  "Offer",
  "Hired",
  "Not Interested",
  "Rejected",
  "Suppressed",
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** The ordered funnel the dashboard / reports visualise. */
export const FUNNEL_STAGES = [
  "Sourced",
  "Contacted",
  "Replied",
  "Interested",
  "Booked",
  "Interviewed",
  "Hired",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const REPLY_INTENTS = [
  "INTERESTED",
  "QUALIFIED_INTEREST",
  "NOT_INTERESTED",
  "REFERRAL",
  "OOO",
  "UNCLEAR",
  "NEGATIVE",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const URGENCY_LEVELS = [
  "ASAP",
  "Critical",
  "Urgent",
  "This Week",
  "Standard",
] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

export const CAMPAIGN_STATUSES = [
  "Intake",
  "Sourcing",
  "Outreach",
  "Interviewing",
  "Closing",
  "Filled",
  "Paused",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const INTAKE_INTENTS = [
  "New Role",
  "Backfill",
  "Urgent Hire",
  "Exploratory",
] as const;
export type IntakeIntent = (typeof INTAKE_INTENTS)[number];

export const OUTREACH_CHANNELS = ["Email", "LinkedIn", "WhatsApp", "SMS"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_TONES = [
  "Casual Professional",
  "Executive",
  "Technical",
] as const;
export type OutreachTone = (typeof OUTREACH_TONES)[number];

export const OUTREACH_STATUSES = [
  "Draft",
  "Needs Approval",
  "Approved",
  "Pending Manual Send",
  "Scheduled",
  "Rejected",
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "parse",
  "campaign",
  "score",
  "sourcing",
  "outreach",
  "reply",
  "booking",
  "learning",
  "compliance",
  "system",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const SENIORITY_LEVELS = [
  "Unspecified",
  "Junior",
  "Mid",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Director",
] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export const EMPLOYMENT_TYPES = [
  "Unspecified",
  "Full-time",
  "Contract",
  "Part-time",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const LOCATION_TYPES = ["Unspecified", "Remote", "Hybrid", "On-site"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const COMPANY_STAGES = [
  "Seed",
  "Series A",
  "Series B",
  "Series C+",
  "Public",
  "Enterprise",
] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const SOURCE_PLATFORMS = [
  "GitHub",
  "LinkedIn",
  "Stack Overflow",
  "Dribbble",
  "Behance",
  "Sillage",
  "Apollo",
  "Seamless",
  "Manual",
  "Apify",
  "Referral",
  "Talent Pool",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const CANDIDATE_LAWFUL_BASES = ["consent", "legitimate_interest"] as const;
export type CandidateLawfulBasis = (typeof CANDIDATE_LAWFUL_BASES)[number];

export const BOOKING_STATUSES = [
  "Proposed",
  "Confirmed",
  "Completed",
  "Cancelled",
  "No Show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const INTEGRATION_MODES = ["mock", "live"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const INTEGRATION_HEALTH = [
  "connected",
  "degraded",
  "error",
  "not_configured",
] as const;
export type IntegrationHealth = (typeof INTEGRATION_HEALTH)[number];

/* ---- Job analysis -------------------------------------------------------- */

/** Structured locale + market context for LLM outreach (60-language path). */
export interface LocaleContext {
  primaryLanguage: string;
  secondaryLanguages?: string[];
  marketCountry?: string;
  workCity?: string;
  clientSector?: string;
  formality?: "formal" | "consulting" | "casual";
  /** Disclosure-safe compensation hints for prompts only — never sent to candidates verbatim. */
  compensationNorms?: string;
}

export interface JobAnalysis {
  title: string;
  department: string;
  seniority: Seniority;
  employmentType: EmploymentType;
  locationType: LocationType;
  /** Concrete place parsed from the brief, e.g. "London". Empty/absent when unknown. */
  location?: string;
  regions: string[];
  timezone: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  equity: boolean;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  education: string;
  industryExperience: string[];
  companyStageTarget: CompanyStage[];
  teamSize: string;
  reportingTo: string;
  urgency: Urgency;
  /** Detected language of the need (ISO code, e.g. "en", "fr"). */
  language?: string;
  /** Locale + market context for multilingual outreach and reply drafts. */
  localeContext?: LocaleContext;
  /** ISO date explicitly stated in the inbound brief (e.g. "Start date: 7/13/2026").
   *  Null when the brief doesn't state one — createCampaign then falls back to a
   *  default target. Absent covers analyses predating this field. */
  expectedStartDate?: string | null;
  /** Mission Description / Profile Synthesis body from a VSS Recruitment Need.
   *  Preserved for sourcing substance; optional for analyses predating this field. */
  missionDescription?: string;
  /** LinkedIn boolean / X-ray string when the brief supplies one (VSS Candidate Search Support). */
  linkedinBoolean?: string;
  validationWarnings: ValidationWarning[];
}

export interface ValidationWarning {
  field: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

/* ---- Sourcing strategy --------------------------------------------------- */

export interface SourcingStrategy {
  primaryPlatforms: SourcePlatform[];
  secondaryPlatforms: SourcePlatform[];
  githubQueries: GithubQuery[];
  linkedinBoolean: string;
  stackOverflowTags: string[];
  geoTargets: string[];
  excludedCompanies: string[];
  targetCompanyStages: CompanyStage[];
}

export interface GithubQuery {
  label: string;
  query: string;
  estimatedResults: number;
}

/* ---- Scoring ------------------------------------------------------------- */

export interface ScoringWeights {
  skills: number;
  experience: number;
  companyStage: number;
  industry: number;
  location: number;
  activity: number;
}

export interface MatchBreakdownItem {
  key: keyof ScoringWeights;
  label: string;
  score: number; // 0-100 dimension score
  weight: number; // 0-1 normalised weight
  contribution: number; // weighted points contributed to composite
  rationale: string;
}

/* ---- Candidate ----------------------------------------------------------- */

export interface OutreachHistoryEntry {
  messageId: string;
  channel: OutreachChannel;
  subject: string;
  status: OutreachStatus;
  at: string;
}

export interface ReplyHistoryEntry {
  id: string;
  intent: ReplyIntent;
  confidence: number;
  excerpt: string;
  at: string;
}

/** A free-text recruiter note logged against a candidate — audit-worthy, so
 *  adding one also writes an Activity (see addCandidateNote in store.ts). */
export interface CandidateNote {
  id: string;
  text: string;
  at: string;
}

export interface ComplianceFlags {
  doNotContact: boolean;
  suppressed: boolean;
  unsubscribed: boolean;
  gdprExportRequested: boolean;
  anonymized: boolean;
  suppressedUntil: string | null;
  /** The candidate's real pipeline stage captured immediately before
   *  suppressCandidate/markDoNotContact overwrote it with "Suppressed" —
   *  lets restoreCandidateContact undo the mutation. Null once restored. */
  preSuppressionStage?: CandidateStage | null;
}

/* ---- Enrichment orchestrator (additive; unified cross-provider waterfall) --
   A candidate discovered by ANY provider can be enriched by ALL configured
   providers. Field-level provenance tracks who supplied which value so a
   later, higher-confidence provider can safely overwrite an earlier one. */

export const ENRICHABLE_FIELDS = [
  "email",
  "phone",
  "headline",
  "skills",
  "experience",
  "education",
  "languages",
  "location",
  "company",
] as const;
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/** Which provider supplied a field's current value, and how confident it was. */
export interface FieldProvenance {
  provider: SourcePlatform; // who supplied this field's value
  at: string; // ISO
  confidence?: number; // 0..1 (e.g. email deliverable/qualityScore)
}

/** One provider run against one candidate — recorded whether or not it found data. */
export interface EnrichmentAttempt {
  provider: SourcePlatform;
  at: string;
  status: "ok" | "no_data" | "not_configured" | "no_key_field" | "budget_exceeded" | "error" | "deferred";
  fieldsFilled: EnrichableField[];
  costUnits: number; // credits/$ consumed (0 if free/no-match)
  detail?: string; // terse, never leaks a key
}

/** Enrichment state carried on a candidate — merged in by field, never replaced wholesale. */
export interface CandidateEnrichment {
  status: "unenriched" | "partial" | "enriched" | "failed";
  lastEnrichedAt?: string;
  fieldProvenance: Partial<Record<EnrichableField, FieldProvenance>>;
  attempts: EnrichmentAttempt[];
  coverage: EnrichableField[]; // fields currently present
}

export interface Candidate {
  id: string;
  campaignId: string;
  name: string;
  email: string;
  /** E.164 phone (e.g. +14155552671) for WhatsApp / SMS outreach. Often empty
   *  until enriched; sourced profiles rarely expose one. */
  phone?: string;
  avatarInitials: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  timezone: string;
  linkedinUrl: string;
  githubUrl: string;
  /** Canonical URL for a real hit on a platform with no dedicated field above
   *  (Stack Overflow, Dribbble, Behance). Blank for synthetic candidates. */
  sourceUrl?: string;
  /** External record id on a source platform whose later API still accepts a
   *  raw result id. Never use this field as paid-provider authority. */
  sourceExternalId?: string;
  /** Opaque server-issued authority for a paid provider action. The browser
   *  never receives the underlying provider person id. */
  sourceAuthorityId?: string;
  /** Per-provider external record ids, keyed by SourcePlatform, so a candidate
   *  discovered by one provider can still be precisely re-identified by every
   *  OTHER configured provider (Apollo person id, Seamless searchResultId, …)
   *  instead of colliding on the single legacy `sourceExternalId` slot. Mapping
   *  helpers seed `externalIds[sourcePlatform] = sourceExternalId` on migration. */
  externalIds?: Partial<Record<SourcePlatform, string>>;
  sourcePlatform: SourcePlatform;
  sourceQuery: string;
  matchScore: number;
  matchBreakdown: MatchBreakdownItem[];
  techStack: string[];
  /** Enriched work-history lines, formatted "Title @ Company (dates)", newest
   *  first. Provider free-text (Apify/dev_fusion) — displayed to recruiters but
   *  deliberately NOT parsed into `yearsExperience` (dates are unstructured; see
   *  the fabrication contract on that field). Absent until enriched. */
  experience?: string[];
  /** Enriched education lines, formatted "Degree @ School (dates)". Absent until enriched. */
  education?: string[];
  /** Enriched spoken/written languages. Absent until enriched. */
  languages?: string[];
  /** Verified professional experience in years. Null means not provided and
   *  must never be rendered or scored as zero years. */
  yearsExperience: number | null;
  companyStageExperience: CompanyStage[];
  industryExperience: string[];
  recentActivity: string;
  stage: CandidateStage;
  /**
   * Loop-proposed first interview (Teams/Outlook). Set by calendar_book after
   * propose-calendar-book dry-run. Cleared when a Booking is created. Absent =
   * no autonomous proposal yet.
   */
  interviewProposal?: {
    startTime: string;
    endTime: string;
    agenda: string[];
    claimId: string | null;
    proposeStatus: string;
    channel: string;
    meetingKind?: "pre_call" | "first_interview";
    proposedAt: string;
    /** Present after loop confirm-calendar-book creates a live Teams meeting. */
    teamsLink?: string;
  } | null;
  /**
   * Loop-proposed pre-call screen (15–20 min). Same shape as interviewProposal;
   * kept separate so first-interview proposals are not overwritten.
   */
  preCallProposal?: {
    startTime: string;
    endTime: string;
    agenda: string[];
    claimId: string | null;
    proposeStatus: string;
    channel: string;
    meetingKind?: "pre_call" | "first_interview";
    proposedAt: string;
    teamsLink?: string;
  } | null;
  /** Historical high-water-mark funnel rank (see STAGE_RANK in metrics.ts) —
   *  the furthest the candidate ever progressed, even if `stage` later moved
   *  to a terminal/negative state (Rejected, Suppressed). Absent = derive
   *  from the current stage. Funnel/KPI aggregation reads this instead of
   *  the live stage rank so post-interview rejections aren't undercounted. */
  maxStageRank?: number;
  lastContactedAt: string | null;
  /** Timestamp of the candidate's most recent inbound reply (any intent),
   *  stamped by classifyAndStoreReply. Lets the approval gate detect a draft
   *  that was written before the candidate replied and block it as stale.
   *  Absent/null = no reply on record yet. */
  lastRepliedAt?: string | null;
  outreachHistory: OutreachHistoryEntry[];
  replyHistory: ReplyHistoryEntry[];
  booking: Booking | null;
  complianceFlags: ComplianceFlags;
  createdAt: string;
  /** How this profile came to exist. "live" = a validated provider result,
   *  "manual" = operator-entered evidence, and "synthetic" = generated demo
   *  data. Undefined covers seed data predating this field. */
  provenance?: "live" | "manual" | "synthetic";
  /** Operator-selected legal-processing input for manually entered records.
   *  The app records the selection but does not determine legal validity. */
  lawfulBasis?: CandidateLawfulBasis;
  lawfulBasisRecordedAt?: string;
  lawfulBasisSource?: "operator_selection";
  /** Operator reviewed a below-floor live lead and endorsed role fit for outreach.
   *  Does not change matchScore; the approval gate accepts it with a warning. */
  fitEndorsedAt?: string;
  fitEndorsedSource?: "operator_selection";
  /** Free-text recruiter notes, newest first. Absent/empty = none yet. */
  notes?: CandidateNote[];
  /** Why this candidate was rejected — captured alongside the "Rejected" stage.
   *  Optional and editable independently of the stage itself. */
  rejectionReason?: string;

  /* ---- TAnIA layer (additive; derived on migration when absent) ---------- */
  /** TAnIA lead source — Applicant (inbound job ad), Referral (My Referral app),
   *  or Outbound (headhunted/sourced). Drives tone, SLA and rejection handling
   *  (TAnIA §3). Derived from sourcePlatform on migration when absent. */
  leadSource?: LeadSource;
  /** Employee who referred this candidate (Referral source only). */
  referredBy?: string;
  /** Mantu Star Rating (TopGun/A/B/C/D) — TAnIA §4. Derived from matchScore via
   *  the configurable thresholds in SystemSettings when absent. */
  starRating?: StarRating;
  /** #Vivier / talent-pool membership — a profile kept warm for future needs. */
  vivier?: boolean;
  /** Silver Medalist — a TopGun/A not hired now, tracked for future needs. */
  silverMedalist?: boolean;
  /** ISO timestamp before which a pooled profile should not be re-contacted. */
  recontactAt?: string | null;
  /** Prequal call record — the gate where a LEAD becomes a CANDIDATE. */
  prequal?: PrequalRecord;
  /** Interview records (Intw1 / Intw2 / Intw3 / QM). Newest last. */
  interviews?: InterviewRecord[];
  /** Skills + signals captured across the process — the candidate "DNA" stored
   *  back into the talent pool (TAnIA Talent Pool & Community Mgr). */
  dna?: string[];
  /** Cross-provider enrichment state — field-level provenance, attempt log and
   *  coverage produced by the unified enrichment orchestrator. Absent = never
   *  run through the orchestrator yet. */
  enrichment?: CandidateEnrichment;
}

/* ============================================================================
   TAnIA — Talent Acquisition funnel model (additive layer)
   The base CandidateStage/Campaign model above stays authoritative for outreach,
   the sending fleet and reports. TAnIA concepts layer on top: lead source, the
   Mantu Star Rating, the 4-stage funnel, prequal + interviews, and #Vivier.
   Ref: "TAnIA Architecture & Candidate Journey" v6.0 (Mantu / Amaris, Jun 2026).
   ========================================================================== */

/** Where a lead came from — agent behaviour, tone and SLA differ by source. */
export const LEAD_SOURCES = ["Applicant", "Referral", "Outbound"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Mantu Star Rating applied at every evaluation stage (Screening → Intw3). */
export const STAR_RATINGS = ["TopGun", "A", "B", "C", "D"] as const;
export type StarRating = (typeof STAR_RATINGS)[number];

/** The Mantu 4-stage hiring funnel. "Chatbox" is the pre-Stage-I entry layer. */
export const TANIA_STAGES = [
  "Chatbox", // pre-Stage I — external candidate entry point
  "Need", // Stage 0 — Need Brief
  "Leads", // Stage I — LEADS (TOFU)
  "Candidates", // Stage II — CANDIDATES (MOFU)
  "Offered", // Stage III — OFFERED CANDIDATES
  "Employees", // Stage IV — EMPLOYEES
] as const;
export type TaniaStage = (typeof TANIA_STAGES)[number];

export const INTERVIEW_KINDS = ["Prequal", "Intw1", "Intw2", "Intw3", "QM"] as const;
export type InterviewKind = (typeof INTERVIEW_KINDS)[number];

export const INTERVIEW_OUTCOMES = [
  "Scheduled",
  "Completed",
  "Advance",
  "Hold",
  "Reject",
  "No Show",
] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

/** One interview event in the pipeline (Intw1/2/3 or the Consulting QM). */
export interface InterviewRecord {
  id: string;
  kind: InterviewKind;
  scheduledFor: string | null;
  interviewer: string;
  outcome: InterviewOutcome;
  /** Rating captured at this stage (TAnIA rates at every gate). */
  starRating?: StarRating;
  /** Structured hiring-manager feedback (form filled T+30min post-interview). */
  hmFeedback?: string;
  /** When the HM feedback form is due — drives the "no feedback" alert. */
  hmFeedbackDueAt?: string | null;
  notes?: string;
  createdAt: string;
}

export type PrequalOutcome = "pending" | "advance" | "hold" | "reject";

export interface PrequalQuestion {
  q: string;
  a: string;
  kind: "yesno" | "stars" | "text";
  /** 1–5 when kind === "stars". */
  stars?: number;
}

/** The Prequal call — the gate where a LEAD becomes a CANDIDATE. */
export interface PrequalRecord {
  scheduledFor: string | null;
  completedAt: string | null;
  starRating?: StarRating;
  questions: PrequalQuestion[];
  toneGuide?: string;
  outcome: PrequalOutcome;
}

/* ---- Career-website Chatbox (external candidate entry point, TAnIA §5) ---- */

export const CHATBOX_PATHS = ["A", "B"] as const;
/** Path A = applying to a specific job. Path B = spontaneous browse / match. */
export type ChatboxPath = (typeof CHATBOX_PATHS)[number];

export type ChatboxAnswerKind =
  | "mobility"
  | "visa"
  | "keyexp"
  | "toolexp"
  | "project"
  | "quickmatch";

export interface ChatboxScreeningAnswer {
  question: string;
  answer: string;
  kind: ChatboxAnswerKind;
  /** 1–5 for star-rated screening questions (key experience, tool/expertise). */
  stars?: number;
}

/** The weighted 0–100 automatic score computed at chatbox handoff (TAnIA §5.07). */
export interface ChatboxScore {
  total: number; // 0–100
  location: number; // /25
  visa: number; // /20
  keySkill: number; // /25
  project: number; // /20
  availability: number; // /10
}

export const CHATBOX_SUBMISSION_STATUSES = [
  "new",
  "reviewed",
  "advanced",
  "rejected",
  "pooled",
] as const;
export type ChatboxSubmissionStatus = (typeof CHATBOX_SUBMISSION_STATUSES)[number];

/** A scored external application produced by the chatbox, awaiting recruiter
 *  handoff to the Applicant Screener. */
export interface ChatboxSubmission {
  id: string;
  path: ChatboxPath;
  /** The job applied to (Path A) or best match (Path B); null for pure spontaneous. */
  campaignId: string | null;
  roleTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cvFileName?: string;
  /** Signals extracted from the CV (invisible to the candidate, TAnIA §5.04). */
  detected: {
    location?: string;
    nationality?: string;
    phoneCountry?: string;
    skills?: string[];
  };
  answers: ChatboxScreeningAnswer[];
  score: ChatboxScore;
  starRating: StarRating;
  contactPref?: { time?: string; day?: string };
  status: ChatboxSubmissionStatus;
  /** Candidate id created once the recruiter advances the submission. */
  handoffCandidateId?: string;
  createdAt: string;
}

/* ---- Outreach ------------------------------------------------------------ */

export interface OutreachMessage {
  id: string;
  candidateId: string;
  campaignId: string;
  channel: OutreachChannel;
  subject: string;
  body: string;
  tone: OutreachTone;
  personalizationEvidence: string[];
  status: OutreachStatus;
  sequenceStep: number;
  scheduledFor: string | null;
  sentAt: string | null;
  approvedBy: string | null;
  dryRun: boolean;
  createdAt: string;
  /** Carried over from a ClassifiedReply when this draft was created as a reply
   *  (see draftReplyResponse in store.ts), so a live send can thread correctly. */
  inboxThreadId?: string;
  /** Multi-agent quality pipeline verdict (empathy + compliance + human-likeness). */
  qualityStatus?: "ready" | "needs_review" | "blocked";
  qualityScore?: number;
  /** True when live LLM peer critics contributed (autonomous dry-run path). */
  qualityCriticsUsed?: boolean;
  /** Flattened critic reasons for operator review on dry-run drafts. */
  qualityReasons?: string[];
  /** Mantu-branded HTML wrapper for Email channel (optional). */
  htmlBody?: string;
  /** Override default candidate recipient (interviewer prep emails). */
  recipientOverride?: string;
  /** Marks template-bound interview correspondence drafts. */
  prepPurpose?: "interviewer" | "candidate_confirmation";
}

/* ---- Replies ------------------------------------------------------------- */

export interface ClassifiedReply {
  id: string;
  candidateId: string;
  campaignId: string;
  channel: OutreachChannel;
  body: string;
  intent: ReplyIntent;
  confidence: number;
  reasoning: string;
  suggestedAction: string;
  draftResponse: string;
  handled: boolean;
  slaDueAt: string | null;
  receivedAt: string;
  /** Inbound-email metadata (set when auto-ingested from a mailbox; absent for manual entry). */
  fromAddress?: string;
  messageId?: string;
  inboxThreadId?: string;
  externalReceivedAt?: string; // ISO timestamp from the email provider
}

/* ---- Interviewers ---------------------------------------------------------
   A registered real staff member available for interview round-robin. Bookings
   still denormalize interviewer name/email as plain strings (below) so a
   historical booking survives an interviewer being edited or removed later. */

export interface Interviewer {
  id: string;
  name: string;
  email: string;
  role?: string;
  /** Inactive interviewers stay in the roster (history, re-activation) but are
   *  skipped by round-robin booking assignment. */
  active: boolean;
}

/* ---- Bookings ------------------------------------------------------------ */

export interface Booking {
  id: string;
  candidateId: string;
  campaignId: string;
  candidateName: string;
  role: string;
  startTime: string;
  endTime: string;
  timezone: string;
  interviewer: string;
  interviewerEmail: string;
  teamsLink: string;
  calLink: string;
  /** Provider receipt retained even when the provider does not issue a browser
   *  link. This is operational state only; durable provider authority belongs
   *  in the server-side booking-attempt ledger. */
  calendarSync?: {
    status: "created";
    seatId: string;
    provider: "Gmail API" | "Microsoft Graph";
    eventId: string;
  };
  status: BookingStatus;
  agenda: string[];
  createdAt: string;
}

/* ---- Wins ----------------------------------------------------------------
   Structured conversion records captured when a booking is accepted. These
   stay inside HermesState because they can contain candidate PII. */

export interface WinRecord {
  id: string;
  at: string;
  candidateId: string;
  candidateName: string;
  campaignId: string;
  campaignTitle: string;
  bookingId: string;
  sourcePlatform: SourcePlatform;
  leadSource: LeadSource | null;
  matchScore: number;
  seniority: Seniority;
  roleTitle: string;
  outreachChannel: OutreachChannel | null;
  touchCount: number;
  timeToBookMs: number | null;
  triggeringReplyIntent: {
    intent: ReplyIntent;
    confidence: number;
  } | null;
  messageTraits: {
    subjectLength?: number;
    bodyLength?: number;
    tone?: OutreachTone;
  };
}

/* ---- Activity ------------------------------------------------------------ */

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  notes: string;
  outcome: string;
  campaignId: string | null;
  linkedEntityType: "candidate" | "campaign" | "outreach" | "reply" | "booking" | "report" | "skill" | null;
  linkedEntityId: string | null;
  createdAt: string;
}

/* ---- Skill refinement ---------------------------------------------------- */

export type SkillKey =
  | "outreach_skill"
  | "sourcing_skill"
  | "scoring_skill"
  | "reply_classification_skill";

export interface SkillUpdate {
  id: string;
  skill: SkillKey;
  title: string;
  rationale: string;
  before: string;
  after: string;
  impact: string;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

/** Tunable parameters a learned skill controls — accepting an update mutates these
 *  and the change actually feeds back into the agent's behavior. */
export interface AgentSkillParams {
  preferredTone?: OutreachTone;
  leadWithArtifact?: boolean;
  weights?: Partial<ScoringWeights>;
  qualifiedInterestFloor?: number; // reply-classification threshold
  preferredPlatforms?: SourcePlatform[];
}

export interface SkillVersionEntry {
  version: number;
  summary: string;
  at: string;
}

/** A persistent, versioned Aria skill (the `*.md` the agent edits as it learns). */
export interface AgentSkill {
  key: SkillKey;
  filename: string;
  title: string;
  description: string;
  content: string; // the skill body (markdown)
  version: number;
  params: AgentSkillParams;
  metrics: { applied: number; outcomeSignal: number }; // outcomeSignal: learned win-rate delta
  updatedAt: string;
  history: SkillVersionEntry[];
}

/* ---- Campaign ------------------------------------------------------------ */

/** Knight M job-ad compliance check — re-run on every edit before publish. */
export interface JobAdCompliance {
  checked: boolean;
  passed: boolean;
  issues: string[];
  checkedAt: string | null;
}

/** The drafted job ad + its compliance state (TAnIA Stage 0 "Job ad creation"). */
export interface JobAd {
  content: string;
  screeningQuestions: string[];
  knightM: JobAdCompliance;
  status: "draft" | "published";
  updatedAt: string;
}

export interface CampaignMetrics {
  sourced: number;
  contacted: number;
  replied: number;
  interested: number;
  booked: number;
  interviewed: number;
  offer: number;
  hired: number;
  notInterested: number;
  replyRate: number; // 0-1
  avgMatchScore: number;
  timeToFirstInterviewHours: number | null;
  emailsSentToday: number;
  linkedinSentToday: number;
}

export interface Campaign {
  id: string;
  title: string;
  department: string;
  urgency: Urgency;
  status: CampaignStatus;
  /** Status to restore to on resume. Set when pausing; persisted on the record
   *  itself (not component state) so it survives navigation/remount. */
  previousStatus?: CampaignStatus | null;
  hiringManager: string;
  hiringManagerEmail: string;
  createdAt: string;
  targetStartDate: string;
  jobAnalysis: JobAnalysis;
  sourcingStrategy: SourcingStrategy;
  scoringWeights: ScoringWeights;
  metrics: CampaignMetrics;
  skillUpdates: SkillUpdate[];
  activities: Activity[];
  /** Drafted job ad + Knight M compliance (TAnIA Stage 0). Optional/additive. */
  jobAd?: JobAd;
}

/* ---- Weekly report ------------------------------------------------------- */

export interface FunnelPoint {
  stage: FunnelStage;
  count: number;
}

export interface WeeklyReport {
  id: string;
  campaignId: string;
  campaignTitle: string;
  generatedAt: string;
  periodLabel: string;
  funnel: FunnelPoint[];
  performance: {
    replyRate: number;
    interestRate: number;
    bookingRate: number;
    avgMatchScore: number;
    timeToFirstInterviewHours: number | null;
    costPerHire: number;
    bestChannel: OutreachChannel;
    bestDay: string;
    bestTime: string;
  };
  insights: string[];
  winningPatterns: string[];
  skillUpdates: SkillUpdate[];
  attentionNeeded: string[];
  /** Dot-paths (e.g. "performance.costPerHire", "winningPatterns") into this report
   *  that are fixed reference/benchmark values rather than computed from this
   *  campaign's actual state — e.g. an industry-average cost-per-hire, a generic
   *  best-send-time heuristic, "patterns" copy. Set by generateWeeklyReport in
   *  mock-ai.ts, the single place that knows which fields it fabricated vs.
   *  derived from real candidate/message data. Every consumer (report card,
   *  Markdown export, any future surface) must read this list and label those
   *  fields as illustrative rather than presenting them as verified figures. */
  illustrativeFields: string[];
}

/* ---- Integrations -------------------------------------------------------- */

export interface IntegrationStatus {
  id: string;
  name: string;
  category: "Inbox" | "Sourcing" | "Enrichment" | "CRM" | "Calendar" | "Comms" | "Infra";
  description: string;
  status: IntegrationHealth;
  mode: IntegrationMode;
  lastSync: string | null;
  errors: string[];
  /** Email or identifier of the linked mailbox account (OAuth or SMTP). Empty = not set. */
  connectedAccount?: string;
  /** True when this card has actual backend wiring in this codebase (a real API
   *  route, OAuth flow, or send path) rather than being a roadmap placeholder.
   *  Concept cards render an honest "Concept" badge and hide the Test-connection /
   *  Live-mode controls, which would otherwise be theater with nothing behind them. */
  real: boolean;
  /** For a real integration with no live connection check (see testIntegration in
   *  store.ts, which only probes GitHub): where to send the operator to actually
   *  configure it (e.g. the Agent Fleet mailbox connect flow). Absent = no in-app
   *  setup surface (e.g. an env-var-only credential) — the card shows Configure only. */
  setupHref?: string;
}

/* ---- Settings ------------------------------------------------------------ */

export interface RateLimits {
  emailsPerDay: number;
  linkedinPerDay: number;
  followUpGapDays: number;
  suppressionDays: number;
}

export interface ComplianceSettings {
  candidateRetentionDays: number;
  jdRetentionDays: number;
  emailContentRetentionDays: number;
  crmAuditLogs: boolean;
  unsubscribeEnforcement: boolean;
  ccpaDoNotSell: boolean;
  gdprMode: boolean;
}

/* ---- Guardrails & Aria (the agent's editable brain) ---------------------- */

export interface GuardrailRule {
  id: string;
  text: string;
  enabled: boolean;
  /** Locked safety rails ("so we don't get banned") — cannot be disabled or removed. */
  locked?: boolean;
}

export interface GuardrailConfig {
  /** Aria's master system prompt — every agent inherits it as their base brain. */
  ariaPrompt: string;
  /** Editable behavior rules injected into every agent. Locked ones are non-negotiable. */
  rules: GuardrailRule[];
}

export interface SystemSettings {
  humanApprovalGate: boolean;
  dryRunMode: boolean;
  minScoreToContact: number;
  /** Match-score cutoffs mapping to the Mantu Star Rating (TopGun/A/B/C/D).
   *  A score ≥ topGun is a TOP GUN, ≥ a is an A player, ≥ b a B, ≥ c a C, else D. */
  starRatingThresholds?: { topGun: number; a: number; b: number; c: number };
  slaMinutes: number;
  operatorName: string;
  systemIdentity: string;
  rateLimits: RateLimits;
  compliance: ComplianceSettings;
  fleet: FleetSettings;
  /** When on, candidate PII is masked everywhere except an active outreach context,
   *  and any reveal is written to the audit trail (purpose limitation). */
  confidentialityMode: boolean;
  /** Default language Aria composes outreach in (ISO code). */
  defaultLanguage: string;
  /** Operations-floor sound effects. OFF by default. */
  soundEnabled: boolean;
  /** Editable guardrails + Aria's master prompt — the adjustable brain of every agent. */
  guardrails: GuardrailConfig;
  notifications: {
    slack: boolean;
    telegram: boolean;
    email: boolean;
  };
  /** Configured LLM provider connections for the sourcing fleet. */
  llmProviders: LlmProvider[];
  /** Saved models the fleet can use (references a provider by id). */
  savedModels: SavedModel[];
  /** Per-capability tool registry — toggles apply to every agent by default. */
  tools: ToolDef[];
  /** Registered MCP (Model Context Protocol) servers — extra tool sources the fleet
   *  can connect to. The raw auth token lives in the key vault, referenced by id. */
  mcpServers: McpServerConfig[];
  /** Give agents the built-in, read-only web-research tools (web_search / fetch_page /
   *  rss) in chat. Compliant by design: honest bot UA, no login/stealth, SSRF-guarded.
   *  Only active when a cloud LLM provider is configured for the chat task. */
  webResearch?: boolean;
  /** Default model per task type (SavedModel.id). */
  defaultModels?: Partial<Record<ModelTask, string>>;
  /** When on, outreach drafting routes through the live Aria agent runtime
   *  (with a mock fallback). Off by default — the safe default for this build. */
  hermesLiveMode: boolean;
  /** Base URL of the hermes-agent aiohttp server (e.g. http://127.0.0.1:8642). */
  hermesApiUrl?: string;
  /** References an ApiKey.id (provider "Aria Agent") holding the bearer token. */
  hermesApiKeyId?: string;
  /** Maximum number of memory entries stored across all agents. */
  memoryCapacity?: number;
  /** Base URL of the hermes-agent web_server / management API (e.g. http://127.0.0.1:8643).
   *  Distinct from hermesApiUrl which is the OpenAI-compat generation endpoint. */
  hermesWebUrl?: string;
  /** Dust (dust.tt) agent-platform connection: workspace id, vault key reference,
   *  and which agent is locked to each DustTask. Optional — absent means Dust is
   *  not configured for this workspace. */
  dust?: DustSettings;
}

/* ---- Outreach fleet (multi-seat coordination + anti-ban guardrails) ------- */

export const SEAT_PROVIDERS = [
  "Microsoft Graph",
  "Gmail API",
  "SendGrid",
  "Resend",
  "WhatsApp Cloud",
  "Twilio SMS",
  "LinkedIn Assisted Manual",
  "LinkedIn Vendor API",
] as const;
export type SeatProvider = (typeof SEAT_PROVIDERS)[number];

export const SEAT_STATUSES = ["active", "paused", "disabled"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export interface SendWindow {
  startHour: number; // 0-23, local to timezone
  endHour: number; // 0-23
  timezone: string;
  days: number[]; // 0=Sun .. 6=Sat
}

export interface SeatHealth {
  sentTotal: number;
  bounces: number;
  complaints: number;
  bounceRate: number; // 0-1
  complaintRate: number; // 0-1
}

/**
 * An AgentSeat is ONE real, authorized sending identity (a mailbox the operator
 * owns) connected through an OFFICIAL provider API. Seats coordinate to share
 * load WITHOUT exceeding any single account's published limits — this is
 * team coordination, never rate-limit evasion. No scraping, no LinkedIn
 * automation, no synthetic identities.
 */
export interface AgentSeat {
  id: string;
  name: string; // operator / persona label
  operatorEmail: string; // the authorized sending mailbox
  provider: SeatProvider;
  status: SeatStatus;
  mode: IntegrationMode; // mock (default) | live
  /** SPF/DMARC/DKIM for API-key senders. Live Microsoft Graph OAuth seats skip vanity DNS. */
  domainVerified: boolean;
  dailyLimit: number; // conservative cap at/below the provider's official limit
  warmup: boolean;
  warmupStartCap: number;
  warmupStepPerDay: number;
  warmupStartedAt: string;
  minGapMinutes: number; // human-paced spacing (with jitter)
  sendWindow: SendWindow;
  sentToday: number;
  lastSendAt: string | null;
  health: SeatHealth;
  /** Editable per-agent prompt — the voice/instructions this Aria agent writes with. */
  persona: string;
  signature: string;
  /** Optional custom robot colour (any CSS hex, e.g. "#3B82F6"). When set it
   *  overrides the auto-assigned floor palette so new agents can use any colour. */
  color?: string;
  /** Language this agent writes outreach in (ISO code). */
  language?: string;
  /** Mailbox account label. For Graph/Gmail, Live send requires mode=live (OAuth); a pasted label alone is not a live mailbox. */
  connectedAccount: string;
  createdAt: string;
  /** LlmProvider.id assigned to this agent (overrides workspace default). */
  providerId?: string;
  /** SavedModel.id assigned to this agent. */
  modelId?: string;
  /** Tool IDs enabled for this agent (overrides workspace defaults when set). */
  toolIds?: ToolId[];
}

export const SUPPRESSION_TYPES = ["email", "domain", "phone", "linkedin"] as const;
export type SuppressionType = (typeof SUPPRESSION_TYPES)[number];

export interface SuppressionEntry {
  id: string;
  type: SuppressionType;
  value: string;
  reason: string;
  source: string;
  createdAt: string;
  expiresAt: string | null; // null = permanent (e.g. do-not-contact)
}

export const LEDGER_STATUSES = [
  "claimed",
  "pending_manual",
  "sent",
  "bounced",
  "complained",
  "skipped",
  // Unknown provider outcome after transport began — holds the de-dupe slot;
  // resolved only by human reconciliation, never by an automatic retry.
  "ambiguous",
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Authoritative append-only record of every contact attempt across all seats. */
export interface OutreachLedgerEntry {
  id: string;
  candidateId: string;
  candidateEmail: string;
  seatId: string;
  campaignId: string;
  channel: OutreachChannel;
  status: LedgerStatus;
  reason: string | null;
  at: string;
}

export interface FleetSettings {
  recontactWindowDays: number; // global re-contact suppression window (default 90)
  bounceRatePauseThreshold: number; // auto-pause a seat above this (e.g. 0.05)
  complaintRatePauseThreshold: number; // e.g. 0.001
  enforceBusinessHours: boolean;
  jitter: boolean;
  globalDailyCap: number | null; // optional org-wide ceiling across all seats
  maxAgents: number; // hard ceiling on deployable agents (e.g. 300)
}

export interface AllocationAssignment {
  seatId: string;
  seatName: string;
  candidateId: string;
  candidateName: string;
}

export interface AllocationSkip {
  candidateId: string;
  candidateName: string;
  reason: string;
}

export interface AllocationResult {
  assignments: AllocationAssignment[];
  deferred: AllocationSkip[]; // no seat capacity right now
  skipped: AllocationSkip[]; // suppressed / duplicate / recently contacted
  fleetCapacityRemaining: number;
}

/* ---- Roles / access control ---------------------------------------------- */

export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/* ---- API keys / secrets -------------------------------------------------- */

export const API_KEY_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "Google",
  "xAI",
  "Groq",
  "OpenRouter",
  "Mistral",
  "Kimi (Moonshot)",
  "DeepSeek",
  "NVIDIA NIM",
  "Resend",
  "SendGrid",
  "Aria Agent",
  "Dust",
  "Sillage",
  "Apollo",
  "Seamless",
  "Apify",
  "Tavily",
  "HeyReach",
  "Databricks",
  "Custom",
] as const;
export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/* ---- LLM providers (the fleet's model layer) ----------------------------- */

export const LLM_PROVIDERS = [
  "Anthropic",
  "OpenAI",
  "OpenRouter",
  "Google",
  "xAI",
  "Groq",
  "Mistral",
  "Kimi",
  "DeepSeek",
  "NVIDIA NIM",
  "Local/Custom",
] as const;
export type LlmProviderKind = (typeof LLM_PROVIDERS)[number];

export interface LlmProvider {
  id: string;
  /** Which hosted provider this connects to. */
  kind: LlmProviderKind;
  label: string;
  /** Override the provider's default base URL (e.g. proxy or local endpoint). */
  baseUrl?: string;
  /** References an ApiKey.id — the raw secret never lives in provider state. */
  apiKeyId?: string;
  enabled: boolean;
  isDefault?: boolean;
}

export type ModelTask = "sourcing" | "outreach" | "classification" | "chat";

export interface SavedModel {
  id: string;
  providerId: string;
  modelName: string;
  label: string;
  contextWindow?: number;
  enabled: boolean;
  defaultForTask?: ModelTask[];
}

export const TOOL_IDS = [
  "web_search",
  "browser",
  "github_sourcing",
  "linkedin_sourcing",
  "enrichment",
  "email_send",
  "calendar",
  "vision",
  "image_gen",
  "memory",
  "skills",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolDef {
  id: ToolId;
  label: string;
  description: string;
  enabled: boolean;
}

export type McpServerStatus = "untested" | "connected" | "error";

export const MCP_AUTH_STYLES = ["bearer", "query", "x-api-key"] as const;
export type McpAuthStyle = (typeof MCP_AUTH_STYLES)[number];

export const AUTH_QUERY_PARAMS = ["tavilyApiKey"] as const;
export type AuthQueryParam = (typeof AUTH_QUERY_PARAMS)[number];

/** A registered Model Context Protocol server — an external source of tools the fleet
 *  can call. Mirrors LlmProvider: the auth token lives in the key vault by id, never
 *  inline. */
export interface McpServerConfig {
  id: string;
  name: string;
  /** The MCP server's HTTP(S) endpoint (streamable-HTTP / SSE transport). */
  url: string;
  /** How the resolved vault secret is sent to the MCP server. Defaults to bearer. */
  authStyle?: McpAuthStyle;
  /** Closed-list query parameter for query-auth MCP servers. */
  authQueryParam?: AuthQueryParam;
  /** References an ApiKey.id; the raw secret never lives here. */
  apiKeyId?: string;
  enabled: boolean;
  status: McpServerStatus;
  lastTestedAt?: string;
  /** Tools the server exposed on the last successful connection test. */
  toolCount?: number;
  /** Names of those tools (for display), captured on the last successful test. */
  toolNames?: string[];
  /** Known integration preset — used for HeyReach funnel wiring in Settings. */
  preset?: "heyreach";
}

/** Recruiting tasks that can be delegated to a locked Dust agent. A Record (not an
 *  enum-keyed object) so more tasks can be added later without a schema change. */
export const DUST_TASKS = ["jdAnalysis", "companyResearch"] as const;
export type DustTask = (typeof DUST_TASKS)[number];

/** One agent configuration in a Dust workspace, as returned by
 *  `assistant/agent_configurations`. Non-secret (name/description only) — the
 *  client-safe counterpart to the server-only `DustAgentSummary` REST client
 *  produces in `src/lib/dust/client.ts` (re-exported from there). */
export interface DustAgentSummary {
  sId: string;
  name: string;
  description: string;
}

/** Dust's public API is region-hosted: https://dust.tt (US) or https://eu.dust.tt (EU). */
export type DustRegion = "us" | "eu";

/** Non-secret Dust config returned by the normalized integration endpoint.
 * The legacy settings.dust field is stripped during state normalization and by
 * the database; this shape remains the client contract for the Settings panel. */
export interface DustSettings {
  /** The Dust workspace id (path segment in every Dust API call), e.g. "abc123". */
  workspaceId: string;
  /** Dust's public API is region-hosted -- the workspace id alone doesn't tell you
   *  which. Defaults to "us" so existing connections (persisted before this field
   *  existed) keep working unchanged. */
  region?: DustRegion;
  /** References an ApiKey.id (provider "Dust") holding the bearer token. */
  apiKeyId?: string;
  /** True once a Configure + "Test connection" round-trip has succeeded. */
  connected: boolean;
  /** Which Dust agent (by sId) is locked to each task, keyed by DustTask. A loose
   *  Record<string, string> (not Partial<Record<DustTask, string>>) so new task
   *  keys can be added later purely by extending DUST_TASKS — no JSONB schema
   *  change, since workspace_state is one schemaless document. */
  agentLocks: Record<string, string>;
  /** Snapshot of the workspace's agents from the last successful Connect/Reconnect,
   *  cached client-side purely to populate the task-lock dropdowns without
   *  re-entering the API key on every Settings visit — same convention as
   *  `McpServerConfig.toolNames`. Non-secret. */
  agents?: DustAgentSummary[];
}

export interface DatabricksSettings {
  host: string;
  warehouseId: string;
  authMode: "pat" | "m2m";
  clientId?: string;
  apiKeyId: string;
  needsQuery: string;
}

/** Stored metadata only — the secret value never lives in client state. */
export interface ApiKey {
  id: string;
  name: string;
  provider: ApiKeyProvider;
  last4: string;
  status: "untested" | "valid" | "invalid";
  lastTestedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export const EMAIL_CONNECTION_PROVIDERS = ["Gmail API", "Microsoft Graph"] as const;
export type EmailConnectionProvider = (typeof EMAIL_CONNECTION_PROVIDERS)[number];

/** Server-side OAuth connection for an email sending seat.
 *  Secrets are stored in Postgres and never returned to the browser. */
export interface EmailConnection {
  id: string;
  seatId: string;
  provider: EmailConnectionProvider;
  accountEmail: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string;
  connectedAt: string;
  updatedAt: string;
}

/* ---- Memory -------------------------------------------------------------- */

export const MEMORY_KINDS = ["fact", "preference", "instruction", "episodic"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryEntry {
  id: string;
  seatId: string;
  kind: MemoryKind;
  content: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ---- Chat ---------------------------------------------------------------- */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  pending?: boolean;
  /** Set when a LIVE model/streaming call genuinely failed — content holds the
   *  error text, rendered as an error bubble instead of a normal reply. */
  error?: boolean;
}

export interface ChatThread {
  id: string;
  seatId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/* ---- Schedules (local CRUD, demo posture — no live cron yet) ------------ */

export const CRON_CADENCES = ["daily", "weekly", "monthly"] as const;
export type CronCadence = (typeof CRON_CADENCES)[number];

export interface CronJob {
  id: string;
  name: string;
  cadence: CronCadence;
  /** Time of day in HH:MM format (local timezone), optional. */
  timeOfDay?: string;
  task: "sourcing" | "outreach" | "report";
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

/* ---- Root persisted state ------------------------------------------------ */

export interface HermesState {
  version: number;
  campaigns: Campaign[];
  candidates: Candidate[];
  outreach: OutreachMessage[];
  replies: ClassifiedReply[];
  bookings: Booking[];
  wins: WinRecord[];
  /** Registered real staff available for interview round-robin (replaces the
   *  hardcoded mock-ai roster). Empty = no interviewer assigned on booking. */
  interviewers: Interviewer[];
  reports: WeeklyReport[];
  integrations: IntegrationStatus[];
  activities: Activity[];
  settings: SystemSettings;
  seats: AgentSeat[];
  suppression: SuppressionEntry[];
  ledger: OutreachLedgerEntry[];
  skills: AgentSkill[];
  apiKeys: ApiKey[];
  currentRole: Role;
  chats: ChatThread[];
  memory: MemoryEntry[];
  /** Scheduled automation jobs. Demo posture — UI only, no live cron. */
  schedules: CronJob[];
  activeCampaignId: string | null;
  /** Dedup ledger of provider message ids already ingested (inbound email tracking). */
  ingestedMessageIds?: string[];
  /** Scored external applications from the career-website chatbox, awaiting
   *  recruiter handoff to the Applicant Screener (TAnIA §5). Additive. */
  chatboxSubmissions?: ChatboxSubmission[];
  /** Append-only spend ledger for the unified enrichment orchestrator — one
   *  entry per provider call, whether or not it found data (costUnits may be 0).
   *  The audit trail behind enrichmentBudgetUnits. Additive. */
  enrichmentLedger?: { provider: SourcePlatform; candidateId: string; units: number; at: string }[];
  /** Per-workspace cap on total enrichment spend (arbitrary provider-defined
   *  cost units). Absent = no cap enforced (treated as unlimited upstream). */
  enrichmentBudgetUnits?: number;
}
