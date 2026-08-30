import "server-only";

import { buildLinkedInQueryVariants } from "@/lib/mock-ai";
import { dedupeCandidates, type CandidateDedupeIdentity } from "@/lib/rules";
import {
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import type { Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import type { WebFetch } from "@/lib/ai/web-tools";
import { selectTopKByMatchScore } from "@/lib/scoring";
import {
  buildGithubUserQueriesForSkills,
  githubLanguageForSkill,
  sanitizeGithubUserSearchQuery,
} from "@/lib/sourcing/github-query-language";
import {
  availableProviders,
  providersForCampaign,
  type SourcingProvider,
  type SourcingProviderId,
} from "./providers";
import { mergePreferringRicher } from "./providers/merge";

export { mergePreferringRicher } from "./providers/merge";
export { githubLanguageForSkill } from "@/lib/sourcing/github-query-language";

export interface MultiProviderSourcingInput {
  campaign: CandidateMappingCampaign & {
    sourcingStrategy: CandidateMappingCampaign["sourcingStrategy"] & {
      githubQueries?: { query: string }[];
      primaryPlatforms?: SourcePlatform[];
      linkedinBoolean?: string;
    };
  };
  existing: CandidateDedupeIdentity[];
  weights: ScoringWeights;
  count: number;
  githubToken: string;
  tavilyKey?: string;
  linkedInProfileToken?: string | null;
  smartApiKey?: string | null;
  webFetchImpl?: WebFetch;
  signal?: AbortSignal;
  beforeExternalCall?: () => Promise<boolean>;
  /** Optional forced query list (agent-framework / promoted lessons). */
  forcedQueries?: { platform: SourcePlatform; query: string }[];
}

export interface MultiProviderExecution {
  providerId: SourcingProviderId;
  platform: SourcePlatform;
  query: string;
  ok: boolean;
  candidateCount: number;
  skippedCount: number;
  error?: string;
}

export interface MultiProviderSourcingResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
  executions: MultiProviderExecution[];
  providersUsed: SourcingProviderId[];
}

function githubQueriesFor(campaign: MultiProviderSourcingInput["campaign"]): string[] {
  const skills = campaign.jobAnalysis.requiredSkills;
  const configured = (campaign.sourcingStrategy.githubQueries ?? [])
    .map((q) => sanitizeGithubUserSearchQuery(q.query.trim(), skills))
    .filter(Boolean);
  if (configured.length > 0) return configured.slice(0, 6);
  const built = buildGithubUserQueriesForSkills(skills.slice(0, 4), {
    region: campaign.jobAnalysis.regions[0] ?? null,
    max: 3,
  }).map((q) => q.query);
  if (built.length === 0) return [];
  const languages = Array.from(
    new Set(skills.map(githubLanguageForSkill).filter((lang): lang is string => Boolean(lang))),
  );
  const queries = [...built];
  for (const lang of languages.slice(0, 2)) {
    queries.push(`language:${lang} followers:>40 repos:>5`);
    queries.push(`language:${lang} followers:>20 repos:>3`);
  }
  const titleToken = campaign.jobAnalysis.title
    .replace(/[^\w\s]/g, " ")
    .trim()
    .split(/\s+/)
    .find((part) => part.length > 2 && !/^(senior|lead|staff|principal|junior)$/i.test(part));
  if (titleToken && languages[0]) {
    queries.push(`${titleToken} language:${languages[0]} followers:>10`);
  }
  const region = campaign.jobAnalysis.regions[0]?.trim();
  if (region && languages[0] && !/^global$/i.test(region)) {
    queries.push(`language:${languages[0]} location:${region.split(",")[0]!.trim()} followers:>10`);
  }
  return Array.from(new Set(queries)).slice(0, 8);
}

function linkedInQueriesFor(campaign: MultiProviderSourcingInput["campaign"]): string[] {
  const deep = buildLinkedInQueryVariants(campaign.jobAnalysis, 12);
  if (deep.length > 0) return deep;
  const raw = campaign.sourcingStrategy.linkedinBoolean?.trim() ?? "";
  if (raw) return [raw.slice(0, 256)];
  const fallback = [
    campaign.jobAnalysis.title,
    ...campaign.jobAnalysis.requiredSkills.slice(0, 3),
    ...campaign.jobAnalysis.regions.slice(0, 1),
  ]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 256);
  return fallback ? [fallback] : [];
}

function qualityPassingCount(
  batches: { provider: SourcingProvider; candidates: Candidate[] }[],
  existing: CandidateDedupeIdentity[],
  campaign: MultiProviderSourcingInput["campaign"],
): number {
  const merged = mergePreferringRicher(batches);
  const deduped = dedupeCandidates(merged, existing, {
    excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
  });
  return deduped.accepted.filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR)).length;
}

function queriesForProvider(
  provider: SourcingProvider,
  campaign: MultiProviderSourcingInput["campaign"],
  forced?: { platform: SourcePlatform; query: string }[],
): string[] {
  if (forced?.length) {
    const matched = forced
      .filter((f) => f.platform === provider.displayPlatform)
      .map((f) => f.query.trim())
      .filter(Boolean);
    if (matched.length) return matched;
  }
  if (provider.id === "github") return githubQueriesFor(campaign);
  if (provider.id === "smart") {
    const title = campaign.jobAnalysis.title.trim();
    const skills = campaign.jobAnalysis.requiredSkills.slice(0, 4).join(" ");
    const q = [title, skills].filter(Boolean).join(" ").trim().slice(0, 256);
    return q ? [q] : linkedInQueriesFor(campaign).slice(0, 1);
  }
  if (
    provider.id === "linkedin_profiles" ||
    provider.id === "linkedin_web" ||
    provider.id === "stackoverflow" ||
    provider.id === "dribbble" ||
    provider.id === "behance"
  ) {
    return linkedInQueriesFor(campaign);
  }
  return [];
}

/**
 * Fan-out across available sourcing backends, deepen on shortfall, enforce the
 * 80% quality floor, and return up to `count` great-fit candidates.
 */
export async function runMultiProviderSourcing(
  input: MultiProviderSourcingInput,
): Promise<MultiProviderSourcingResult> {
  const count = Math.min(Math.max(Math.trunc(input.count) || 10, 1), 20);
  const ctx = {
    campaign: input.campaign,
    existing: input.existing,
    weights: input.weights,
    githubToken: input.githubToken,
    tavilyKey: input.tavilyKey,
    linkedInProfileToken: input.linkedInProfileToken,
    smartApiKey: input.smartApiKey,
    webFetchImpl: input.webFetchImpl,
    signal: input.signal,
    beforeExternalCall: input.beforeExternalCall,
  };

  const available = await availableProviders(ctx);
  const selected = providersForCampaign(
    available,
    input.campaign.sourcingStrategy.primaryPlatforms ?? ["GitHub"],
  );
  const executions: MultiProviderExecution[] = [];
  const batches: { provider: SourcingProvider; candidates: Candidate[] }[] = [];
  const providersUsed: SourcingProviderId[] = [];

  const maxQueryRounds = 4;

  const providerResults = await Promise.all(
    selected.map(async (provider) => {
      const queries = queriesForProvider(provider, input.campaign, input.forcedQueries).slice(
        0,
        provider.id === "linkedin_profiles" ? 1 : provider.id === "github" ? 6 : maxQueryRounds,
      );
      if (queries.length === 0) {
        return { provider, providerHits: [] as Candidate[], providerExecutions: [] as MultiProviderExecution[] };
      }
      const providerHits: Candidate[] = [];
      const providerExecutions: MultiProviderExecution[] = [];
      for (const query of queries) {
        if (providerHits.length >= count * 2) break;
        const remaining = Math.min(15, Math.max(count, count * 2 - providerHits.length));
        const result = await provider.search({
          query,
          count: remaining,
          ctx: { ...ctx, existing: [...input.existing, ...providerHits] },
        });
        providerExecutions.push({
          providerId: provider.id,
          platform: provider.displayPlatform,
          query,
          ok: result.ok,
          candidateCount: result.accepted.length,
          skippedCount: result.skipped.length,
          error: result.error,
        });
        if (result.ok) providerHits.push(...result.accepted);
        // Profile search is expensive — one successful LinkedIn profile query is enough.
        if (provider.id === "linkedin_profiles" && result.ok && result.accepted.length > 0) break;
      }
      return { provider, providerHits, providerExecutions };
    }),
  );

  for (const { provider, providerHits, providerExecutions } of providerResults) {
    if (providerExecutions.length === 0 && providerHits.length === 0) continue;
    providersUsed.push(provider.id);
    executions.push(...providerExecutions);
    batches.push({ provider, candidates: providerHits });
  }

  // Deepen GitHub + LinkedIn web when quality-passing unique hits are still short of `count`.
  // Recompute shortfall from the 80% floor — never invent candidates.
  let shortfall = count - qualityPassingCount(batches, input.existing, input.campaign);
  if (shortfall > 0) {
    const existingHits = batches.flatMap((b) => b.candidates);
    const usedQueries = new Set(
      executions.map((execution) => `${execution.providerId}::${execution.query}`),
    );

    const github = selected.find((p) => p.id === "github");
    if (github) {
      const deepenQueries = githubQueriesFor(input.campaign)
        .filter((query) => !usedQueries.has(`github::${query}`))
        .slice(0, maxQueryRounds);
      for (const query of deepenQueries) {
        if (qualityPassingCount(batches, input.existing, input.campaign) >= count) break;
        const result = await github.search({
          query,
          count: Math.min(15, shortfall + 5),
          ctx: { ...ctx, existing: [...input.existing, ...existingHits] },
        });
        executions.push({
          providerId: github.id,
          platform: github.displayPlatform,
          query,
          ok: result.ok,
          candidateCount: result.accepted.length,
          skippedCount: result.skipped.length,
          error: result.error,
        });
        usedQueries.add(`github::${query}`);
        if (result.ok && result.accepted.length > 0) {
          const batch = batches.find((b) => b.provider.id === github.id);
          if (batch) batch.candidates.push(...result.accepted);
          else batches.push({ provider: github, candidates: result.accepted });
          existingHits.push(...result.accepted);
        }
      }
    }

    shortfall = count - qualityPassingCount(batches, input.existing, input.campaign);
    const web = selected.find((p) => p.id === "linkedin_web");
    if (web && shortfall > 0) {
      const deepenQueries = linkedInQueriesFor(input.campaign)
        .filter((query) => !usedQueries.has(`linkedin_web::${query}`))
        .slice(0, maxQueryRounds);
      for (const query of deepenQueries) {
        if (qualityPassingCount(batches, input.existing, input.campaign) >= count) break;
        const result = await web.search({
          query,
          count: Math.min(15, shortfall + 5),
          ctx: { ...ctx, existing: [...input.existing, ...existingHits] },
        });
        executions.push({
          providerId: web.id,
          platform: web.displayPlatform,
          query,
          ok: result.ok,
          candidateCount: result.accepted.length,
          skippedCount: result.skipped.length,
          error: result.error,
        });
        usedQueries.add(`linkedin_web::${query}`);
        if (result.ok && result.accepted.length > 0) {
          const batch = batches.find((b) => b.provider.id === web.id);
          if (batch) batch.candidates.push(...result.accepted);
          else batches.push({ provider: web, candidates: result.accepted });
          existingHits.push(...result.accepted);
        }
      }
    }
  }

  const merged = mergePreferringRicher(batches);
  const deduped = dedupeCandidates(merged, input.existing, {
    excludedCompanies: input.campaign.sourcingStrategy.excludedCompanies,
  });
  const accepted = selectTopKByMatchScore(
    deduped.accepted.filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR)),
    count,
    input.campaign.jobAnalysis,
  );

  return {
    accepted,
    skipped: [
      ...deduped.skipped,
      ...deduped.accepted
        .filter((c) => !accepted.some((a) => a.id === c.id))
        .map((c) => ({ name: c.name, reason: "Below quality floor or batch cap" })),
    ],
    executions,
    providersUsed: Array.from(new Set(providersUsed)),
  };
}
