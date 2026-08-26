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
import {
  availableProviders,
  providersForCampaign,
  type SourcingProvider,
  type SourcingProviderId,
} from "./providers";
import { mergePreferringRicher } from "./providers/merge";

export { mergePreferringRicher } from "./providers/merge";

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
  const configured = (campaign.sourcingStrategy.githubQueries ?? [])
    .map((q) => q.query.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured.slice(0, 3);
  const skills = campaign.jobAnalysis.requiredSkills.slice(0, 2);
  if (skills.length === 0) return [];
  return skills.map(
    (skill) => `language:${skill.replace(/\s+/g, "")} followers:>40 repos:>5`,
  );
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
  for (const provider of selected) {
    const queries = queriesForProvider(provider, input.campaign, input.forcedQueries).slice(
      0,
      maxQueryRounds,
    );
    if (queries.length === 0) continue;
    providersUsed.push(provider.id);
    const providerHits: Candidate[] = [];
    for (const query of queries) {
      if (providerHits.length >= count * 2) break;
      const remaining = Math.min(15, Math.max(count, count * 2 - providerHits.length));
      const result = await provider.search({
        query,
        count: remaining,
        ctx: { ...ctx, existing: [...input.existing, ...providerHits] },
      });
      executions.push({
        providerId: provider.id,
        platform: provider.displayPlatform,
        query,
        ok: result.ok,
        candidateCount: result.accepted.length,
        skippedCount: result.skipped.length,
        error: result.error,
      });
      if (result.ok) providerHits.push(...result.accepted);
      // Profile search is expensive — one successful LinkedIn profile query is enough for round 1.
      if (provider.id === "linkedin_profiles" && result.ok && result.accepted.length > 0) break;
    }
    batches.push({ provider, candidates: providerHits });
  }

  const merged = mergePreferringRicher(batches);
  const deduped = dedupeCandidates(merged, input.existing, {
    excludedCompanies: input.campaign.sourcingStrategy.excludedCompanies,
  });
  const accepted = deduped.accepted
    .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, count);

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
