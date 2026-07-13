import { redactEmail, redactSecrets } from "../log-redact";
import { sourceCandidates } from "../mock-ai";
import { roleProfile } from "../roles";
import {
  mapGithubCandidates,
  mapWebSearchCandidates,
  type SourceResult,
} from "../sourcing/candidate-mappers";
import type { GithubUser } from "../sourcing/github";
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
  type HermesState,
  type ScoringWeights,
  type SourcePlatform,
} from "../types";
import { baseWebQuery } from "./sourcing-helpers";
import type { HermesActions } from "./contracts";

export type SourcingActions = Pick<HermesActions, "sourceNextBatch">;

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
const DEDICATED_PLATFORMS = new Set<SourcePlatform>(["Sillage", "Apollo", "Seamless"]);
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
      (hostname !== expectedHost && !hostname.endsWith(`.${expectedHost}`))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
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
    const htmlUrl = safeHttpsUrl(item.htmlUrl, "github.com");
    const createdAt = optionalIsoDate(item.createdAt);
    const topLanguage = optionalString(item.topLanguage, 100);
    if (
      !login ||
      name === undefined ||
      email === undefined ||
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

  return { sourceNextBatch };
}
