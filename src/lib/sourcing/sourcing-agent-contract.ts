import { z } from "zod";

import type { CandidateDedupeIdentity } from "@/lib/rules";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import {
  CAMPAIGN_STATUSES,
  COMPANY_STAGES,
  EMPLOYMENT_TYPES,
  LLM_PROVIDERS,
  LOCATION_TYPES,
  SENIORITY_LEVELS,
  URGENCY_LEVELS,
  type Campaign,
  type Candidate,
  type JobAnalysis,
  type SystemSettings,
} from "@/lib/types";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/scoring";
import {
  employmentFromVss,
  locationTypeFromRemote,
  seniorityFromVss,
  tokenizeMustHaveSkills,
  urgencyFromVssPriority,
} from "@/lib/sourcing/vss-need";
import { initialsFrom } from "@/lib/utils";

export const SOURCING_AGENT_PROVIDERS = [
  "anthropic",
  "openai",
  "groq",
  "xai",
  "mistral",
] as const;
export const SOURCING_AGENT_MODES = ["deterministic", ...SOURCING_AGENT_PROVIDERS] as const;

const bounded = (max: number) => z.string().max(max);
const boundedArray = (maxItems: number, maxLength: number) =>
  z.array(bounded(maxLength)).max(maxItems);

const ValidationWarningSchema = z
  .object({
    field: bounded(100),
    severity: z.enum(["info", "warning", "critical"]),
    message: bounded(1_000),
  })
  .strict();

const JobAnalysisSchema = z
  .object({
    title: bounded(200),
    department: bounded(200),
    seniority: z.enum(SENIORITY_LEVELS),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    locationType: z.enum(LOCATION_TYPES),
    location: bounded(200).optional(),
    regions: boundedArray(50, 200),
    timezone: bounded(100),
    salaryMin: z.number().finite().nonnegative().nullable(),
    salaryMax: z.number().finite().nonnegative().nullable(),
    currency: bounded(20),
    equity: z.boolean(),
    requiredSkills: boundedArray(100, 100),
    niceToHaveSkills: boundedArray(100, 100),
    minYearsExperience: z.number().finite().nonnegative().nullable(),
    maxYearsExperience: z.number().finite().nonnegative().nullable(),
    education: bounded(500),
    industryExperience: boundedArray(50, 100),
    companyStageTarget: z.array(z.enum(COMPANY_STAGES)).max(20),
    teamSize: bounded(100),
    reportingTo: bounded(200),
    urgency: z.enum(URGENCY_LEVELS),
    language: bounded(20).optional(),
    expectedStartDate: bounded(100).nullable().optional(),
    validationWarnings: z.array(ValidationWarningSchema).max(100),
  });

const ScoringWeightsSchema = z
  .object({
    skills: z.number().finite().min(0).max(100),
    experience: z.number().finite().min(0).max(100),
    companyStage: z.number().finite().min(0).max(100),
    industry: z.number().finite().min(0).max(100),
    location: z.number().finite().min(0).max(100),
    activity: z.number().finite().min(0).max(100),
  })
  .strict()
  .refine((weights) => Object.values(weights).some((weight) => weight > 0));

const CampaignProjectionSchema = z.object({
  id: bounded(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
  status: z.enum(CAMPAIGN_STATUSES),
  jobAnalysis: JobAnalysisSchema,
  scoringWeights: ScoringWeightsSchema,
  sourcingStrategy: z.object({
    excludedCompanies: boundedArray(500, 200),
    linkedinBoolean: bounded(2_000),
    githubQueries: z
      .array(
        z
          .object({
            label: bounded(200),
            query: bounded(500).min(1),
            estimatedResults: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(100),
  }),
});

const DedupeIdentitySchema = z
  .object({
    campaignId: bounded(100),
    email: bounded(320),
    linkedinUrl: bounded(2_048),
    githubUrl: bounded(2_048),
    sourceUrl: bounded(2_048).optional(),
    lastContactedAt: bounded(100).nullable(),
  })
  .strict();

export const SourcingAgentRequestSchema = z
  .object({
    campaignId: bounded(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    count: z.number().int().min(1).max(8).default(5),
    agentFrameworkRunId: z.string().uuid().optional(),
    agentFrameworkCapabilityToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    agentFrameworkQuery: z.string().trim().min(3).max(256).optional(),
    harvestQuery: z.string().trim().min(1).max(256).optional(),
    currentJobTitles: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  })
  .strict()
  .refine(
    (request) => {
      const fields = [
        request.agentFrameworkRunId,
        request.agentFrameworkCapabilityToken,
        request.agentFrameworkQuery,
      ];
      return fields.every(Boolean) || fields.every((value) => value === undefined);
    },
    { message: "Framework run, capability, and reviewed query must be supplied together." },
  );

const LlmProviderSchema = z
  .object({
    id: bounded(100).min(1),
    kind: z.enum(LLM_PROVIDERS),
    label: bounded(200),
    baseUrl: bounded(2_048).optional(),
    apiKeyId: bounded(100).min(1).optional(),
    enabled: z.boolean(),
    isDefault: z.boolean().optional(),
  });

const SavedModelSchema = z
  .object({
    id: bounded(100).min(1),
    providerId: bounded(100).min(1),
    modelName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
    label: bounded(200),
    contextWindow: z.number().int().positive().max(10_000_000).optional(),
    enabled: z.boolean(),
    defaultForTask: z
      .array(z.enum(["sourcing", "outreach", "classification", "chat"]))
      .max(4)
      .optional(),
  });

type SourcingAiSettings = Pick<
  SystemSettings,
  "llmProviders" | "savedModels" | "defaultModels"
>;

export type SourcingAgentCampaign = CandidateMappingCampaign &
  Pick<Campaign, "status"> & {
    sourcingStrategy: Pick<
      Campaign["sourcingStrategy"],
      "excludedCompanies" | "githubQueries" | "linkedinBoolean"
    >;
  };

export type SourcingAgentWorkspace = {
  campaign: SourcingAgentCampaign;
  existing: CandidateDedupeIdentity[];
  aiSettings: SourcingAiSettings;
  configurationFingerprint: string;
  fingerprint: string;
};

export function sourcingAgentCampaignFingerprint(
  campaign: SourcingAgentCampaign,
): string {
  return JSON.stringify({
    id: campaign.id,
    status: campaign.status,
    jobAnalysis: campaign.jobAnalysis,
    scoringWeights: campaign.scoringWeights,
    sourcingStrategy: {
      excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
      githubQueries: campaign.sourcingStrategy.githubQueries,
      linkedinBoolean: campaign.sourcingStrategy.linkedinBoolean,
    },
  });
}

type ProjectionResult =
  | { status: "ok"; value: SourcingAgentWorkspace }
  | { status: "campaign_not_found" }
  | { status: "invalid_state"; issueCodes?: string[] };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const ISSUE_CODE = /^[A-Za-z0-9._-]{1,40}$/;

function zodIssueCodes(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.code)))]
    .filter((code) => ISSUE_CODE.test(code))
    .slice(0, 16);
}

function asBoundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function asStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (typeof value === "string") {
    return tokenizeMustHaveSkills(value).map((item) => item.slice(0, maxLength)).slice(0, maxItems);
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) {
    const parsed = Number(value);
    return parsed >= 0 ? parsed : null;
  }
  return null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function coerceJobAnalysis(raw: unknown): JobAnalysis | null {
  const job = record(raw);
  if (!job) return null;
  const title = asBoundedString(job.title, 200);
  const minYears = asNullableNumber(job.minYearsExperience);
  const seniorityRaw = typeof job.seniority === "string" ? job.seniority : "";
  const employmentRaw = typeof job.employmentType === "string" ? job.employmentType : "";
  const locationRaw = typeof job.locationType === "string" ? job.locationType : "";
  const urgencyRaw = typeof job.urgency === "string" ? job.urgency : "";
  const companyStages = Array.isArray(job.companyStageTarget)
    ? job.companyStageTarget.filter((stage): stage is (typeof COMPANY_STAGES)[number] =>
        typeof stage === "string" && (COMPANY_STAGES as readonly string[]).includes(stage),
      )
    : [];
  const warnings = Array.isArray(job.validationWarnings)
    ? job.validationWarnings.flatMap((item) => {
        const warning = record(item);
        if (!warning) return [];
        const field = asBoundedString(warning.field, 100);
        const message = asBoundedString(warning.message, 1_000);
        const severity = asEnum(warning.severity, ["info", "warning", "critical"] as const);
        if (!field || !message || !severity) return [];
        return [{ field, severity, message }];
      })
    : [];
  const coerced: JobAnalysis = {
    title,
    department: asBoundedString(job.department, 200),
    seniority: asEnum(job.seniority, SENIORITY_LEVELS) ?? seniorityFromVss(seniorityRaw, title, minYears),
    employmentType: asEnum(job.employmentType, EMPLOYMENT_TYPES) ?? employmentFromVss(employmentRaw, ""),
    locationType:
      asEnum(job.locationType, LOCATION_TYPES) ?? locationTypeFromRemote(locationRaw, title),
    regions: asStringList(job.regions, 50, 200),
    timezone: asBoundedString(job.timezone, 100),
    salaryMin: asNullableNumber(job.salaryMin),
    salaryMax: asNullableNumber(job.salaryMax),
    currency: asBoundedString(job.currency, 20),
    equity: job.equity === true,
    requiredSkills: asStringList(job.requiredSkills, 100, 100),
    niceToHaveSkills: asStringList(job.niceToHaveSkills, 100, 100),
    minYearsExperience: minYears,
    maxYearsExperience: asNullableNumber(job.maxYearsExperience),
    education: asBoundedString(job.education, 500),
    industryExperience: asStringList(job.industryExperience, 50, 100),
    companyStageTarget: companyStages.slice(0, 20),
    teamSize: asBoundedString(job.teamSize, 100),
    reportingTo: asBoundedString(job.reportingTo, 200),
    urgency: asEnum(job.urgency, URGENCY_LEVELS) ?? urgencyFromVssPriority(urgencyRaw),
    validationWarnings: warnings.slice(0, 100),
  };
  if (typeof job.location === "string") coerced.location = job.location.slice(0, 200);
  if (typeof job.language === "string") coerced.language = job.language.slice(0, 20);
  if (job.expectedStartDate === null || typeof job.expectedStartDate === "string") {
    coerced.expectedStartDate =
      typeof job.expectedStartDate === "string" ? job.expectedStartDate.slice(0, 100) : null;
  }
  return coerced;
}

function coerceScoringWeights(raw: unknown): Campaign["scoringWeights"] {
  const rec = record(raw) ?? {};
  const pick = (key: keyof typeof DEFAULT_SCORING_WEIGHTS) => {
    const value = asNullableNumber(rec[key]);
    return value != null && value <= 100 ? value : DEFAULT_SCORING_WEIGHTS[key];
  };
  const weights = {
    skills: pick("skills"),
    experience: pick("experience"),
    companyStage: pick("companyStage"),
    industry: pick("industry"),
    location: pick("location"),
    activity: pick("activity"),
  };
  return Object.values(weights).some((weight) => weight > 0) ? weights : { ...DEFAULT_SCORING_WEIGHTS };
}

function coerceGithubQueries(raw: unknown): Campaign["sourcingStrategy"]["githubQueries"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const query = record(item);
    if (!query) return [];
    const q = asBoundedString(query.query, 500).trim();
    if (!q) return [];
    return [{
      label: asBoundedString(query.label, 200) || q.slice(0, 200),
      query: q,
      estimatedResults: asNullableNumber(query.estimatedResults) ?? 0,
    }];
  }).slice(0, 100);
}

function coerceProjectedCampaign(raw: unknown): SourcingAgentCampaign | null {
  const campaign = record(raw);
  if (!campaign) return null;
  const id = asBoundedString(campaign.id, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) return null;
  const status = asEnum(campaign.status, CAMPAIGN_STATUSES);
  if (!status) return null;
  const jobAnalysis = coerceJobAnalysis(campaign.jobAnalysis);
  if (!jobAnalysis) return null;
  const strategy = record(campaign.sourcingStrategy) ?? {};
  return {
    id,
    status,
    jobAnalysis,
    scoringWeights: coerceScoringWeights(campaign.scoringWeights),
    sourcingStrategy: {
      excludedCompanies: asStringList(strategy.excludedCompanies, 500, 200),
      githubQueries: coerceGithubQueries(strategy.githubQueries),
      linkedinBoolean: asBoundedString(strategy.linkedinBoolean, 2_000),
    },
  };
}

export function projectSourcingAgentWorkspace(
  state: unknown,
  campaignId: string,
): ProjectionResult {
  const root = record(state);
  if (!root || !Array.isArray(root.campaigns)) {
    return { status: "campaign_not_found" };
  }
  const settings = record(root.settings);
  const providers = z.array(LlmProviderSchema).max(50).safeParse(settings?.llmProviders ?? []);
  const models = z.array(SavedModelSchema).max(100).safeParse(settings?.savedModels ?? []);
  const rawDefaults = record(settings?.defaultModels);
  const sourcingDefault = rawDefaults?.sourcing;
  const settingsOk =
    providers.success &&
    models.success &&
    (sourcingDefault === undefined || typeof sourcingDefault === "string");
  // People-first harvest does not need a valid cloud-model blob. A stale
  // settings row must not 503 before request_entry.
  const aiSettings: SourcingAiSettings = settingsOk
    ? {
        llmProviders: providers.data,
        savedModels: models.data,
        defaultModels:
          typeof sourcingDefault === "string" ? { sourcing: sourcingDefault } : {},
      }
    : { llmProviders: [], savedModels: [], defaultModels: {} };
  const rawCampaign = root.campaigns.find(
    (item) => record(item)?.id === campaignId,
  );
  if (!rawCampaign) return { status: "campaign_not_found" };
  const parsedCampaign = CampaignProjectionSchema.safeParse(rawCampaign);
  const coercedCampaign = parsedCampaign.success
    ? {
        id: parsedCampaign.data.id,
        status: parsedCampaign.data.status,
        jobAnalysis: parsedCampaign.data.jobAnalysis,
        scoringWeights: parsedCampaign.data.scoringWeights,
        sourcingStrategy: {
          excludedCompanies: [...parsedCampaign.data.sourcingStrategy.excludedCompanies],
          githubQueries: parsedCampaign.data.sourcingStrategy.githubQueries.map((query) => ({ ...query })),
          linkedinBoolean: parsedCampaign.data.sourcingStrategy.linkedinBoolean,
        },
      }
    : coerceProjectedCampaign(rawCampaign);
  if (!coercedCampaign) {
    return {
      status: "invalid_state",
      issueCodes: parsedCampaign.success ? undefined : zodIssueCodes(parsedCampaign.error),
    };
  }

  const existing: CandidateDedupeIdentity[] = [];
  const rawCandidates = (Array.isArray(root.candidates) ? root.candidates : []).filter(
    (item) => record(item)?.campaignId === campaignId,
  );
  if (rawCandidates.length > 5_000) {
    return { status: "invalid_state", issueCodes: ["too_big"] };
  }
  for (const item of rawCandidates) {
    const candidate = record(item);
    if (!candidate) continue;
    const parsed = DedupeIdentitySchema.safeParse({
      campaignId: candidate.campaignId,
      email: typeof candidate.email === "string" ? candidate.email : "",
      linkedinUrl: typeof candidate.linkedinUrl === "string" ? candidate.linkedinUrl : "",
      githubUrl: typeof candidate.githubUrl === "string" ? candidate.githubUrl : "",
      ...(typeof candidate.sourceUrl === "string" ? { sourceUrl: candidate.sourceUrl } : {}),
      lastContactedAt: candidate.lastContactedAt ?? null,
    });
    if (!parsed.success) continue;
    const { campaignId: _campaignId, ...identity } = parsed.data;
    existing.push(identity);
  }

  const campaign: SourcingAgentCampaign = coercedCampaign;
  return {
    status: "ok",
    value: {
      campaign,
      existing,
      aiSettings,
      configurationFingerprint: JSON.stringify(aiSettings),
      fingerprint: sourcingAgentCampaignFingerprint(campaign),
    },
  };
}

const MatchBreakdownSchema = z
  .object({
    key: z.enum(["skills", "experience", "companyStage", "industry", "location", "activity"]),
    label: bounded(100),
    score: z.number().finite().min(0).max(100),
    weight: z.number().finite().min(0).max(1),
    contribution: z.number().finite().min(0).max(100),
    rationale: bounded(1_000),
  })
  .strict();

export const SourcingAgentCandidateDtoSchema = z
  .object({
    id: bounded(100),
    campaignId: bounded(100),
    name: bounded(200).min(1),
    email: bounded(320).optional(),
    phone: bounded(40).optional(),
    currentTitle: bounded(200),
    currentCompany: bounded(200),
    location: bounded(200),
    linkedinUrl: bounded(2_048),
    githubUrl: bounded(2_048),
    sourceUrl: bounded(2_048).optional(),
    sourcePlatform: z.enum(["GitHub", "LinkedIn", "Apify", "Stack Overflow", "Dribbble", "Behance"]),
    sourceQuery: bounded(500),
    matchScore: z.number().finite().min(0).max(100),
    matchBreakdown: z.array(MatchBreakdownSchema).max(6),
    techStack: boundedArray(100, 100),
    recentActivity: bounded(1_000),
    createdAt: z.string().datetime(),
    draftSubject: bounded(255).min(1).optional(),
    draftBody: bounded(5_000).min(1).optional(),
  })
  .strict()
  .refine((candidate) => Boolean(candidate.draftSubject) === Boolean(candidate.draftBody));

export type SourcingAgentCandidateDto = z.infer<
  typeof SourcingAgentCandidateDtoSchema
>;

export const SourcingFeedbackReceiptDtoSchema = z
  .object({
    receiptId: z.string().uuid(),
    platform: z.enum(["GitHub", "LinkedIn", "Apify", "Stack Overflow", "Dribbble", "Behance"]),
    candidateCount: z.number().int().min(0).max(100),
    query: z.string().max(500).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict();

export type SourcingFeedbackReceiptDto = z.infer<
  typeof SourcingFeedbackReceiptDtoSchema
>;

const SourcingAgentSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    mode: z.enum(["cloud", "deterministic"]),
    campaignId: bounded(100),
    campaignFingerprint: bounded(100_000).min(1),
    candidates: z.array(SourcingAgentCandidateDtoSchema).max(8),
    totalFound: z.number().int().min(0).max(100_000),
    requestId: bounded(100).regex(/^[A-Za-z0-9._:-]{1,100}$/),
    idempotencyKey: z.string().uuid(),
    sourcingRunId: z.string().uuid(),
    agentFrameworkRunId: z.string().uuid().optional(),
    agentFrameworkResultSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    appliedLessonIds: z.array(z.string().uuid()).max(100),
    feedbackReceipts: z.array(SourcingFeedbackReceiptDtoSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (response) => Boolean(response.agentFrameworkRunId) === Boolean(response.agentFrameworkResultSha256),
    { message: "Framework run and staged result receipt must be supplied together." },
  );

export type SourcingAgentSuccessResponse = z.infer<
  typeof SourcingAgentSuccessResponseSchema
>;

function safeHttps(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeHost(value: string, allowed: readonly string[]): boolean {
  if (!value) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const SOURCE_HOSTS: Record<SourcingAgentCandidateDto["sourcePlatform"], readonly string[]> = {
  GitHub: ["github.com"],
  LinkedIn: ["linkedin.com"],
  Apify: ["linkedin.com"],
  "Stack Overflow": ["stackoverflow.com"],
  Dribbble: ["dribbble.com"],
  Behance: ["behance.net"],
};

export function parseSourcingAgentCandidates(
  value: unknown,
  campaignId: string,
  maxCount: number,
): SourcingAgentCandidateDto[] | null {
  if (!Array.isArray(value) || value.length > maxCount) return null;
  const parsed: SourcingAgentCandidateDto[] = [];
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const item of value) {
    const result = SourcingAgentCandidateDtoSchema.safeParse(item);
    if (!result.success || result.data.campaignId !== campaignId) return null;
    if (
      !safeHttps(result.data.linkedinUrl) ||
      !safeHttps(result.data.githubUrl) ||
      !safeHttps(result.data.sourceUrl ?? "") ||
      !safeHost(result.data.linkedinUrl, ["linkedin.com"]) ||
      !safeHost(result.data.githubUrl, ["github.com"]) ||
      !safeHost(
        result.data.sourceUrl ??
          (result.data.sourcePlatform === "GitHub"
            ? result.data.githubUrl
            : result.data.linkedinUrl),
        SOURCE_HOSTS[result.data.sourcePlatform],
      ) ||
      (result.data.sourcePlatform === "GitHub" && !result.data.githubUrl)
    ) {
      return null;
    }
    const identity = (
      result.data.linkedinUrl ||
      result.data.githubUrl ||
      result.data.sourceUrl ||
      result.data.id
    ).toLowerCase();
    if (ids.has(result.data.id) || identities.has(identity)) return null;
    ids.add(result.data.id);
    identities.add(identity);
    parsed.push(result.data);
  }
  return parsed;
}

export function parseSourcingAgentSuccessResponse(
  value: unknown,
  campaignId: string,
  maxCount: number,
  expectedAgentFrameworkRunId?: string,
): SourcingAgentSuccessResponse | null {
  const parsed = SourcingAgentSuccessResponseSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.campaignId !== campaignId ||
    parsed.data.agentFrameworkRunId !== expectedAgentFrameworkRunId
  ) return null;
  const candidates = parseSourcingAgentCandidates(
    parsed.data.candidates,
    campaignId,
    maxCount,
  );
  if (!candidates) return null;
  return { ...parsed.data, candidates };
}

export function candidateFromSourcingAgentDto(
  dto: SourcingAgentCandidateDto,
): Candidate {
  return {
    id: dto.id,
    campaignId: dto.campaignId,
    name: dto.name,
    email: dto.email ?? "",
    phone: dto.phone ?? "",
    avatarInitials: initialsFrom(dto.name),
    currentTitle: dto.currentTitle,
    currentCompany: dto.currentCompany,
    location: dto.location,
    timezone: "",
    linkedinUrl: dto.linkedinUrl,
    githubUrl: dto.githubUrl,
    ...(dto.sourceUrl ? { sourceUrl: dto.sourceUrl } : {}),
    sourcePlatform: dto.sourcePlatform,
    sourceQuery: dto.sourceQuery,
    matchScore: dto.matchScore,
    matchBreakdown: dto.matchBreakdown,
    techStack: [...dto.techStack],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: dto.recentActivity,
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: dto.createdAt,
    provenance: "live",
  };
}
