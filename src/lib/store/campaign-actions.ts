import {
  CAMPAIGN_STATUSES,
  COMPANY_STAGES,
  SENIORITY_LEVELS,
  URGENCY_LEVELS,
} from "../types";
import type { CampaignUpdate, HermesActions } from "./contracts";
import type {
  Activity,
  AgentSkill,
  Campaign,
  Candidate,
  HermesState,
  JobAnalysis,
  MatchBreakdownItem,
  ScoringWeights,
  ValidationWarning,
} from "../types";

export type CampaignActions = Pick<
  HermesActions,
  | "setActiveCampaign"
  | "createCampaignFromAnalysis"
  | "updateCampaign"
  | "regenerateQueries"
>;

export type ActivityDraft = Omit<Activity, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface CampaignActionDependencies {
  commit: (update: (state: HermesState) => HermesState) => boolean;
  buildCampaign: (
    jobAnalysis: JobAnalysis,
    meta: { hiringManager: string; hiringManagerEmail: string },
  ) => Campaign;
  makeActivity: (activity: ActivityDraft) => Activity;
  withActivity: (
    state: HermesState,
    activity: Activity,
    campaignId: string | null,
  ) => HermesState;
  recomputeMetrics: (state: HermesState, campaignId: string) => HermesState;
  effectiveWeights: (
    weights: ScoringWeights,
    skills: AgentSkill[],
  ) => ScoringWeights;
  scoreCandidate: (
    candidate: Candidate,
    jobAnalysis: JobAnalysis,
    weights: ScoringWeights,
  ) => { score: number; breakdown: MatchBreakdownItem[] };
  campaignMutationAllowed: () => boolean;
  currentState: () => HermesState | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCampaignStatus(value: unknown): value is Campaign["status"] {
  return (
    typeof value === "string" &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(value)
  );
}

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return (
    typeof value === "string" &&
    (values as readonly string[]).includes(value)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

const EMPLOYMENT_TYPES = ["Full-time", "Contract", "Part-time"] as const;
const LOCATION_TYPES = ["Remote", "Hybrid", "On-site"] as const;
const WARNING_SEVERITIES = ["info", "warning", "critical"] as const;

function sanitizeValidationWarnings(value: unknown): ValidationWarning[] | null {
  if (!Array.isArray(value)) return null;
  const warnings: ValidationWarning[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.field !== "string" ||
      !isOneOf(WARNING_SEVERITIES, item.severity) ||
      typeof item.message !== "string"
    ) {
      return null;
    }
    warnings.push({
      field: item.field,
      severity: item.severity,
      message: item.message,
    });
  }
  return warnings;
}

function sanitizeJobAnalysis(value: unknown): JobAnalysis | null {
  if (!isRecord(value)) return null;
  const validationWarnings = sanitizeValidationWarnings(
    value.validationWarnings,
  );
  if (
    typeof value.title !== "string" ||
    typeof value.department !== "string" ||
    !isOneOf(SENIORITY_LEVELS, value.seniority) ||
    !isOneOf(EMPLOYMENT_TYPES, value.employmentType) ||
    !isOneOf(LOCATION_TYPES, value.locationType) ||
    !isStringArray(value.regions) ||
    typeof value.timezone !== "string" ||
    !isFiniteNumberOrNull(value.salaryMin) ||
    !isFiniteNumberOrNull(value.salaryMax) ||
    typeof value.currency !== "string" ||
    typeof value.equity !== "boolean" ||
    !isStringArray(value.requiredSkills) ||
    !isStringArray(value.niceToHaveSkills) ||
    !isFiniteNumberOrNull(value.minYearsExperience) ||
    !isFiniteNumberOrNull(value.maxYearsExperience) ||
    typeof value.education !== "string" ||
    !isStringArray(value.industryExperience) ||
    !isStringArray(value.companyStageTarget) ||
    !value.companyStageTarget.every((stage) =>
      isOneOf(COMPANY_STAGES, stage),
    ) ||
    typeof value.teamSize !== "string" ||
    typeof value.reportingTo !== "string" ||
    !isOneOf(URGENCY_LEVELS, value.urgency) ||
    validationWarnings === null ||
    (value.location !== undefined && typeof value.location !== "string") ||
    (value.language !== undefined && typeof value.language !== "string") ||
    (value.expectedStartDate !== undefined &&
      value.expectedStartDate !== null &&
      typeof value.expectedStartDate !== "string")
  ) {
    return null;
  }

  const sanitized: JobAnalysis = {
    title: value.title,
    department: value.department,
    seniority: value.seniority,
    employmentType: value.employmentType,
    locationType: value.locationType,
    regions: [...value.regions],
    timezone: value.timezone,
    salaryMin: value.salaryMin,
    salaryMax: value.salaryMax,
    currency: value.currency,
    equity: value.equity,
    requiredSkills: [...value.requiredSkills],
    niceToHaveSkills: [...value.niceToHaveSkills],
    minYearsExperience: value.minYearsExperience,
    maxYearsExperience: value.maxYearsExperience,
    education: value.education,
    industryExperience: [...value.industryExperience],
    companyStageTarget: [...value.companyStageTarget],
    teamSize: value.teamSize,
    reportingTo: value.reportingTo,
    urgency: value.urgency,
    validationWarnings,
  };
  if (value.location !== undefined) sanitized.location = value.location;
  if (value.language !== undefined) sanitized.language = value.language;
  if (value.expectedStartDate !== undefined) {
    sanitized.expectedStartDate = value.expectedStartDate;
  }
  return sanitized;
}

const SCORING_WEIGHT_KEYS = [
  "skills",
  "experience",
  "companyStage",
  "industry",
  "location",
  "activity",
] as const satisfies readonly (keyof ScoringWeights)[];

function isScoringWeights(value: unknown): value is ScoringWeights {
  return (
    isRecord(value) &&
    Object.keys(value).length === SCORING_WEIGHT_KEYS.length &&
    Object.keys(value).every((key) =>
      (SCORING_WEIGHT_KEYS as readonly string[]).includes(key),
    ) &&
    SCORING_WEIGHT_KEYS.every((key) => {
      const weight = value[key];
      return (
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight >= 0 &&
        weight <= 100
      );
    }) &&
    SCORING_WEIGHT_KEYS.some((key) => (value[key] as number) > 0)
  );
}

function editableCampaignPatch(patch: CampaignUpdate): CampaignUpdate {
  const editable: CampaignUpdate = {};
  if (Object.hasOwn(patch, "status") && isCampaignStatus(patch.status)) {
    editable.status = patch.status;
  }
  if (
    Object.hasOwn(patch, "previousStatus") &&
    (patch.previousStatus === null || isCampaignStatus(patch.previousStatus))
  ) {
    editable.previousStatus = patch.previousStatus;
  }
  if (Object.hasOwn(patch, "jobAnalysis")) {
    const jobAnalysis = sanitizeJobAnalysis(patch.jobAnalysis);
    if (jobAnalysis) editable.jobAnalysis = jobAnalysis;
  }
  if (
    Object.hasOwn(patch, "scoringWeights") &&
    isScoringWeights(patch.scoringWeights)
  ) {
    editable.scoringWeights = patch.scoringWeights;
  }
  return editable;
}

export function createCampaignActions({
  commit,
  buildCampaign,
  makeActivity,
  withActivity,
  recomputeMetrics,
  effectiveWeights,
  scoreCandidate,
  campaignMutationAllowed,
  currentState,
}: CampaignActionDependencies): CampaignActions {
  const setActiveCampaign: CampaignActions["setActiveCampaign"] = (id) =>
    commit((state) => ({ ...state, activeCampaignId: id }));

  const createCampaignFromAnalysis: CampaignActions["createCampaignFromAnalysis"] = (
    jobAnalysis,
    meta,
  ) => {
    if (!campaignMutationAllowed()) return null;
    const campaign = buildCampaign(jobAnalysis, meta);
    const applied = commit((state) => {
      let next: HermesState = {
        ...state,
        campaigns: [campaign, ...state.campaigns],
        activeCampaignId: campaign.id,
      };
      next = withActivity(
        next,
        makeActivity({
          type: "campaign",
          title: "Campaign created",
          notes: `Created “${campaign.title}” from parsed intake.`,
          outcome: "Sourcing strategy generated",
          campaignId: campaign.id,
          linkedEntityType: "campaign",
          linkedEntityId: campaign.id,
        }),
        campaign.id,
      );
      return next;
    });
    return applied ? campaign : null;
  };

  const updateCampaign: CampaignActions["updateCampaign"] = (id, patch) => {
    const editablePatch = editableCampaignPatch(patch);
    if (
      !campaignMutationAllowed() ||
      Object.keys(editablePatch).length === 0 ||
      !currentState()?.campaigns.some((campaign) => campaign.id === id)
    ) {
      return false;
    }
    return commit((state) => {
      const existing = state.campaigns.find((campaign) => campaign.id === id);
      if (!existing) return state;

      const merged: Campaign = { ...existing, ...editablePatch };
      let next: HermesState = {
        ...state,
        campaigns: state.campaigns.map((campaign) =>
          campaign.id === id ? merged : campaign,
        ),
      };

      if (editablePatch.jobAnalysis || editablePatch.scoringWeights) {
        const weights = effectiveWeights(merged.scoringWeights, state.skills);
        const affected = next.candidates.filter(
          (candidate) => candidate.campaignId === id,
        );
        next = {
          ...next,
          candidates: next.candidates.map((candidate) => {
            if (candidate.campaignId !== id) return candidate;
            const { score, breakdown } = scoreCandidate(
              candidate,
              merged.jobAnalysis,
              weights,
            );
            return {
              ...candidate,
              matchScore: score,
              matchBreakdown: breakdown,
            };
          }),
        };
        next = recomputeMetrics(next, id);
        if (affected.length > 0) {
          next = withActivity(
            next,
            makeActivity({
              type: "score",
              title: "Candidates re-scored",
              notes: `${affected.length} candidate${affected.length === 1 ? "" : "s"} re-scored after the JD/weights update.`,
              outcome: "Priority queue updated",
              campaignId: id,
              linkedEntityType: "campaign",
              linkedEntityId: id,
            }),
            id,
          );
        }
      }

      if (editablePatch.status && editablePatch.status !== existing.status) {
        next = withActivity(
          next,
          makeActivity({
            type: "campaign",
            title: "Campaign status changed",
            notes: `${existing.status} to ${merged.status}.`,
            outcome: merged.status,
            campaignId: id,
            linkedEntityType: "campaign",
            linkedEntityId: id,
          }),
          id,
        );
      }

      return next;
    });
  };

  const regenerateQueries: CampaignActions["regenerateQueries"] = (id) => {
    if (
      !campaignMutationAllowed() ||
      !currentState()?.campaigns.some((campaign) => campaign.id === id)
    ) {
      return false;
    }
    return commit((state) => {
      const campaign = state.campaigns.find((item) => item.id === id);
      if (!campaign) return state;

      const extra = {
        label: `Adjacent: ${campaign.jobAnalysis.requiredSkills[1] ?? "stack"} maintainers`,
        query: `language:${(campaign.jobAnalysis.requiredSkills[1] ?? "go").replace(/\s+/g, "")} sort:updated location:${campaign.jobAnalysis.regions[0] ?? "EU"} forks:>5`,
        estimatedResults: 80 + Math.round((campaign.metrics.sourced + 1) * 3.5),
      };
      const next = {
        ...state,
        campaigns: state.campaigns.map((item) =>
          item.id === id
            ? {
                ...item,
                sourcingStrategy: {
                  ...item.sourcingStrategy,
                  githubQueries: [...item.sourcingStrategy.githubQueries, extra],
                },
              }
            : item,
        ),
      };
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: "Generated additional query",
          notes: extra.query,
          outcome: `~${extra.estimatedResults} estimated results`,
          campaignId: id,
          linkedEntityType: "campaign",
          linkedEntityId: id,
        }),
        id,
      );
    });
  };

  return {
    setActiveCampaign,
    createCampaignFromAnalysis,
    updateCampaign,
    regenerateQueries,
  };
}
