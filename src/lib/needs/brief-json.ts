/**
 * Ingest normalized consulting_recruitment JSON (and flat fixture JSON)
 * into JobAnalysis so screening_criteria / boolean_search / mandatory
 * requirements drive matching — not only VSS free text.
 */
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import type {
  CompanyStage,
  EmploymentType,
  JobAnalysis,
  LocationType,
  Seniority,
  Urgency,
  ValidationWarning,
} from "@/lib/types";

export interface ConsultingRecruitmentBrief {
  id?: string;
  title?: string;
  client?: string;
  employer?: string;
  city?: string;
  location?: string;
  remote?: string;
  startDate?: string;
  seniority?: string;
  minYearsExperience?: number;
  maxYearsExperience?: number;
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  requiredLanguages?: string[];
  /** Alias used by some Calypso / consulting exports. */
  mandatory_requirements?: string[];
  screening_criteria?: string[];
  screenHard?: string[];
  boolean_search?: string;
  searchBoolean?: string;
  industryExperience?: string[];
  preferOpenToWork?: boolean;
  department?: string;
  employmentType?: string;
  timezone?: string;
  regions?: string[];
  missionDescription?: string;
  qualityFloor?: number;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}
function asNumber(v: unknown): number | null | undefined {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function detectSeniority(raw: string | undefined, title: string): Seniority {
  const hay = `${raw ?? ""} ${title}`;
  if (/principal/i.test(hay)) return "Principal";
  if (/staff/i.test(hay)) return "Staff";
  if (/lead/i.test(hay)) return "Lead";
  if (/director|head of/i.test(hay)) return "Director";
  if (/junior|graduate|entry/i.test(hay)) return "Junior";
  if (/\bmid\b|intermediate/i.test(hay)) return "Mid";
  if (/\bsenior\b/i.test(hay)) return "Senior";
  return "Unspecified";
}

function detectLocationType(remote: string | undefined): LocationType {
  if (!remote) return "Unspecified";
  if (/partial|hybrid/i.test(remote)) return "Hybrid";
  if (/fully\s+remote|100%\s+remote|\bremote\b/i.test(remote)) return "Remote";
  if (/on-?site|office/i.test(remote)) return "On-site";
  return "Unspecified";
}

function detectEmploymentType(raw: string | undefined): EmploymentType {
  if (!raw) return "Unspecified";
  if (/consulting|contract|freelance/i.test(raw)) return "Contract";
  if (/part[- ]time/i.test(raw)) return "Part-time";
  if (/full[- ]time|permanent|cdi|cti/i.test(raw)) return "Full-time";
  return "Unspecified";
}

function regionsFor(city: string | undefined, remote: string | undefined, regions?: string[]): string[] {
  if (regions?.length) return [...regions];
  const out: string[] = [];
  if (city) out.push(city);
  if (/europe|emea|\beu\b|berlin|paris|london|amsterdam|cet/i.test(`${city ?? ""} ${remote ?? ""}`)) {
    if (!out.some((r) => /^eu$/i.test(r))) out.push("EU");
    if (/europe|emea/i.test(`${city ?? ""} ${remote ?? ""}`) && !out.some((r) => /emea/i.test(r))) {
      out.push("EMEA");
    }
  }
  if (/montreal|canada|toronto|vancouver/i.test(city ?? "")) {
    if (!out.some((r) => /canada/i.test(r))) out.push("Canada");
  }
  if (/remote/i.test(remote ?? "") && !out.some((r) => /remote/i.test(r))) out.push("Remote");
  return out;
}

function timezoneFor(city: string | undefined, remote: string | undefined, tz?: string): string {
  if (tz?.trim()) return tz.trim();
  if (/berlin|europe|emea|paris|amsterdam|cet|\beu\b/i.test(`${city ?? ""} ${remote ?? ""}`)) return "CET";
  if (/montreal|toronto|new york|est|edt/i.test(city ?? "")) return "EST";
  return "";
}

/** True when the pasted text looks like a consulting_recruitment / need JSON blob. */
export function looksLikeBriefJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (!parsed || typeof parsed !== "object") return false;
    const root = parsed as Record<string, unknown>;
    const brief =
      root.consulting_recruitment && typeof root.consulting_recruitment === "object"
        ? (root.consulting_recruitment as Record<string, unknown>)
        : root.brief && typeof root.brief === "object"
          ? (root.brief as Record<string, unknown>)
          : root;
    return Boolean(
      asString(brief.title) ||
        asStringArray(brief.requiredSkills) ||
        asStringArray(brief.mandatory_requirements) ||
        asString(brief.boolean_search) ||
        asString(brief.searchBoolean),
    );
  } catch {
    return false;
  }
}

/** Extract the consulting_recruitment / flat brief object from parsed JSON. */
export function extractBriefObject(raw: unknown): ConsultingRecruitmentBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const nested =
    root.consulting_recruitment && typeof root.consulting_recruitment === "object"
      ? (root.consulting_recruitment as Record<string, unknown>)
      : root.brief && typeof root.brief === "object"
        ? (root.brief as Record<string, unknown>)
        : root;
  return nested as ConsultingRecruitmentBrief;
}

/**
 * Map a consulting_recruitment (or flat fixture) JSON object into JobAnalysis.
 * Returns null when title + skills cannot be resolved.
 */
export function jobAnalysisFromBriefJson(raw: unknown): JobAnalysis | null {
  const brief = extractBriefObject(raw);
  if (!brief) return null;

  const title = asString(brief.title);
  const mustFromSkills = asStringArray(brief.requiredSkills) ?? [];
  const mustFromMandatory = asStringArray(brief.mandatory_requirements) ?? [];
  const requiredSkills =
    mustFromSkills.length > 0
      ? mustFromSkills
      : mustFromMandatory.length > 0
        ? mustFromMandatory
        : [];
  if (!title && requiredSkills.length === 0) return null;

  const nice = asStringArray(brief.niceToHaveSkills) ?? [];
  const screening =
    asStringArray(brief.screening_criteria) ?? asStringArray(brief.screenHard) ?? [];
  const city = asString(brief.city) ?? asString(brief.location);
  const remote = asString(brief.remote);
  const searchBoolean =
    asString(brief.boolean_search) ?? asString(brief.searchBoolean) ?? null;
  const requiredLanguages = asStringArray(brief.requiredLanguages);
  const industry =
    asStringArray(brief.industryExperience) ??
    (/bank|finance|cib|calypso|capital markets/i.test(
      `${title ?? ""} ${asString(brief.client) ?? ""} ${screening.join(" ")}`,
    )
      ? ["Bank & Finance", "Capital Markets", "CIB"]
      : /tech|saas|software|cloud|typescript|engineer/i.test(`${title ?? ""} ${asString(brief.client) ?? ""}`)
        ? ["Technology", "SaaS"]
        : []);

  const resolvedTitle = title || requiredSkills.slice(0, 2).join(" ") || "Untitled role";
  const urgency: Urgency = "Urgent";
  const validationWarnings: ValidationWarning[] = [];

  const jd: JobAnalysis = {
    title: resolvedTitle.replace(/^IS&D\s*-\s*/i, "").trim() || resolvedTitle,
    department: asString(brief.department) ?? asString(brief.client) ?? "",
    seniority: detectSeniority(asString(brief.seniority), resolvedTitle),
    employmentType: detectEmploymentType(asString(brief.employmentType) ?? remote),
    locationType: detectLocationType(remote),
    location: city,
    regions: regionsFor(city, remote, asStringArray(brief.regions)),
    timezone: timezoneFor(city, remote, asString(brief.timezone)),
    salaryMin: null,
    salaryMax: null,
    currency: "",
    equity: false,
    requiredSkills,
    niceToHaveSkills: nice,
    requiredLanguages,
    minYearsExperience: asNumber(brief.minYearsExperience) ?? null,
    maxYearsExperience: asNumber(brief.maxYearsExperience) ?? null,
    education: "",
    industryExperience: industry,
    companyStageTarget: [] as CompanyStage[],
    teamSize: "",
    reportingTo: "",
    urgency,
    language: requiredLanguages?.[0]?.toLowerCase().startsWith("fr") ? "fr" : "en",
    missionDescription:
      asString(brief.missionDescription) ||
      (screening.length ? screening.join("; ") : undefined),
    expectedStartDate: asString(brief.startDate) ?? null,
    searchBoolean,
    screeningCriteria: screening.length ? screening : undefined,
    preferOpenToWork: asBoolean(brief.preferOpenToWork),
    validationWarnings,
  };

  const readiness = evaluateNeedReadiness(jd);
  jd.validationWarnings = [
    ...readiness.issues,
    ...(requiredSkills.length < 2
      ? [
          {
            field: "requiredSkills",
            severity: "warning" as const,
            message: "Fewer than 2 required skills in JSON brief.",
          },
        ]
      : []),
  ];
  return jd;
}

/** Parse a JSON string into JobAnalysis, or null on failure. */
export function parseBriefJsonText(text: string): JobAnalysis | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    return jobAnalysisFromBriefJson(parsed);
  } catch {
    return null;
  }
}
