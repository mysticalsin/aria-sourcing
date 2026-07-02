import type {
  CompanyStage,
  IntakeIntent,
  JobAnalysis,
  Seniority,
  SystemSettings,
  Urgency,
  ValidationWarning,
} from "@/lib/types";
import { COMPANY_STAGES, INTAKE_INTENTS, SENIORITY_LEVELS, URGENCY_LEVELS } from "@/lib/types";
import { buildClarificationEmail, parseEmailAndJD, type ParsedIntake } from "@/lib/mock-ai";
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

const LOCATION_TYPES: JobAnalysis["locationType"][] = ["Remote", "Hybrid", "On-site"];
const EMPLOYMENT_TYPES: JobAnalysis["employmentType"][] = ["Full-time", "Contract", "Part-time"];

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

function deriveValidationWarnings(
  job: Pick<JobAnalysis, "salaryMin" | "salaryMax" | "requiredSkills" | "minYearsExperience">,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  if (job.salaryMin == null && job.salaryMax == null)
    warnings.push({ field: "salary", severity: "warning", message: "No salary range provided." });
  if (job.requiredSkills.length < 3)
    warnings.push({
      field: "requiredSkills",
      severity: "critical",
      message: "Fewer than 3 required skills detected. JD may be vague.",
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

  const aiCfg = resolveAiProvider(settings, "chat");
  if (!aiCfg && !(settings.hermesLiveMode && hermesAvailable(settings))) return mock;

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
    return mock;
  }
  if (!result.ok || !result.text) return mock;

  const fields = parseHermesIntakeJson(result.text);
  if (!fields) return mock;

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
  };
}
