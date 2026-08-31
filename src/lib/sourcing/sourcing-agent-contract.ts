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
  SOURCE_PLATFORMS,
  type Campaign,
  type Candidate,
  type SystemSettings,
} from "@/lib/types";
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
  // Intentionally NOT .strict(): live workspace JobAnalysis may carry optional
  // enrichment fields (localeContext, missionDescription, linkedinBoolean, …).
  // Projection must strip unknowns and still authorize sourcing.

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
    primaryPlatforms: z.array(z.enum(SOURCE_PLATFORMS)).min(1).max(8).optional().default(["GitHub"]),
    linkedinBoolean: bounded(2_000).optional().default(""),
    githubQueries: z
      .array(
        z
          .object({
            label: bounded(200).optional(),
            query: bounded(500).min(1),
            estimatedResults: z.number().finite().nonnegative().optional(),
          })
          // Live queries may carry id/rationale; strip and normalize for the agent.
          .passthrough()
          .transform((query) => ({
            label:
              (typeof query.label === "string" && query.label.trim()) ||
              query.query.slice(0, 200),
            query: query.query,
            estimatedResults:
              typeof query.estimatedResults === "number" && Number.isFinite(query.estimatedResults)
                ? query.estimatedResults
                : 0,
          })),
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
  })
  .strict();

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
  })
  .strict();

type SourcingAiSettings = Pick<
  SystemSettings,
  "llmProviders" | "savedModels" | "defaultModels"
>;

export type SourcingAgentCampaign = CandidateMappingCampaign &
  Pick<Campaign, "status"> & {
    sourcingStrategy: Pick<
      Campaign["sourcingStrategy"],
      "excludedCompanies" | "githubQueries" | "primaryPlatforms" | "linkedinBoolean"
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
      primaryPlatforms: campaign.sourcingStrategy.primaryPlatforms,
      linkedinBoolean: campaign.sourcingStrategy.linkedinBoolean,
      githubQueries: campaign.sourcingStrategy.githubQueries,
    },
  });
}

type ProjectionResult =
  | { status: "ok"; value: SourcingAgentWorkspace }
  | { status: "campaign_not_found" | "invalid_state" };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function projectSourcingAgentWorkspace(
  state: unknown,
  campaignId: string,
): ProjectionResult {
  const root = record(state);
  if (!root || !Array.isArray(root.campaigns) || !Array.isArray(root.candidates)) {
    return { status: "invalid_state" };
  }
  const settings = record(root.settings);
  const providers = z.array(LlmProviderSchema).max(50).safeParse(settings?.llmProviders ?? []);
  const models = z.array(SavedModelSchema).max(100).safeParse(settings?.savedModels ?? []);
  const rawDefaults = record(settings?.defaultModels);
  const sourcingDefault = rawDefaults?.sourcing;
  if (
    !providers.success ||
    !models.success ||
    (sourcingDefault !== undefined && typeof sourcingDefault !== "string")
  ) {
    return { status: "invalid_state" };
  }
  const aiSettings: SourcingAiSettings = {
    llmProviders: providers.data,
    savedModels: models.data,
    defaultModels:
      typeof sourcingDefault === "string" ? { sourcing: sourcingDefault } : {},
  };
  const rawCampaign = root.campaigns.find(
    (item) => record(item)?.id === campaignId,
  );
  if (!rawCampaign) return { status: "campaign_not_found" };
  const parsedCampaign = CampaignProjectionSchema.safeParse(rawCampaign);
  if (!parsedCampaign.success) return { status: "invalid_state" };

  const existing: CandidateDedupeIdentity[] = [];
  const rawCandidates = root.candidates.filter(
    (item) => record(item)?.campaignId === campaignId,
  );
  if (rawCandidates.length > 5_000) return { status: "invalid_state" };
  for (const item of rawCandidates) {
    const candidate = record(item);
    if (!candidate) return { status: "invalid_state" };
    const parsed = DedupeIdentitySchema.safeParse({
      campaignId: candidate.campaignId,
      email: candidate.email,
      linkedinUrl: candidate.linkedinUrl,
      githubUrl: candidate.githubUrl,
      ...(candidate.sourceUrl === undefined ? {} : { sourceUrl: candidate.sourceUrl }),
      lastContactedAt: candidate.lastContactedAt,
    });
    if (!parsed.success) return { status: "invalid_state" };
    const { campaignId: _campaignId, ...identity } = parsed.data;
    existing.push(identity);
  }

  const projected = parsedCampaign.data;
  const campaign: SourcingAgentCampaign = {
    id: projected.id,
    status: projected.status,
    jobAnalysis: projected.jobAnalysis,
    scoringWeights: projected.scoringWeights,
    sourcingStrategy: {
      excludedCompanies: [...projected.sourcingStrategy.excludedCompanies],
      primaryPlatforms: [...projected.sourcingStrategy.primaryPlatforms],
      linkedinBoolean: projected.sourcingStrategy.linkedinBoolean,
      githubQueries: projected.sourcingStrategy.githubQueries.map((query) => ({ ...query })),
    },
  };
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
    currentTitle: bounded(200),
    currentCompany: bounded(200),
    location: bounded(200),
    linkedinUrl: bounded(2_048),
    githubUrl: bounded(2_048),
    sourceUrl: bounded(2_048).optional(),
    sourcePlatform: z.enum(["GitHub", "LinkedIn", "Stack Overflow", "Dribbble", "Behance"]),
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
    platform: z.enum(["GitHub", "LinkedIn", "Stack Overflow", "Dribbble", "Behance"]),
    candidateCount: z.number().int().min(0).max(100),
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
    email: "",
    phone: "",
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
