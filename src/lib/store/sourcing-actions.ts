import { redactEmail, redactSecrets } from "../log-redact";
import { sourceCandidates } from "../mock-ai";
import { dedupeCandidates } from "../rules";
import { roleProfile } from "../roles";
import { scoreCandidate } from "../scoring";
import { evaluateNeedReadiness } from "../needs/readiness";
import {
  mapApolloCandidates,
  mapGithubCandidates,
  mapWebSearchCandidates,
  type SourceResult,
} from "../sourcing/candidate-mappers";
import type { ApolloSearchProfile } from "../sourcing/apollo";
import {
  campaignAllowsLiveSourcing,
  campaignAllowsManualCandidateIntake,
} from "../sourcing/campaign-lifecycle";
import { GITHUB_USERNAME_RE, type GithubUser } from "../sourcing/github";
import {
  candidateFromSourcingAgentDto,
  sourcingAgentCampaignFingerprint,
} from "../sourcing/sourcing-agent-contract";
import {
  acknowledgeReviewedSourcing,
  requestReviewedSourcing,
} from "../sourcing/sourcing-agent-client";
import {
  ensureWebQueryScope,
  isWebSearchPlatform,
  type WebLead,
  type WebSearchPlatform,
} from "../sourcing/web-leads";
import {
  SOURCE_PLATFORMS,
  type Activity,
  type AgentSkill,
  type CampaignStatus,
  type Candidate,
  type CandidateLawfulBasis,
  type HermesState,
  type ScoringWeights,
  type SourcePlatform,
} from "../types";
import { genId, initialsFrom } from "../utils";
import { baseWebQuery } from "./sourcing-helpers";
import type {
  ApolloEnrichmentErrorCode,
  HermesActions,
  SourceNextBatchResult,
} from "./contracts";

export type SourcingActions = Pick<
  HermesActions,
  | "sourceNextBatch"
  | "addCandidateFromGithub"
  | "addCandidateManual"
  | "sourceFromApollo"
  | "prepareApolloEnrichment"
  | "enrichApolloCandidate"
>;

export type SourcingActivityDraft = Omit<Activity, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface SourcingActionDependencies {
  commit: (update: (state: HermesState) => HermesState) => boolean;
  commitPersisted: (update: (state: HermesState) => HermesState) => Promise<boolean>;
  currentState: () => HermesState | null;
  sourcingMutationAllowed: () => boolean;
  workspaceEffectAllowed: () => boolean;
  syntheticSourcingAllowed: () => boolean;
  candidatePersistenceAllowed: (
    provenance: NonNullable<Candidate["provenance"]>,
  ) => boolean;
  workspaceFetch: typeof fetch;
  makeActivity: (activity: SourcingActivityDraft) => Activity;
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
  emitSource: (event: {
    kind: "source";
    campaignId: string;
    count: number;
  }) => void;
}

const MAX_SOURCE_COUNT = 20;
const SYNTHETIC_PLATFORMS = new Set<SourcePlatform>(["Referral", "Talent Pool"]);
const DEDICATED_PLATFORMS = new Set<SourcePlatform>([
  "Sillage",
  "Apollo",
  "Seamless",
  "Manual",
]);
const WEB_HOSTS: Record<WebSearchPlatform, string> = {
  LinkedIn: "linkedin.com",
  "Stack Overflow": "stackoverflow.com",
  Dribbble: "dribbble.com",
  Behance: "behance.net",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.trim();
}

function optionalIsoDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 100) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? value : undefined;
}

function safeHttpsUrl(value: unknown, expectedHost: string): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      Boolean(url.username) ||
      Boolean(url.password) ||
      (hostname !== expectedHost && !hostname.endsWith(`.${expectedHost}`))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeGithubProfileUrl(value: unknown): string | null {
  const safe = safeHttpsUrl(value, "github.com");
  if (!safe) return null;
  return new URL(safe).hostname.toLowerCase() === "github.com" ? safe : null;
}

function sanitizeGithubUsers(value: unknown, requestedCount: number): GithubUser[] | null {
  if (!Array.isArray(value) || value.length > requestedCount || value.length > MAX_SOURCE_COUNT) {
    return null;
  }
  const users: GithubUser[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const login = optionalString(item.login, 100);
    const name = optionalString(item.name, 200);
    const email = optionalString(item.email, 320);
    const company = optionalString(item.company, 200);
    const location = optionalString(item.location, 200);
    const bio = optionalString(item.bio, 1_000);
    const blog = optionalString(item.blog, 2_048);
    const htmlUrl = safeGithubProfileUrl(item.htmlUrl);
    const createdAt = optionalIsoDate(item.createdAt);
    const topLanguage = optionalString(item.topLanguage, 100);
    if (
      !login ||
      !GITHUB_USERNAME_RE.test(login) ||
      name === undefined ||
      email === undefined ||
      (email !== null && !isValidEmail(email)) ||
      company === undefined ||
      location === undefined ||
      bio === undefined ||
      blog === undefined ||
      !htmlUrl ||
      typeof item.publicRepos !== "number" ||
      !Number.isSafeInteger(item.publicRepos) ||
      item.publicRepos < 0 ||
      typeof item.followers !== "number" ||
      !Number.isSafeInteger(item.followers) ||
      item.followers < 0 ||
      createdAt === undefined ||
      topLanguage === undefined
    ) {
      return null;
    }
    users.push({
      login,
      name,
      email,
      company,
      location,
      bio,
      blog,
      htmlUrl,
      publicRepos: item.publicRepos,
      followers: item.followers,
      createdAt,
      topLanguage,
    });
  }
  return users;
}

function isValidEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function normalizeGithubLogin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const login = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return GITHUB_USERNAME_RE.test(login) ? login : null;
}

function githubProfileMatchesLogin(urlValue: string, login: string): boolean {
  try {
    const url = new URL(urlValue);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length === 1 && segments[0].toLowerCase() === login.toLowerCase();
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string, allowLineBreaks = false): boolean {
  return allowLineBreaks
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    : /[\u0000-\u001f\u007f]/.test(value);
}

function optionalManualText(
  value: unknown,
  maxLength: number,
  allowLineBreaks = false,
): { ok: true; value: string } | { ok: false } {
  if (value === undefined) return { ok: true, value: "" };
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    hasControlCharacters(value, allowLineBreaks)
  ) {
    return { ok: false };
  }
  return { ok: true, value: value.trim() };
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    host === "::1" ||
    /^::ffff:/i.test(host) ||
    /^10\./.test(host) ||
    /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab][0-9a-f]:/i.test(host)
  );
}

function safeManualProfileUrl(value: string): string | null {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname ||
      isLocalHostname(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

interface ManualCandidateInput {
  name: string;
  title: string;
  skills: string[];
  profileUrl: string;
  email: string;
  location: string;
  notes: string;
  lawfulBasis: CandidateLawfulBasis;
}

function sanitizeManualCandidateInput(value: unknown): ManualCandidateInput | null {
  if (!isRecord(value)) return null;
  const name = optionalManualText(value.name, 200);
  const title = optionalManualText(value.title, 200);
  const location = optionalManualText(value.location, 200);
  const email = optionalManualText(value.email, 254);
  const profileUrl = optionalManualText(value.profileUrl, 2_048);
  const notes = optionalManualText(value.notes, 2_000, true);
  const lawfulBasis = value.lawfulBasis;
  if (
    !name.ok ||
    !name.value ||
    !title.ok ||
    !location.ok ||
    !email.ok ||
    !profileUrl.ok ||
    !notes.ok
  ) {
    return null;
  }
  if (lawfulBasis !== "consent" && lawfulBasis !== "legitimate_interest") {
    return null;
  }
  if (email.value && !isValidEmail(email.value)) return null;
  const canonicalProfileUrl = safeManualProfileUrl(profileUrl.value);
  if (canonicalProfileUrl === null) return null;
  if (value.skills !== undefined && !Array.isArray(value.skills)) return null;
  const rawSkills = value.skills ?? [];
  if (rawSkills.length > 30) return null;
  const skills: string[] = [];
  const seenSkills = new Set<string>();
  for (const skillValue of rawSkills) {
    const skill = optionalManualText(skillValue, 100);
    if (!skill.ok) return null;
    if (!skill.value) continue;
    const key = skill.value.toLowerCase();
    if (seenSkills.has(key)) continue;
    seenSkills.add(key);
    skills.push(skill.value);
  }
  return {
    name: name.value,
    title: title.value,
    skills,
    profileUrl: canonicalProfileUrl,
    email: email.value.toLowerCase(),
    location: location.value,
    notes: notes.value,
    lawfulBasis,
  };
}

function sanitizeWebLeads(
  value: unknown,
  platform: WebSearchPlatform,
  requestedCount: number,
): WebLead[] | null {
  if (!Array.isArray(value) || value.length > requestedCount || value.length > MAX_SOURCE_COUNT) {
    return null;
  }
  const leads: WebLead[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const name = optionalString(item.name, 200);
    const title = optionalString(item.title, 300);
    const company = optionalString(item.company, 200);
    const url = safeHttpsUrl(item.url, WEB_HOSTS[platform]);
    const snippet = optionalString(item.snippet, 1_000);
    if (
      !name ||
      typeof title !== "string" ||
      typeof company !== "string" ||
      !url ||
      typeof snippet !== "string"
    ) {
      return null;
    }
    leads.push({ name, title, company, url, snippet });
  }
  return leads;
}

function safeError(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return redactSecrets(redactEmail(value.trim())).slice(0, 300);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APOLLO_ENRICHMENT_ERROR_CODES = new Set<ApolloEnrichmentErrorCode>([
  "APOLLO_TARGET_NOT_FOUND",
  "APOLLO_ENRICHMENT_IN_PROGRESS",
  "APOLLO_RECONCILIATION_REQUIRED",
  "APOLLO_CONFIRMATION_INVALID",
  "APOLLO_IDEMPOTENCY_CONFLICT",
  "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION",
  "APOLLO_QUOTA_EXCEEDED",
  "APOLLO_NOT_CONFIGURED",
  "APOLLO_AUTHORITY_UNAVAILABLE",
  "APOLLO_RECEIPT_UNAVAILABLE",
  "APOLLO_OUTCOME_UNKNOWN",
]);

function apolloEnrichmentErrorCode(value: unknown): ApolloEnrichmentErrorCode | undefined {
  return typeof value === "string" &&
    APOLLO_ENRICHMENT_ERROR_CODES.has(value as ApolloEnrichmentErrorCode)
    ? (value as ApolloEnrichmentErrorCode)
    : undefined;
}

const APOLLO_PROFILE_KEYS = new Set([
  "targetId",
  "candidateId",
  "name",
  "title",
  "company",
  "linkedinUrl",
  "city",
  "state",
  "country",
  "headline",
  "seniority",
  "departments",
]);
const APOLLO_SEARCH_KEYS = new Set([
  "titles",
  "seniorities",
  "locations",
  "organizationDomains",
  "keywords",
  "count",
]);
const APOLLO_SUCCESS_KEYS = new Set(["ok", "source", "profiles"]);
const APOLLO_SELECTION_KEYS = new Set(["ok", "selected"]);
const APOLLO_SELECTION_BINDING_KEYS = new Set(["targetId", "candidateId"]);
const APOLLO_NOT_CONFIGURED_KEYS = new Set([
  "ok",
  "source",
  "profiles",
  "code",
  "error",
]);

type ApolloSearchRequest = {
  titles?: string[];
  seniorities?: string[];
  locations?: string[];
  organizationDomains?: string[];
  keywords?: string;
  count: number;
};

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(
  value: unknown,
  maxLength: number,
  allowEmpty: boolean,
): string | null {
  if (typeof value !== "string" || value.length > maxLength || hasControlCharacters(value)) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || allowEmpty ? trimmed : null;
}

function boundedTextArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = boundedText(item, maxLength, false);
    if (text === null) return null;
    result.push(text);
  }
  return result;
}

function sanitizeApolloSearchRequest(value: unknown): ApolloSearchRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, APOLLO_SEARCH_KEYS)) return null;
  const titles = boundedTextArray(value.titles, 20, 120);
  const seniorities = boundedTextArray(value.seniorities, 10, 60);
  const locations = boundedTextArray(value.locations, 20, 120);
  const organizationDomains = boundedTextArray(value.organizationDomains, 20, 200);
  if (
    titles === null ||
    seniorities === null ||
    locations === null ||
    organizationDomains === null
  ) {
    return null;
  }
  let keywords: string | undefined;
  if (value.keywords !== undefined) {
    const parsed = boundedText(value.keywords, 300, true);
    if (parsed === null) return null;
    keywords = parsed || undefined;
  }
  const count = value.count ?? 10;
  if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 50) {
    return null;
  }
  return {
    ...(titles !== undefined ? { titles } : {}),
    ...(seniorities !== undefined ? { seniorities } : {}),
    ...(locations !== undefined ? { locations } : {}),
    ...(organizationDomains !== undefined ? { organizationDomains } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    count: count as number,
  };
}

function safeApolloLinkedinUrl(value: unknown): string | null {
  const text = boundedText(value, 500, true);
  if (text === null || text === "") return text;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      Boolean(url.username) ||
      Boolean(url.password) ||
      Boolean(url.port) ||
      (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) ||
      !url.pathname.startsWith("/in/")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeApolloProfiles(value: unknown, requestedCount: number): ApolloSearchProfile[] | null {
  if (!Array.isArray(value) || value.length > requestedCount || value.length > 50) return null;
  const profiles: ApolloSearchProfile[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, APOLLO_PROFILE_KEYS)) return null;
    const targetId = boundedText(item.targetId, 36, false);
    const candidateId = boundedText(item.candidateId, 36, false);
    const name = boundedText(item.name, 200, false);
    const title = boundedText(item.title, 200, true);
    const company = boundedText(item.company, 200, true);
    const linkedinUrl = safeApolloLinkedinUrl(item.linkedinUrl);
    const city = boundedText(item.city, 120, true);
    const state = boundedText(item.state, 120, true);
    const country = boundedText(item.country, 120, true);
    const headline = boundedText(item.headline, 500, true);
    const seniority = boundedText(item.seniority, 80, true);
    const departments = boundedTextArray(item.departments, 20, 120);
    if (
      !targetId ||
      !UUID_RE.test(targetId) ||
      !candidateId ||
      !UUID_RE.test(candidateId) ||
      !name ||
      title === null ||
      company === null ||
      linkedinUrl === null ||
      city === null ||
      state === null ||
      country === null ||
      headline === null ||
      seniority === null ||
      !departments
    ) {
      return null;
    }
    profiles.push({
      targetId,
      candidateId,
      name,
      title,
      company,
      linkedinUrl,
      city,
      state,
      country,
      headline,
      seniority,
      departments,
    });
  }
  return profiles;
}

function apolloQueryLabel(filters: ApolloSearchRequest): string {
  return (
    [
      filters.titles?.length ? `titles:${filters.titles.join("|")}` : null,
      filters.seniorities?.length ? `seniority:${filters.seniorities.join("|")}` : null,
      filters.locations?.length ? `loc:${filters.locations.join("|")}` : null,
      filters.organizationDomains?.length
        ? `domains:${filters.organizationDomains.join("|")}`
        : null,
      filters.keywords ? `kw:${filters.keywords}` : null,
    ]
      .filter(Boolean)
      .join(" ") || "Apollo search"
  );
}

function mapApolloBatch(
  profiles: ApolloSearchProfile[],
  campaign: HermesState["campaigns"][number],
  query: string,
  existing: Candidate[],
  weights: ScoringWeights,
): SourceResult {
  const knownTargets = new Set(
    existing
      .map((candidate) => candidate.sourceAuthorityId)
      .filter((target): target is string => Boolean(target)),
  );
  const uniqueProfiles: ApolloSearchProfile[] = [];
  const skipped: SourceResult["skipped"] = [];
  for (const profile of profiles) {
    if (knownTargets.has(profile.targetId)) {
      skipped.push({ name: profile.name, reason: "Duplicate Apollo target" });
      continue;
    }
    knownTargets.add(profile.targetId);
    uniqueProfiles.push(profile);
  }
  const mapped = mapApolloCandidates(uniqueProfiles, campaign, query, existing, weights);
  return { accepted: mapped.accepted, skipped: [...skipped, ...mapped.skipped] };
}

function githubLocationQualifier(location: string | undefined, query: string): string {
  if (!location?.trim() || /(?:^|\s)location:/i.test(query)) return "";
  const city = location.split(",")[0]?.trim().replace(/["\\]/g, "");
  return city ? ` location:"${city}"` : "";
}

function isSourcePlatform(value: unknown): value is SourcePlatform {
  return (
    typeof value === "string" &&
    (SOURCE_PLATFORMS as readonly string[]).includes(value)
  );
}

function invalidRequest(error: string) {
  return { ok: false as const, error, source: "invalid" as const };
}

function liveSourcingUnavailable(status: CampaignStatus): string {
  return status === "Paused"
    ? "Campaign is paused."
    : "Campaign is not active for sourcing.";
}

function manualIntakeUnavailable(status: CampaignStatus): string {
  return status === "Paused"
    ? "Campaign is paused."
    : "Campaign is already filled.";
}

export function createSourcingActions({
  commitPersisted,
  currentState,
  sourcingMutationAllowed,
  workspaceEffectAllowed,
  syntheticSourcingAllowed,
  candidatePersistenceAllowed,
  workspaceFetch,
  makeActivity,
  withActivity,
  recomputeMetrics,
  effectiveWeights,
  emitSource,
}: SourcingActionDependencies): SourcingActions {
  const sourceReviewedCampaignBatch = async (
    campaignId: string,
    count: number,
    initialFingerprint: string,
    agentFramework?: { runId: string; capabilityToken: string; query: string },
  ): Promise<SourceNextBatchResult> => {
    const reviewed = await requestReviewedSourcing(
      workspaceFetch,
      campaignId,
      count,
      agentFramework,
    );
    if (!reviewed.ok) {
      return { ok: false, error: reviewed.error, source: "unavailable" };
    }
    if (!workspaceEffectAllowed()) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before saving sourced candidates.",
        source: "unavailable",
      };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
        source: "forbidden",
      };
    }
    const latest = currentState();
    const latestCampaign = latest?.campaigns.find((item) => item.id === campaignId);
    if (
      !latest ||
      !latestCampaign ||
      !campaignAllowsLiveSourcing(latestCampaign.status) ||
      !evaluateNeedReadiness(latestCampaign.jobAnalysis).ready ||
      reviewed.value.campaignFingerprint !== initialFingerprint ||
      sourcingAgentCampaignFingerprint(latestCampaign) !== initialFingerprint
    ) {
      return invalidRequest(
        "Campaign authority changed during sourcing. Review the current brief and retry.",
      );
    }

    const observedPlatforms = [
      ...reviewed.value.feedbackReceipts.map((receipt) => receipt.platform),
      ...reviewed.value.candidates.map((candidate) => candidate.sourcePlatform),
    ];
    const source = observedPlatforms.every((platform) => platform === "GitHub")
      ? "github" as const
      : "web" as const;
    let authorized = false;
    let result: SourceResult = { accepted: [], skipped: [] };
    const applied = await commitPersisted((previous) => {
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return previous;
      const campaign = previous.campaigns.find((item) => item.id === campaignId);
      if (
        !campaign ||
        !campaignAllowsLiveSourcing(campaign.status) ||
        !evaluateNeedReadiness(campaign.jobAnalysis).ready ||
        sourcingAgentCampaignFingerprint(campaign) !== reviewed.value.campaignFingerprint
      ) {
        return previous;
      }
      authorized = true;
      const weights = effectiveWeights(campaign.scoringWeights, previous.skills);
      const scored = reviewed.value.candidates.map((dto) => {
        const candidate = candidateFromSourcingAgentDto(dto);
        const score = scoreCandidate(candidate, campaign.jobAnalysis, weights);
        return {
          ...candidate,
          matchScore: score.score,
          matchBreakdown: score.breakdown,
        };
      });
      result = dedupeCandidates(scored, previous.candidates, {
        excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
      });
      let next: HermesState = {
        ...previous,
        candidates: [...result.accepted, ...previous.candidates],
      };
      if (result.accepted.length > 0) next = recomputeMetrics(next, campaignId);
      const executionLabel =
        reviewed.value.mode === "cloud"
          ? "Reviewed cloud tool-calling"
          : "Reviewed deterministic GitHub";
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: `Sourced ${result.accepted.length} candidates`,
          notes: `${executionLabel} batch. ${result.skipped.length} skipped by dedupe and exclusions.`,
          outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped (live)`,
          campaignId,
          linkedEntityType: "campaign",
          linkedEntityId: campaignId,
        }),
        campaignId,
      );
    });
    if (!applied || !authorized) {
      return {
        ok: false,
        error: "Workspace changed before the sourced candidates could be saved. Retry sourcing.",
        source: "unavailable",
      };
    }
    if (agentFramework) {
      const resultSha256 = reviewed.value.agentFrameworkResultSha256;
      if (!resultSha256 || !await acknowledgeReviewedSourcing(
        workspaceFetch,
        agentFramework,
        resultSha256,
      )) {
        return {
          ok: false,
          error: "Candidates were saved, but the framework persistence receipt could not be confirmed. Retry this run to reconcile it.",
          source: "unavailable",
          retryable: "agent_framework_reconcile",
        };
      }
    }
    if (result.accepted.length > 0) {
      emitSource({ kind: "source", campaignId, count: result.accepted.length });
    }
    return {
      ...result,
      source,
      ok: true,
      mode: reviewed.value.mode,
      feedbackReceipts: reviewed.value.feedbackReceipts,
    };
  };

  const sourceNextBatch: SourcingActions["sourceNextBatch"] = async (
    campaignId,
    opts,
  ) => {
    if (!workspaceEffectAllowed()) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before sourcing.",
        source: "unavailable",
      };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
        source: "forbidden",
      };
    }

    const initialState = currentState();
    if (!initialState) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before sourcing.",
        source: "unavailable",
      };
    }
    const initialCampaign = initialState.campaigns.find(
      (campaign) => campaign.id === campaignId,
    );
    if (!initialCampaign) {
      return {
        ok: false,
        error: "Campaign not found.",
        source: "not_found",
      };
    }
    if (!campaignAllowsLiveSourcing(initialCampaign.status)) {
      if (initialCampaign.status !== "Paused") {
        return invalidRequest(liveSourcingUnavailable(initialCampaign.status));
      }
      return { ok: false, error: "Campaign is paused.", source: "paused" };
    }
    if (!evaluateNeedReadiness(initialCampaign.jobAnalysis).ready) {
      return invalidRequest("Complete and review the campaign brief before sourcing.");
    }
    const initialFingerprint = sourcingAgentCampaignFingerprint(initialCampaign);

    const demoSourcing = syntheticSourcingAllowed();
    const requestedPlatform = opts?.platform ?? (
      demoSourcing && !candidatePersistenceAllowed("live")
        ? "Talent Pool"
        : roleProfile(initialCampaign.jobAnalysis).platforms[0]
    );
    if (!isSourcePlatform(requestedPlatform)) {
      return invalidRequest("Unsupported sourcing platform.");
    }
    const count = opts?.count ?? 6;
    const maxCount = demoSourcing ? MAX_SOURCE_COUNT : 8;
    if (!Number.isInteger(count) || count < 1 || count > maxCount) {
      return invalidRequest(
        `Source count must be an integer between 1 and ${maxCount}.`,
      );
    }
    if (DEDICATED_PLATFORMS.has(requestedPlatform)) {
      return invalidRequest(
        `${requestedPlatform} sourcing must use its dedicated provider action.`,
      );
    }
    if (!SYNTHETIC_PLATFORMS.has(requestedPlatform) && !candidatePersistenceAllowed("live")) {
      return invalidRequest(
        "Real candidate sourcing requires a live workspace. This browser-local demo can persist only synthetic candidates.",
      );
    }
    if (
      SYNTHETIC_PLATFORMS.has(requestedPlatform) &&
      !demoSourcing
    ) {
      return invalidRequest(
        `${requestedPlatform} simulation is available only in demo environments.`,
      );
    }

    if (!demoSourcing) {
      return await sourceReviewedCampaignBatch(
        campaignId,
        count,
        initialFingerprint,
        opts?.agentFramework,
      );
    }

    let source: "github" | "web" | "mock" = "mock";
    let rawGithubUsers: GithubUser[] | null = null;
    let rawWebLeads: WebLead[] | null = null;
    let query = "";

    if (requestedPlatform === "GitHub") {
      const baseQuery = initialCampaign.sourcingStrategy.githubQueries[0]?.query.trim() ?? "";
      if (!baseQuery) {
        return invalidRequest("Add and review a GitHub sourcing query before sourcing.");
      }
      query = `${baseQuery}${githubLocationQualifier(initialCampaign.jobAnalysis.location, baseQuery)}`;
      try {
        const response = await workspaceFetch("/api/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, count, platform: requestedPlatform }),
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (!isRecord(body) || !response.ok || body.ok !== true || body.source !== "github") {
          return {
            ok: false,
            error: safeError(isRecord(body) ? body.error : null, "GitHub sourcing failed."),
            source: "github",
          };
        }
        rawGithubUsers = sanitizeGithubUsers(body.users, count);
        if (!rawGithubUsers) {
          return {
            ok: false,
            error: "GitHub sourcing returned an invalid response.",
            source: "github",
          };
        }
        source = "github";
      } catch (error) {
        return {
          ok: false,
          error: safeError(
            error instanceof Error ? error.message : null,
            "Network error reaching GitHub sourcing.",
          ),
          source: "github",
        };
      }
    } else if (isWebSearchPlatform(requestedPlatform)) {
      query = ensureWebQueryScope(
        requestedPlatform,
        baseWebQuery(initialCampaign, requestedPlatform),
      );
      try {
        const response = await workspaceFetch("/api/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, count, platform: requestedPlatform }),
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (!isRecord(body) || !response.ok || body.ok !== true || body.source !== "web") {
          return {
            ok: false,
            error: safeError(isRecord(body) ? body.error : null, "Web sourcing failed."),
            source: "web",
          };
        }
        rawWebLeads = sanitizeWebLeads(body.leads, requestedPlatform, count);
        if (!rawWebLeads) {
          return {
            ok: false,
            error: "Web sourcing returned an invalid response.",
            source: "web",
          };
        }
        source = "web";
      } catch (error) {
        return {
          ok: false,
          error: safeError(
            error instanceof Error ? error.message : null,
            "Network error reaching web sourcing.",
          ),
          source: "web",
        };
      }
    }

    if (!workspaceEffectAllowed()) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before saving sourced candidates.",
        source: "unavailable",
      };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
        source: "forbidden",
      };
    }
    const latestState = currentState();
    if (!latestState) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before saving sourced candidates.",
        source: "unavailable",
      };
    }
    const campaign = latestState.campaigns.find((item) => item.id === campaignId);
    if (!campaign) {
      return { ok: false, error: "Campaign not found.", source: "not_found" };
    }
    if (!campaignAllowsLiveSourcing(campaign.status)) {
      if (campaign.status !== "Paused") {
        return invalidRequest(liveSourcingUnavailable(campaign.status));
      }
      return { ok: false, error: "Campaign is paused.", source: "paused" };
    }
    if (
      !evaluateNeedReadiness(campaign.jobAnalysis).ready ||
      sourcingAgentCampaignFingerprint(campaign) !== initialFingerprint
    ) {
      return invalidRequest("Campaign authority changed during sourcing. Review the current brief and retry.");
    }
    if (SYNTHETIC_PLATFORMS.has(requestedPlatform) && !syntheticSourcingAllowed()) {
      return invalidRequest(
        `${requestedPlatform} simulation is available only in demo environments.`,
      );
    }

    const weights = effectiveWeights(campaign.scoringWeights, latestState.skills);
    let result: SourceResult;
    if (source === "github") {
      result = mapGithubCandidates(
        rawGithubUsers ?? [],
        campaign,
        query,
        latestState.candidates,
        weights,
      );
    } else if (source === "web" && isWebSearchPlatform(requestedPlatform)) {
      result = mapWebSearchCandidates(
        rawWebLeads ?? [],
        campaign,
        query,
        requestedPlatform,
        latestState.candidates,
        weights,
      );
    } else {
      result = sourceCandidates(
        campaign,
        requestedPlatform,
        count,
        latestState.candidates,
        latestState.candidates.length,
        weights,
      );
    }

    let authorized = false;
    const applied = await commitPersisted((previous) => {
      const currentCampaign = previous.campaigns.find((item) => item.id === campaignId);
      if (
        !currentCampaign ||
        !campaignAllowsLiveSourcing(currentCampaign.status) ||
        !evaluateNeedReadiness(currentCampaign.jobAnalysis).ready ||
        sourcingAgentCampaignFingerprint(currentCampaign) !== initialFingerprint
      ) {
        return previous;
      }
      authorized = true;
      let next: HermesState = {
        ...previous,
        candidates: [...result.accepted, ...previous.candidates],
      };
      if (result.accepted.length > 0) {
        next = recomputeMetrics(next, campaignId);
      }
      const liveLabel =
        source === "github"
          ? "Live GitHub"
          : source === "web"
            ? `Live ${requestedPlatform} search`
            : `${requestedPlatform} synthetic`;
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: `Sourced ${result.accepted.length} candidates`,
          notes: `${liveLabel} batch. ${result.skipped.length} skipped by dedupe (${result.skipped
            .slice(0, 3)
            .map((item) => item.reason)
            .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
          outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped${source !== "mock" ? " (live)" : ""}`,
          campaignId,
          linkedEntityType: "campaign",
          linkedEntityId: campaignId,
        }),
        campaignId,
      );
    });
    if (!applied || !authorized) {
      return {
        ok: false,
        error: "Workspace changed before the sourced candidates could be saved. Retry sourcing.",
        source: "unavailable",
      };
    }

    if (result.accepted.length > 0) {
      emitSource({ kind: "source", campaignId, count: result.accepted.length });
    }
    return { ...result, source, ok: true };
  };

  const addCandidateFromGithub: SourcingActions["addCandidateFromGithub"] = async (
    campaignId,
    username,
  ) => {
    if (!candidatePersistenceAllowed("live")) {
      return { ok: false, error: "GitHub candidate intake requires a live workspace." };
    }
    if (!workspaceEffectAllowed()) {
      return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
      };
    }
    const initialState = currentState();
    if (!initialState) {
      return { ok: false, error: "Workspace unavailable. Retry before sourcing." };
    }
    const initialCampaign = initialState.campaigns.find(
      (campaign) => campaign.id === campaignId,
    );
    if (!initialCampaign) return { ok: false, error: "Campaign not found." };
    if (!campaignAllowsLiveSourcing(initialCampaign.status)) {
      return { ok: false, error: liveSourcingUnavailable(initialCampaign.status) };
    }
    const login = normalizeGithubLogin(username);
    if (!login) return { ok: false, error: "Enter a valid GitHub username." };

    let user: GithubUser;
    try {
      const response = await workspaceFetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: login, platform: "GitHub", count: 1 }),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!isRecord(body) || !response.ok || body.ok !== true || body.source !== "github") {
        return {
          ok: false,
          error: safeError(isRecord(body) ? body.error : null, "GitHub lookup failed."),
        };
      }
      const users = sanitizeGithubUsers(body.users, 1);
      if (
        !users ||
        users.length !== 1 ||
        users[0].login.toLowerCase() !== login.toLowerCase() ||
        !githubProfileMatchesLogin(users[0].htmlUrl, users[0].login) ||
        (users[0].email !== null && !isValidEmail(users[0].email))
      ) {
        return { ok: false, error: "GitHub lookup returned an invalid profile." };
      }
      user = users[0];
    } catch (error) {
      return {
        ok: false,
        error: safeError(
          error instanceof Error ? error.message : null,
          "Network error reaching GitHub.",
        ),
      };
    }

    if (!workspaceEffectAllowed()) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before saving the GitHub profile.",
      };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
      };
    }
    const latestState = currentState();
    if (!latestState) {
      return {
        ok: false,
        error: "Workspace unavailable. Retry before saving the GitHub profile.",
      };
    }
    const campaign = latestState.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return { ok: false, error: "Campaign not found." };
    if (!campaignAllowsLiveSourcing(campaign.status)) {
      return { ok: false, error: liveSourcingUnavailable(campaign.status) };
    }

    const weights = effectiveWeights(campaign.scoringWeights, latestState.skills);
    const { accepted, skipped } = mapGithubCandidates(
      [user],
      campaign,
      `@${user.login}`,
      latestState.candidates,
      weights,
    );
    let authorized = false;
    const applied = await commitPersisted((previous) => {
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return previous;
      const currentCampaign = previous.campaigns.find((item) => item.id === campaignId);
      if (!currentCampaign || !campaignAllowsLiveSourcing(currentCampaign.status)) {
        return previous;
      }
      authorized = true;
      let next: HermesState = {
        ...previous,
        candidates: [...accepted, ...previous.candidates],
      };
      if (accepted.length > 0) next = recomputeMetrics(next, campaignId);
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: accepted.length
            ? `Added @${user.login} from GitHub`
            : `@${user.login} was not added`,
          notes: accepted.length
            ? "Added a specific, validated GitHub profile."
            : `Skipped by dedupe (${skipped[0]?.reason ?? "duplicate"}).`,
          outcome: accepted.length ? "1 accepted" : "0 accepted, 1 skipped",
          campaignId,
          linkedEntityType: "campaign",
          linkedEntityId: campaignId,
        }),
        campaignId,
      );
    });
    if (!applied || !authorized) {
      return {
        ok: false,
        error: "Workspace changed before the GitHub profile could be saved. Retry.",
      };
    }
    if (accepted.length > 0) {
      emitSource({ kind: "source", campaignId, count: accepted.length });
    }
    return {
      ok: true,
      added: accepted.length,
      skipped: skipped.length,
      ...(skipped[0]?.reason ? { skipReason: skipped[0].reason } : {}),
    };
  };

  const addCandidateManual: SourcingActions["addCandidateManual"] = async (
    campaignId,
    input,
  ) => {
    if (!candidatePersistenceAllowed("manual")) {
      return { ok: false, error: "Manual candidate intake requires a live workspace." };
    }
    if (!workspaceEffectAllowed()) {
      return { ok: false, error: "Workspace unavailable. Retry before adding a candidate." };
    }
    if (!sourcingMutationAllowed()) {
      return {
        ok: false,
        error: "You do not have permission to source candidates in this workspace.",
      };
    }
    const state = currentState();
    if (!state) {
      return { ok: false, error: "Workspace unavailable. Retry before adding a candidate." };
    }
    const campaign = state.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return { ok: false, error: "Campaign not found." };
    if (!campaignAllowsManualCandidateIntake(campaign.status)) {
      return { ok: false, error: manualIntakeUnavailable(campaign.status) };
    }
    const fields = sanitizeManualCandidateInput(input);
    if (!fields) return { ok: false, error: "Candidate details are invalid." };

    const now = new Date().toISOString();
    const raw: Candidate = {
      id: genId("cand"),
      campaignId,
      name: fields.name,
      email: fields.email,
      avatarInitials: initialsFrom(fields.name),
      currentTitle: fields.title,
      currentCompany: "",
      location: fields.location,
      timezone: "",
      linkedinUrl: "",
      githubUrl: "",
      sourceUrl: fields.profileUrl || undefined,
      sourcePlatform: "Manual",
      sourceQuery: "Operator-entered candidate",
      matchScore: 0,
      matchBreakdown: [],
      techStack: fields.skills,
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity: "Manually added; no activity signal provided.",
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
      createdAt: now,
      provenance: "manual",
      leadSource: "Outbound",
      lawfulBasis: fields.lawfulBasis,
      lawfulBasisRecordedAt: now,
      lawfulBasisSource: "operator_selection",
      notes: fields.notes
        ? [{ id: genId("note"), text: fields.notes, at: now }]
        : undefined,
    };
    const { accepted, skipped } = dedupeCandidates([raw], state.candidates, {
      excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
    });
    const weights = effectiveWeights(campaign.scoringWeights, state.skills);
    const scored = accepted.map((candidate) => {
      const { score, breakdown } = scoreCandidate(
        candidate,
        campaign.jobAnalysis,
        weights,
      );
      return { ...candidate, matchScore: score, matchBreakdown: breakdown };
    });
    let authorized = false;
    const applied = await commitPersisted((previous) => {
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return previous;
      const currentCampaign = previous.campaigns.find((item) => item.id === campaignId);
      if (!currentCampaign || !campaignAllowsManualCandidateIntake(currentCampaign.status)) {
        return previous;
      }
      authorized = true;
      let next: HermesState = {
        ...previous,
        candidates: [...scored, ...previous.candidates],
      };
      if (scored.length > 0) next = recomputeMetrics(next, campaignId);
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: scored.length
            ? `Added ${fields.name} manually`
            : `${fields.name} was not added`,
          notes: scored.length
            ? "Operator-entered candidate; no external search involved."
            : `Skipped by dedupe (${skipped[0]?.reason ?? "duplicate"}).`,
          outcome: scored.length ? "1 accepted" : "0 accepted, 1 skipped",
          campaignId,
          linkedEntityType: "campaign",
          linkedEntityId: campaignId,
        }),
        campaignId,
      );
    });
    if (!applied || !authorized) {
      return {
        ok: false,
        error: "Workspace changed before the candidate could be saved. Retry.",
      };
    }
    if (scored.length > 0) {
      emitSource({ kind: "source", campaignId, count: scored.length });
    }
    return {
      ok: true,
      added: scored.length,
      skipped: skipped.length,
      ...(skipped[0]?.reason ? { skipReason: skipped[0].reason } : {}),
    };
  };

  const sourceFromApollo: SourcingActions["sourceFromApollo"] = async (
    campaignId,
    filters,
  ) => {
    const fail = (error: string) => ({
      accepted: [],
      skipped: [],
      source: "error" as const,
      error,
    });
    if (!candidatePersistenceAllowed("live")) {
      return fail("Apollo candidate sourcing requires a live workspace.");
    }
    if (!workspaceEffectAllowed()) {
      return fail("Workspace unavailable. Retry before sourcing.");
    }
    if (!sourcingMutationAllowed()) {
      return fail("You do not have permission to source candidates in this workspace.");
    }
    const initialState = currentState();
    if (!initialState) return fail("Workspace unavailable. Retry before sourcing.");
    const initialCampaign = initialState.campaigns.find((item) => item.id === campaignId);
    if (!initialCampaign) return fail("Campaign not found.");
    if (!campaignAllowsLiveSourcing(initialCampaign.status)) {
      return fail(liveSourcingUnavailable(initialCampaign.status));
    }

    const request = sanitizeApolloSearchRequest(filters);
    if (!request) return fail("Apollo search filters are invalid.");

    let response: Response;
    let body: unknown;
    try {
      response = await workspaceFetch("/api/source/apollo/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, ...request }),
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      return fail(
        safeError(
          error instanceof Error ? error.message : null,
          "Network error reaching Apollo search.",
        ),
      );
    }

    if (!isRecord(body)) return fail("Apollo search returned an invalid response.");
    if (
      response.ok &&
      body.ok === true &&
      body.source === "not_configured" &&
      hasOnlyKeys(body, APOLLO_NOT_CONFIGURED_KEYS) &&
      Array.isArray(body.profiles) &&
      body.profiles.length === 0 &&
      body.code === "APOLLO_NOT_CONFIGURED"
    ) {
      return {
        accepted: [],
        skipped: [],
        source: "not_configured",
        error: safeError(body.error, "Add an Apollo key in Settings to source real candidates."),
      };
    }
    if (!response.ok || body.ok !== true || body.source !== "apollo") {
      return fail(safeError(body.error, "Apollo search failed."));
    }
    if (!hasOnlyKeys(body, APOLLO_SUCCESS_KEYS)) {
      return fail("Apollo search returned an invalid response.");
    }
    const profiles = sanitizeApolloProfiles(body.profiles, request.count);
    if (!profiles) return fail("Apollo search returned an invalid response.");

    if (!workspaceEffectAllowed()) {
      return fail("Workspace unavailable. Retry before saving sourced candidates.");
    }
    if (!sourcingMutationAllowed()) {
      return fail("You do not have permission to source candidates in this workspace.");
    }
    const latestState = currentState();
    if (!latestState) {
      return fail("Workspace unavailable. Retry before saving sourced candidates.");
    }
    const latestCampaign = latestState.campaigns.find((item) => item.id === campaignId);
    if (!latestCampaign) return fail("Campaign not found.");
    if (!campaignAllowsLiveSourcing(latestCampaign.status)) {
      return fail(liveSourcingUnavailable(latestCampaign.status));
    }

    if (profiles.length === 0) {
      return { accepted: [], skipped: [], source: "apollo" };
    }

    const queryLabel = apolloQueryLabel(request);
    const preview = mapApolloBatch(
      profiles,
      latestCampaign,
      queryLabel,
      latestState.candidates,
      effectiveWeights(latestCampaign.scoringWeights, latestState.skills),
    );
    if (preview.accepted.length === 0) {
      return { ...preview, source: "apollo" };
    }
    let committedResult: SourceResult | null = null;
    const applied = await commitPersisted((previous) => {
      if (!workspaceEffectAllowed() || !sourcingMutationAllowed()) return previous;
      const campaign = previous.campaigns.find((item) => item.id === campaignId);
      if (!campaign || !campaignAllowsLiveSourcing(campaign.status)) return previous;
      const weights = effectiveWeights(campaign.scoringWeights, previous.skills);
      const result = mapApolloBatch(
        profiles,
        campaign,
        queryLabel,
        previous.candidates,
        weights,
      );
      committedResult = result;
      if (result.accepted.length === 0) return previous;
      let next: HermesState = {
        ...previous,
        candidates: [...result.accepted, ...previous.candidates],
      };
      next = recomputeMetrics(next, campaignId);
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: `Sourced ${result.accepted.length} candidates via Apollo`,
          notes: `Live Apollo batch. ${result.skipped.length} skipped by dedupe (${result.skipped
            .slice(0, 3)
            .map((item) => item.reason)
            .join(", ")}${result.skipped.length > 3 ? "…" : ""}).`,
          outcome: `${result.accepted.length} accepted, ${result.skipped.length} skipped (live)`,
          campaignId,
          linkedEntityType: "campaign",
          linkedEntityId: campaignId,
        }),
        campaignId,
      );
    });
    if (!applied || !committedResult) {
      return fail("Workspace changed before the Apollo candidates could be saved. Retry sourcing.");
    }
    const result: SourceResult = committedResult;
    if (result.accepted.length > 0) {
      emitSource({ kind: "source", campaignId, count: result.accepted.length });
    }
    return { ...result, source: "apollo" };
  };

  const prepareApolloEnrichment: SourcingActions["prepareApolloEnrichment"] = async (
    candidateId,
  ) => {
    if (!candidatePersistenceAllowed("live")) {
      return { ok: false, error: "Apollo enrichment requires a live workspace." };
    }
    if (!workspaceEffectAllowed()) {
      return { ok: false, error: "Workspace unavailable. Retry before enrichment." };
    }
    if (!sourcingMutationAllowed()) {
      return { ok: false, error: "You do not have permission to enrich candidates in this workspace." };
    }
    const before = currentState();
    const candidate = before?.candidates.find((item) => item.id === candidateId);
    const campaign = candidate && before?.campaigns.find((item) => item.id === candidate.campaignId);
    if (
      !candidate ||
      !campaign ||
      campaign.status === "Paused" ||
      candidate.sourcePlatform !== "Apollo" ||
      !UUID_RE.test(candidate.id) ||
      !candidate.sourceAuthorityId ||
      !UUID_RE.test(candidate.sourceAuthorityId)
    ) {
      return { ok: false, error: "This candidate has no active Apollo enrichment authority." };
    }

    let selectionResponse: Response;
    let selectionBody: unknown;
    const selection = {
      targetId: candidate.sourceAuthorityId,
      candidateId: candidate.id,
    };
    try {
      selectionResponse = await workspaceFetch("/api/source/apollo/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: candidate.campaignId, candidates: [selection] }),
      });
      selectionBody = await selectionResponse.json().catch(() => null);
    } catch (error) {
      return {
        ok: false,
        error: safeError(
          error instanceof Error ? error.message : null,
          "Apollo candidate selection failed.",
        ),
      };
    }
    if (
      !selectionResponse.ok ||
      !isRecord(selectionBody) ||
      selectionBody.ok !== true ||
      !hasOnlyKeys(selectionBody, APOLLO_SELECTION_KEYS) ||
      !Array.isArray(selectionBody.selected) ||
      selectionBody.selected.length !== 1 ||
      !isRecord(selectionBody.selected[0]) ||
      !hasOnlyKeys(selectionBody.selected[0], APOLLO_SELECTION_BINDING_KEYS) ||
      selectionBody.selected[0].targetId !== selection.targetId ||
      selectionBody.selected[0].candidateId !== selection.candidateId
    ) {
      return {
        ok: false,
        error: isRecord(selectionBody)
          ? safeError(selectionBody.error, "Apollo candidate selection failed.")
          : "Apollo candidate selection failed.",
      };
    }

    const afterSelection = currentState();
    const selectedCandidate = afterSelection?.candidates.find((item) => item.id === candidateId);
    const selectedCampaign = selectedCandidate && afterSelection?.campaigns.find(
      (item) => item.id === selectedCandidate.campaignId,
    );
    if (
      !workspaceEffectAllowed() ||
      !sourcingMutationAllowed() ||
      !selectedCandidate ||
      !selectedCampaign ||
      selectedCampaign.status === "Paused" ||
      selectedCandidate.sourcePlatform !== "Apollo" ||
      selectedCandidate.sourceAuthorityId !== candidate.sourceAuthorityId
    ) {
      return { ok: false, error: "Apollo enrichment authority changed before preparation. Retry." };
    }

    let response: Response;
    let body: unknown;
    try {
      response = await workspaceFetch("/api/source/apollo/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          campaignId: candidate.campaignId,
          candidateId: candidate.id,
          targetId: candidate.sourceAuthorityId,
          scope: "email",
        }),
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      return {
        ok: false,
        error: safeError(error instanceof Error ? error.message : null, "Apollo enrichment preparation failed."),
      };
    }
    const result = isRecord(body) ? body : null;
    if (!response.ok || result?.ok !== true) {
      return {
        ok: false,
        error: safeError(result?.error, "Apollo enrichment preparation failed."),
        code: apolloEnrichmentErrorCode(result?.code),
      };
    }

    const confirmationNonce = optionalString(result.confirmationNonce, 36);
    const expiresAt = optionalIsoDate(result.expiresAt);
    if (
      result.status !== "prepared" ||
      result.campaignId !== candidate.campaignId ||
      result.candidateId !== candidate.id ||
      result.targetId !== candidate.sourceAuthorityId ||
      result.scope !== "email" ||
      result.maxCostCredits !== 1 ||
      !confirmationNonce ||
      !UUID_RE.test(confirmationNonce) ||
      !expiresAt
    ) {
      return { ok: false, error: "Apollo returned an invalid preparation receipt." };
    }

    const current = currentState();
    const currentCandidate = current?.candidates.find((item) => item.id === candidateId);
    const currentCampaign = currentCandidate && current?.campaigns.find((item) => item.id === currentCandidate.campaignId);
    if (
      !workspaceEffectAllowed() ||
      !sourcingMutationAllowed() ||
      !currentCandidate ||
      !currentCampaign ||
      currentCampaign.status === "Paused" ||
      currentCandidate.sourcePlatform !== "Apollo" ||
      currentCandidate.sourceAuthorityId !== candidate.sourceAuthorityId
    ) {
      return { ok: false, error: "Apollo enrichment authority changed before confirmation. Retry." };
    }
    return { ok: true, confirmationNonce, expiresAt };
  };

  const enrichApolloCandidate: SourcingActions["enrichApolloCandidate"] = async (
    candidateId,
    confirmationNonce,
  ) => {
    if (!candidatePersistenceAllowed("live")) {
      return { ok: false, revealed: false, detail: "Apollo enrichment requires a live workspace." };
    }
    if (!workspaceEffectAllowed()) {
      return { ok: false, revealed: false, detail: "Workspace unavailable. Retry before enrichment." };
    }
    if (!sourcingMutationAllowed()) {
      return { ok: false, revealed: false, detail: "You do not have permission to enrich candidates." };
    }
    const before = currentState();
    const candidate = before?.candidates.find((item) => item.id === candidateId);
    const campaign = candidate && before?.campaigns.find((item) => item.id === candidate.campaignId);
    if (
      !candidate ||
      !campaign ||
      campaign.status === "Paused" ||
      candidate.sourcePlatform !== "Apollo" ||
      !UUID_RE.test(candidate.id) ||
      !candidate.sourceAuthorityId ||
      !UUID_RE.test(candidate.sourceAuthorityId) ||
      !UUID_RE.test(confirmationNonce)
    ) {
      return { ok: false, revealed: false, detail: "Apollo enrichment confirmation is invalid." };
    }

    let response: Response;
    let body: unknown;
    try {
      response = await workspaceFetch("/api/source/apollo/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          campaignId: candidate.campaignId,
          candidateId: candidate.id,
          targetId: candidate.sourceAuthorityId,
          scope: "email",
          confirmationNonce,
          idempotencyKey: globalThis.crypto.randomUUID(),
        }),
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      return {
        ok: false,
        revealed: false,
        detail: safeError(error instanceof Error ? error.message : null, "Apollo enrichment failed."),
      };
    }
    const result = isRecord(body) ? body : null;
    if (!response.ok || result?.ok !== true) {
      return {
        ok: false,
        revealed: false,
        detail: safeError(result?.error, "Apollo enrichment failed."),
        code: apolloEnrichmentErrorCode(result?.code),
      };
    }

    const email = optionalString(result.email, 320);
    if (
      result.status !== "completed" ||
      result.campaignId !== candidate.campaignId ||
      result.candidateId !== candidate.id ||
      result.targetId !== candidate.sourceAuthorityId ||
      typeof result.revealed !== "boolean" ||
      typeof result.cached !== "boolean" ||
      typeof email !== "string" ||
      (result.revealed ? !isValidEmail(email) || result.detail !== "email_revealed" : email !== "" || result.detail !== "no_contact_found") ||
      result.phone !== ""
    ) {
      return { ok: false, revealed: false, detail: "Apollo returned an invalid enrichment receipt." };
    }

    const current = currentState();
    const currentCandidate = current?.candidates.find((item) => item.id === candidateId);
    const currentCampaign = currentCandidate && current?.campaigns.find((item) => item.id === currentCandidate.campaignId);
    if (
      !workspaceEffectAllowed() ||
      !sourcingMutationAllowed() ||
      !currentCandidate ||
      !currentCampaign ||
      currentCampaign.status === "Paused" ||
      currentCandidate.sourcePlatform !== "Apollo" ||
      currentCandidate.sourceAuthorityId !== candidate.sourceAuthorityId
    ) {
      return { ok: false, revealed: false, detail: "Apollo enrichment authority changed before saving. Retry." };
    }
    if (!result.revealed) {
      return { ok: true, revealed: false, detail: "No contact email found." };
    }

    let saved = false;
    const committed = await commitPersisted((state) => {
      const exactCandidate = state.candidates.find((item) => item.id === candidateId);
      if (
        !exactCandidate ||
        exactCandidate.sourcePlatform !== "Apollo" ||
        exactCandidate.sourceAuthorityId !== candidate.sourceAuthorityId
      ) {
        return state;
      }
      saved = true;
      const next: HermesState = {
        ...state,
        candidates: state.candidates.map((item) =>
          item.id === candidateId ? { ...item, email: email.toLowerCase() } : item,
        ),
      };
      return withActivity(
        next,
        makeActivity({
          type: "sourcing",
          title: `Enriched via Apollo: ${exactCandidate.name}`,
          notes: "Revealed one contact email through the normalized Apollo authority.",
          outcome: "Email revealed",
          campaignId: exactCandidate.campaignId,
          linkedEntityType: "candidate",
          linkedEntityId: exactCandidate.id,
        }),
        exactCandidate.campaignId,
      );
    });
    if (!committed || !saved) {
      return { ok: false, revealed: false, detail: "Workspace changed before the contact email could be saved. Retry." };
    }
    return { ok: true, revealed: true, detail: "Contact email revealed." };
  };

  return {
    sourceNextBatch,
    addCandidateFromGithub,
    addCandidateManual,
    sourceFromApollo,
    prepareApolloEnrichment,
    enrichApolloCandidate,
  };
}
