import type {
  CompanyStage,
  IntakeIntent,
  JobAnalysis,
  Seniority,
  SystemSettings,
  Urgency,
  ValidationWarning,
} from "@/lib/types";
import {
  COMPANY_STAGES,
  EMPLOYMENT_TYPES,
  INTAKE_INTENTS,
  LOCATION_TYPES,
  SENIORITY_LEVELS,
  URGENCY_LEVELS,
} from "@/lib/types";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { buildClarificationEmail, parseEmailAndJD, type ParsedIntake } from "@/lib/mock-ai";
import { isVssRecruitmentNeed } from "@/lib/sourcing/vss-need";
import { resolveAiProvider } from "./provider";
import { hermesAvailable, hermesGenerate } from "./hermes";

/* ============================================================================
   Live intake / JD parsing — client helper.

   parseEmailAndJD (the regex heuristic in mock-ai.ts) is the canonical fallback:
   it is always computed first and returned unchanged whenever no cloud provider
   is configured, the live call fails, or the reply isn't usable JSON. This
   mirrors the same three-layer fallback generateOutreachLive uses for outreach
   drafting and classifyAndStoreReply uses for reply classification (store.ts) —
   this is TEXT EXTRACTION ONLY, routed over the existing /api/hermes/chat proxy's
   "chat" task (no dedicated "parse" task/route — the prompt below is fully
   self-contained, so the generic chat system prompt is enough). Never creates,
   sends, or contacts anything; the intake page still requires an explicit
   "Create campaign" click from the human.
   ========================================================================== */

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function pickStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value.map((v) => (v as string).trim()).filter(Boolean)
    : undefined;
}
function pickNumberOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
function pickEmail(value: unknown): string | undefined {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim() : undefined;
}

/** Every field optional — an absent/invalid field falls back to the heuristic's
 *  value in parseIntakeLive. Only fields that pass strict type/enum validation
 *  survive parseHermesIntakeJson, so a hallucinated shape can't corrupt state. */
interface LiveIntakeFields {
  senderName?: string;
  senderEmail?: string;
  intent?: IntakeIntent;
  urgency?: Urgency;
  title?: string;
  department?: string;
  seniority?: Seniority;
  employmentType?: JobAnalysis["employmentType"];
  locationType?: JobAnalysis["locationType"];
  regions?: string[];
  timezone?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  equity?: boolean;
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  minYearsExperience?: number | null;
  maxYearsExperience?: number | null;
  education?: string;
  industryExperience?: string[];
  companyStageTarget?: CompanyStage[];
  teamSize?: string;
  reportingTo?: string;
  language?: string;
}

/** Self-contained JSON-extraction prompt — carries its own output-format
 *  instructions, so it doesn't depend on a task-specific system prompt. */
export function buildIntakeParsePrompt(text: string): string {
  return [
    "Extract a structured hiring brief from the recruiter email / job description below.",
    "Reply with JSON only — no prose, no markdown fences, no commentary — matching exactly this shape " +
      '(use null for an unknown number, "" for an unknown string, [] for an unknown list; never invent ' +
      "specifics — names, numbers, companies — that aren't stated in the text):",
    JSON.stringify(
      {
        senderName: "string",
        senderEmail: "string",
        intent: "New Role | Backfill | Urgent Hire | Exploratory",
        urgency: "ASAP | Critical | Urgent | This Week | Standard",
        title: "string",
        department: "string",
        seniority: "Junior | Mid | Senior | Staff | Principal | Lead | Director",
    employmentType: "Full-time | Contract | Part-time",
    locationType: "Remote | Hybrid | On-site",
        regions: ["string"],
        timezone: "string",
        salaryMin: "number|null",
        salaryMax: "number|null",
        currency: "string",
        equity: "boolean",
        requiredSkills: ["string"],
        niceToHaveSkills: ["string"],
        minYearsExperience: "number|null",
        maxYearsExperience: "number|null",
        education: "string",
        industryExperience: ["string"],
        companyStageTarget: ["Seed | Series A | Series B | Series C+ | Public | Enterprise"],
        teamSize: "string",
        reportingTo: "string",
        language: "ISO 639-1 code, e.g. en",
      },
      null,
      2,
    ),
    "",
    "TEXT:",
    text.slice(0, 12_000),
  ].join("\n");
}

/** Tolerant JSON parse + per-field validation. Returns null only when the reply
 *  has no usable JSON object at all — caller then falls back entirely to the
 *  heuristic. Mirrors parseHermesOutreach's tolerant-parse contract. */
export function parseHermesIntakeJson(text: string): LiveIntakeFields | null {
  const trimmed = (text ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  return {
    senderName: pickString(o.senderName),
    senderEmail: pickEmail(o.senderEmail),
    intent: pickEnum(o.intent, INTAKE_INTENTS),
    urgency: pickEnum(o.urgency, URGENCY_LEVELS),
    title: pickString(o.title),
    department: pickString(o.department),
    seniority: pickEnum(o.seniority, SENIORITY_LEVELS),
    employmentType: pickEnum(o.employmentType, EMPLOYMENT_TYPES),
    locationType: pickEnum(o.locationType, LOCATION_TYPES),
    regions: pickStringArray(o.regions),
    timezone: pickString(o.timezone),
    salaryMin: pickNumberOrNull(o.salaryMin),
    salaryMax: pickNumberOrNull(o.salaryMax),
    currency: pickString(o.currency),
    equity: pickBoolean(o.equity),
    requiredSkills: pickStringArray(o.requiredSkills),
    niceToHaveSkills: pickStringArray(o.niceToHaveSkills),
    minYearsExperience: pickNumberOrNull(o.minYearsExperience),
    maxYearsExperience: pickNumberOrNull(o.maxYearsExperience),
    education: pickString(o.education),
    industryExperience: pickStringArray(o.industryExperience),
    companyStageTarget: pickStringArray(o.companyStageTarget)?.filter((s): s is CompanyStage =>
      (COMPANY_STAGES as readonly string[]).includes(s),
    ),
    teamSize: pickString(o.teamSize),
    reportingTo: pickString(o.reportingTo),
    language: pickString(o.language),
  };
}

function claimAppearsInSource(value: string | undefined, source: string): boolean {
  if (!value) return false;
  const raw = value.trim().toLowerCase();
  if (!raw) return false;
  if (source.toLowerCase().includes(raw)) return true;
  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim().replace(/\s+/g, " ");
  return normalize(source).includes(normalize(value));
}

function numberAppearsInSource(value: number | null | undefined, source: string): boolean {
  if (value == null) return false;
  if (source.includes(String(value))) return true;
  return value % 1_000 === 0 && new RegExp(`\\b${value / 1_000}\\s*k\\b`, "i").test(source);
}

export function groundLiveIntakeFields(
  fields: LiveIntakeFields,
  source: string,
): LiveIntakeFields {
  const supported = (value: string | undefined) =>
    value && claimAppearsInSource(value, source) ? value : undefined;
  const supportedList = (values: string[] | undefined) =>
    values?.filter((value) => claimAppearsInSource(value, source));
  const sourceLower = source.toLowerCase();
  const seniority = fields.seniority &&
    (claimAppearsInSource(fields.seniority, source) ||
      (fields.seniority === "Mid" && /\bmid(?:dle)?\b|\bmid[- ]level\b|\bintermediate\b/i.test(source)))
      ? fields.seniority
      : undefined;
  const employmentType = fields.employmentType &&
    ((fields.employmentType === "Contract" && /\bcontract|contractor|freelance|day rate|consulting|\bcdi\b/i.test(source)) ||
      (fields.employmentType === "Part-time" && /\bpart[- ]time\b/i.test(source)) ||
      (fields.employmentType === "Full-time" && /\bfull[- ]time\b|\bpermanent\b|\bcdi\b/i.test(source)))
      ? fields.employmentType
      : undefined;
  const locationType = fields.locationType &&
    ((fields.locationType === "Remote" && /\bremote\b|work from home/i.test(source)) ||
      (fields.locationType === "Hybrid" && /\bhybrid\b|partial(?:ly)?\s+remote|possible\s+partial/i.test(source)) ||
      (fields.locationType === "On-site" && /\bon-?site\b|in office|in-person/i.test(source)))
      ? fields.locationType
      : undefined;
  const companyStageTarget = fields.companyStageTarget?.filter((stage) => {
    if (stage === "Series C+") return /series\s*[c-z]/i.test(source);
    return claimAppearsInSource(stage, source);
  });

  return {
    senderName: supported(fields.senderName),
    senderEmail: supported(fields.senderEmail),
    intent: undefined,
    urgency: undefined,
    title: supported(fields.title),
    department: supported(fields.department),
    seniority,
    employmentType,
    locationType,
    regions: supportedList(fields.regions),
    timezone: supported(fields.timezone),
    salaryMin: numberAppearsInSource(fields.salaryMin, source) ? fields.salaryMin : undefined,
    salaryMax: numberAppearsInSource(fields.salaryMax, source) ? fields.salaryMax : undefined,
    currency:
      supported(fields.currency) ??
      (fields.currency === "EUR" && source.includes("€") ? "EUR" : undefined) ??
      (fields.currency === "GBP" && source.includes("£") ? "GBP" : undefined) ??
      (fields.currency === "USD" && source.includes("$") ? "USD" : undefined),
    equity: fields.equity && /equity|options|esop|stock/i.test(sourceLower) ? true : undefined,
    requiredSkills: supportedList(fields.requiredSkills),
    niceToHaveSkills: supportedList(fields.niceToHaveSkills),
    minYearsExperience: numberAppearsInSource(fields.minYearsExperience, source)
      ? fields.minYearsExperience
      : undefined,
    maxYearsExperience: numberAppearsInSource(fields.maxYearsExperience, source)
      ? fields.maxYearsExperience
      : undefined,
    education: supported(fields.education),
    industryExperience: supportedList(fields.industryExperience),
    companyStageTarget,
    teamSize: supported(fields.teamSize),
    reportingTo: supported(fields.reportingTo),
    language: supported(fields.language),
  };
}

/** Exported so callers (e.g. the intake page) can recompute warnings live from
 *  edited job-analysis state instead of relying on the frozen parse-time list. */
export function deriveValidationWarnings(
  job: Pick<
    JobAnalysis,
    | "title"
    | "seniority"
    | "employmentType"
    | "locationType"
    | "salaryMin"
    | "salaryMax"
    | "requiredSkills"
    | "minYearsExperience"
  >,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [...evaluateNeedReadiness(job).issues];
  if (job.salaryMin == null && job.salaryMax == null)
    warnings.push({ field: "salary", severity: "warning", message: "No salary range provided." });
  if (job.requiredSkills.length > 0 && job.requiredSkills.length < 3)
    warnings.push({
      field: "requiredSkills",
      severity: "warning",
      message: "Fewer than 3 required skills were stated. Confirm whether the brief is complete.",
    });
  if (job.minYearsExperience == null)
    warnings.push({ field: "experience", severity: "warning", message: "No years-of-experience band specified." });
  return warnings;
}

/**
 * Live intake parse. `parseEmailAndJD` (the heuristic) is computed first and is
 * the canonical fallback — returned unchanged whenever no cloud provider is
 * configured, the live call errors/fails, or the reply isn't usable JSON.
 * On a usable reply, only the fields the model actually supplied (validated
 * against the same enums/shape the heuristic returns) override the heuristic's;
 * anything omitted or invalid keeps the heuristic value. Never throws.
 */
export async function parseIntakeLive(
  settings: SystemSettings,
  input: { email: string; jd?: string },
): Promise<ParsedIntake> {
  const mock = parseEmailAndJD(input);
  const sourceText = `${input.email}\n${input.jd ?? ""}`;
  if (isVssRecruitmentNeed(sourceText) && evaluateNeedReadiness(mock.jobAnalysis).ready) {
    return mock;
  }

  const aiCfg = resolveAiProvider(settings, "chat");
  if (!aiCfg && !(settings.hermesLiveMode && hermesAvailable(settings))) {
    return {
      ...mock,
      providerWarning: "No cloud parser is configured. Only facts present in the submitted brief were extracted.",
    };
  }

  const prompt = buildIntakeParsePrompt(`${input.email}\n${input.jd ?? ""}`);

  let genInput: Parameters<typeof hermesGenerate>[0];
  if (aiCfg) {
    genInput = { task: "chat", prompt, provider: aiCfg.provider, model: aiCfg.model, apiKeyId: aiCfg.apiKeyId };
  } else {
    const chatModelId = settings.defaultModels?.chat;
    genInput = { task: "chat", prompt, hermesApiUrl: settings.hermesApiUrl, hermesApiKeyId: settings.hermesApiKeyId };
    if (chatModelId) {
      const modelName = (settings.savedModels ?? []).find((m) => m.id === chatModelId)?.modelName;
      if (modelName) genInput.model = modelName;
    }
  }

  let result: Awaited<ReturnType<typeof hermesGenerate>>;
  try {
    result = await hermesGenerate(genInput);
  } catch {
    return {
      ...mock,
      providerWarning: "The cloud parser could not be reached. Only facts present in the submitted brief were extracted.",
    };
  }
  if (!result.ok || !result.text) {
    return {
      ...mock,
      providerWarning: "The cloud parser did not complete. Only facts present in the submitted brief were extracted.",
    };
  }

  const parsedFields = parseHermesIntakeJson(result.text);
  if (!parsedFields) {
    return {
      ...mock,
      providerWarning: "The cloud parser returned an invalid result. Only facts present in the submitted brief were extracted.",
    };
  }
  const fields = groundLiveIntakeFields(parsedFields, `${input.email}\n${input.jd ?? ""}`);

  const jobFields = {
    title: fields.title ?? mock.jobAnalysis.title,
    department: fields.department ?? mock.jobAnalysis.department,
    seniority: fields.seniority ?? mock.jobAnalysis.seniority,
    employmentType: fields.employmentType ?? mock.jobAnalysis.employmentType,
    locationType: fields.locationType ?? mock.jobAnalysis.locationType,
    regions: fields.regions?.length ? fields.regions : mock.jobAnalysis.regions,
    timezone: fields.timezone ?? mock.jobAnalysis.timezone,
    salaryMin: fields.salaryMin !== undefined ? fields.salaryMin : mock.jobAnalysis.salaryMin,
    salaryMax: fields.salaryMax !== undefined ? fields.salaryMax : mock.jobAnalysis.salaryMax,
    currency: fields.currency ?? mock.jobAnalysis.currency,
    equity: fields.equity ?? mock.jobAnalysis.equity,
    requiredSkills: fields.requiredSkills?.length ? fields.requiredSkills : mock.jobAnalysis.requiredSkills,
    niceToHaveSkills: fields.niceToHaveSkills ?? mock.jobAnalysis.niceToHaveSkills,
    minYearsExperience:
      fields.minYearsExperience !== undefined ? fields.minYearsExperience : mock.jobAnalysis.minYearsExperience,
    maxYearsExperience:
      fields.maxYearsExperience !== undefined ? fields.maxYearsExperience : mock.jobAnalysis.maxYearsExperience,
    education: fields.education ?? mock.jobAnalysis.education,
    industryExperience: fields.industryExperience ?? mock.jobAnalysis.industryExperience,
    companyStageTarget: fields.companyStageTarget?.length ? fields.companyStageTarget : mock.jobAnalysis.companyStageTarget,
    teamSize: fields.teamSize ?? mock.jobAnalysis.teamSize,
    reportingTo: fields.reportingTo ?? mock.jobAnalysis.reportingTo,
    urgency: fields.urgency ?? mock.jobAnalysis.urgency,
    language: fields.language ?? mock.jobAnalysis.language,
  };
  const validationWarnings = deriveValidationWarnings(jobFields);
  const jobAnalysis: JobAnalysis = { ...jobFields, validationWarnings };

  const senderName = fields.senderName ?? mock.sender.name;
  const senderEmail = fields.senderEmail ?? mock.sender.email;
  const intent = fields.intent ?? mock.intent;
  const urgency = fields.urgency ?? mock.urgency;
  const hasCritical = validationWarnings.some((w) => w.severity === "critical");

  return {
    sender: { name: senderName, email: senderEmail },
    intent,
    urgency,
    jobAnalysis,
    validationWarnings,
    clarificationDraft: hasCritical ? buildClarificationEmail(senderName, jobAnalysis, validationWarnings) : null,
    confidence: {
      title: fields.title ? 0.9 : mock.confidence.title,
      salary: fields.salaryMin !== undefined || fields.salaryMax !== undefined ? 0.9 : mock.confidence.salary,
      skills: fields.requiredSkills?.length ? 0.9 : mock.confidence.skills,
      location: fields.locationType ? 0.9 : mock.confidence.location,
      seniority: fields.seniority ? 0.9 : mock.confidence.seniority,
    },
    extractionMode: "cloud",
  };
}
