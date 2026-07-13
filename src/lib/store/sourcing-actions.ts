import { redactEmail, redactSecrets } from "../log-redact";
import { sourceCandidates } from "../mock-ai";
import { dedupeCandidates } from "../rules";
import { roleProfile } from "../roles";
import { scoreCandidate } from "../scoring";
import {
  mapGithubCandidates,
  mapWebSearchCandidates,
  type SourceResult,
} from "../sourcing/candidate-mappers";
import { GITHUB_USERNAME_RE, type GithubUser } from "../sourcing/github";
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
  type Candidate,
  type CandidateLawfulBasis,
  type HermesState,
  type ScoringWeights,
  type SourcePlatform,
} from "../types";
import { genId, initialsFrom } from "../utils";
import { baseWebQuery } from "./sourcing-helpers";
import type { HermesActions } from "./contracts";

export type SourcingActions = Pick<
  HermesActions,
  "sourceNextBatch" | "addCandidateFromGithub" | "addCandidateManual"
>;

export type SourcingActivityDraft = Omit<Activity, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface SourcingActionDependencies {
  commit: (update: (state: HermesState) => HermesState) => boolean;
  currentState: () => HermesState | null;
  sourcingMutationAllowed: () => boolean;
  workspaceEffectAllowed: () => boolean;
  syntheticSourcingAllowed: () => boolean;
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

export function createSourcingActions({
  commit,
  currentState,
  sourcingMutationAllowed,
  workspaceEffectAllowed,
  syntheticSourcingAllowed,
  workspaceFetch,
  makeActivity,
  withActivity,
  recomputeMetrics,
  effectiveWeights,
  emitSource,
}: SourcingActionDependencies): SourcingActions {
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
    if (initialCampaign.status === "Paused") {
      return { ok: false, error: "Campaign is paused.", source: "paused" };
    }

    const requestedPlatform =
      opts?.platform ?? roleProfile(initialCampaign.jobAnalysis).platforms[0];
    if (!isSourcePlatform(requestedPlatform)) {
      return invalidRequest("Unsupported sourcing platform.");
    }
    const count = opts?.count ?? 6;
    if (!Number.isInteger(count) || count < 1 || count > MAX_SOURCE_COUNT) {
      return invalidRequest(
        `Source count must be an integer between 1 and ${MAX_SOURCE_COUNT}.`,
      );
    }
    if (DEDICATED_PLATFORMS.has(requestedPlatform)) {
      return invalidRequest(
        `${requestedPlatform} sourcing must use its dedicated provider action.`,
      );
    }
    if (
      SYNTHETIC_PLATFORMS.has(requestedPlatform) &&
      !syntheticSourcingAllowed()
    ) {
      return invalidRequest(
        `${requestedPlatform} simulation is available only in demo environments.`,
      );
    }

    let source: "github" | "web" | "mock" = "mock";
    let rawGithubUsers: GithubUser[] | null = null;
    let rawWebLeads: WebLead[] | null = null;
    let query = "";

    if (requestedPlatform === "GitHub") {
      const baseQuery =
        initialCampaign.sourcingStrategy.githubQueries[0]?.query ??
        `language:${(initialCampaign.jobAnalysis.requiredSkills[0] ?? "typescript").toLowerCase()}`;
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
    if (campaign.status === "Paused") {
      return { ok: false, error: "Campaign is paused.", source: "paused" };
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

    const applied = commit((previous) => {
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
    if (!applied) {
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
    if (initialCampaign.status === "Paused") {
      return { ok: false, error: "Campaign is paused." };
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
    if (campaign.status === "Paused") return { ok: false, error: "Campaign is paused." };

    const weights = effectiveWeights(campaign.scoringWeights, latestState.skills);
    const { accepted, skipped } = mapGithubCandidates(
      [user],
      campaign,
      `@${user.login}`,
      latestState.candidates,
      weights,
    );
    const applied = commit((previous) => {
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
    if (!applied) {
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

  const addCandidateManual: SourcingActions["addCandidateManual"] = (
    campaignId,
    input,
  ) => {
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
    if (campaign.status === "Paused") return { ok: false, error: "Campaign is paused." };
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
    const applied = commit((previous) => {
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
    if (!applied) {
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

  return { sourceNextBatch, addCandidateFromGithub, addCandidateManual };
}
