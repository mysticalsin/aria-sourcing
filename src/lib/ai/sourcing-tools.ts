// Built-in, stateful sourcing tool for the agentic sourcing loop (server-side
// only). Unlike the read-only web-research tools (web-tools.ts), this one is
// bound to a specific campaign/JD per request via makeSourcingToolRunner() and
// accumulates every REAL candidate it finds — the caller reads that
// accumulated list after the loop finishes instead of trusting the model to
// echo back names/scores/URLs correctly in its final text.
//
// search_candidates fans out through the multi-provider registry: GitHub Search
// API, LinkedIn profile search (when the connector key is present), and
// site-scoped web search for LinkedIn/SO/Dribbble/Behance. Candidates are
// stamped with operator-facing platforms (LinkedIn, GitHub, …) — never vendor
// brands. The model never invents a candidate or a score.

import type { McpTool } from "@/lib/mcp-client";
import type { Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import type { WebFetch } from "@/lib/ai/web-tools";
import {
  mapGithubCandidates,
  mapWebSearchCandidates,
  type CandidateMappingCampaign,
} from "@/lib/sourcing/candidate-mappers";
import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import { selectTopKByMatchScore } from "@/lib/scoring";
import { searchGithubUsers } from "@/lib/sourcing/github";
import { runWebTool } from "@/lib/ai/web-tools";
import { ensureWebQueryScope, extractLead, isWebSearchPlatform } from "@/lib/sourcing/web-leads";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import { mergePreferringRicher } from "@/lib/sourcing/providers/merge";
import { linkedinWebProvider } from "@/lib/sourcing/providers/web";
import type { SourcingProvider } from "@/lib/sourcing/providers/types";

export const SOURCING_TOOL_DEFS: McpTool[] = [
  {
    name: "search_candidates",
    description:
      "Search ONE platform for real candidates matching this role, already deduped and scored " +
      "against the job description. Returns real people found via live backends for that platform " +
      "(GitHub Search API; LinkedIn profile search + site-scoped web; or site-scoped web for the " +
      "others) — never fabricated. Call it once per platform worth checking; call it again with a " +
      "different query on the same platform to broaden a search that returned too few good matches.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["GitHub", "LinkedIn", "Stack Overflow", "Dribbble", "Behance"],
          description: "Which platform to search.",
        },
        query: {
          type: "string",
          description:
            "GitHub: a GitHub search-qualifier string (e.g. 'language:Go followers:>40'). " +
            "Others: plain keywords (title + a skill) — this gets scoped with a site: filter automatically.",
        },
        count: { type: "number", description: "Max candidates to return this call (1-15). Prefer the campaign shortlist size (up to 10)." },
      },
      required: ["platform", "query"],
    },
  },
];

export function isSourcingTool(name: string): boolean {
  return name === "search_candidates";
}

interface SearchSummary {
  id: string;
  name: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  matchScore: number;
  sourcePlatform: SourcePlatform;
  url: string;
  techStack: string[];
  recentActivity: string;
}

export interface SourcingQueryExecution {
  platform: SourcePlatform;
  query: string;
  ok: boolean;
  candidateCount: number;
  skippedCount: number;
}

export interface MakeSourcingToolRunnerOptions {
  tavilyKey?: string;
  webFetchImpl?: WebFetch;
  beforeExternalCall?: () => Promise<boolean>;
  /** Decrypted LinkedIn profile search connector token (vendor under the hood). */
  linkedInProfileToken?: string | null;
}

/**
 * Build a stateful search_candidates runner bound to one campaign/request.
 * `run` dispatches the tool call; `getFound()` returns every real, scored
 * Candidate accumulated across all calls made during the loop — the
 * authoritative record the caller should use, not the model's prose.
 */
export function makeSourcingToolRunner(
  campaign: CandidateMappingCampaign,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights,
  githubToken: string,
  tavilyKeyOrOpts?: string | MakeSourcingToolRunnerOptions,
  webFetchImpl?: WebFetch,
  beforeExternalCall?: () => Promise<boolean>,
) {
  // Back-compat: older callers pass (…, githubToken, tavilyKey, webFetch, beforeExternalCall).
  const opts: MakeSourcingToolRunnerOptions =
    typeof tavilyKeyOrOpts === "object" && tavilyKeyOrOpts !== null
      ? tavilyKeyOrOpts
      : {
          tavilyKey: tavilyKeyOrOpts,
          webFetchImpl,
          beforeExternalCall,
        };

  const found: Candidate[] = [];
  const executions: SourcingQueryExecution[] = [];

  const providerCtx = () => ({
    campaign,
    existing: [...existing, ...found],
    weights,
    githubToken,
    tavilyKey: opts.tavilyKey,
    linkedInProfileToken: opts.linkedInProfileToken,
    webFetchImpl: opts.webFetchImpl,
    beforeExternalCall: opts.beforeExternalCall,
  });

  async function run(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; content?: unknown; error?: string }> {
    if (name !== "search_candidates") return { ok: false, error: "Unknown tool." };

    const platform = String(args.platform ?? "").trim() as SourcePlatform;
    const query = String(args.query ?? "").trim().slice(0, 256);
    const count = Math.min(Math.max(Math.trunc(Number(args.count)) || 5, 1), 15);
    if (!platform) return { ok: false, error: "Missing platform." };
    if (!query) return { ok: false, error: "Missing query." };
    const policy = validateSourcingQuery(platform, query, campaign);
    if (!policy.ok) return policy;
    if (opts.beforeExternalCall && !(await opts.beforeExternalCall())) {
      return { ok: false, error: "Sourcing authority changed." };
    }

    const alreadySeen = [...existing, ...found];
    let accepted: Candidate[] = [];
    let skippedCount = 0;
    const ctx = { ...providerCtx(), existing: alreadySeen, signal };

    if (platform === "GitHub") {
      try {
        const clearance = clearDiscoveryCriteria(platform, { query }, campaign);
        if (!clearance.ok) return clearance;
        const users = await searchGithubUsers(clearance.clearance, query, count, githubToken, signal);
        const result = mapGithubCandidates(users, campaign, query, alreadySeen, weights);
        accepted = result.accepted;
        skippedCount = result.skipped.length;
      } catch (err) {
        executions.push({ platform, query, ok: false, candidateCount: 0, skippedCount: 0 });
        return { ok: false, error: err instanceof Error ? err.message : "GitHub search failed." };
      }
    } else if (platform === "LinkedIn") {
      const batches: { provider: SourcingProvider; candidates: Candidate[] }[] = [];
      let anyOk = false;
      let lastError: string | undefined;
      if (opts.linkedInProfileToken?.trim()) {
        const { linkedinProfilesProvider } = await import(
          "@/lib/sourcing/providers/linkedin-profiles"
        );
        if (await linkedinProfilesProvider.isAvailable(ctx)) {
          const profileResult = await linkedinProfilesProvider.search({ query, count, ctx });
          anyOk = anyOk || profileResult.ok;
          if (!profileResult.ok) lastError = profileResult.error;
          batches.push({ provider: linkedinProfilesProvider, candidates: profileResult.accepted });
          skippedCount += profileResult.skipped.length;
        }
      }
      const webResult = await linkedinWebProvider.search({ query, count, ctx });
      anyOk = anyOk || webResult.ok;
      if (!webResult.ok) lastError = webResult.error;
      batches.push({ provider: linkedinWebProvider, candidates: webResult.accepted });
      skippedCount += webResult.skipped.length;
      if (!anyOk) {
        executions.push({ platform, query, ok: false, candidateCount: 0, skippedCount: 0 });
        return { ok: false, error: lastError ?? "LinkedIn search failed." };
      }
      accepted = selectTopKByMatchScore(
        mergePreferringRicher(batches)
          .filter((c) => candidateMatchesRoleTitle(c, campaign.jobAnalysis.title.trim()))
          .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR)),
        count,
        campaign.jobAnalysis,
      );
    } else if (isWebSearchPlatform(platform)) {
      const scopedQuery = ensureWebQueryScope(platform, query);
      const search = await runWebTool("web_search", { query: scopedQuery }, {
        tavilyKey: opts.tavilyKey,
        fetchImpl: opts.webFetchImpl,
      });
      if (!search.ok) {
        executions.push({ platform, query, ok: false, candidateCount: 0, skippedCount: 0 });
        return { ok: false, error: search.error ?? "Web search failed." };
      }
      const content = search.content as { results?: { title: string; url: string; snippet: string }[] } | undefined;
      const hits = (content?.results ?? []).slice(0, Math.max(count * 4, 16));
      const leads = hits.map((h) => extractLead(h, platform));
      const result = mapWebSearchCandidates(leads, campaign, scopedQuery, platform, alreadySeen, weights);
      const roleTitle = campaign.jobAnalysis.title.trim();
      const filtered = selectTopKByMatchScore(
        result.accepted
          .filter((c) => candidateMatchesRoleTitle(c, roleTitle))
          .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR)),
        count,
        campaign.jobAnalysis,
      );
      accepted = filtered;
      skippedCount = result.skipped.length + (result.accepted.length - filtered.length);
    } else {
      return {
        ok: false,
        error: `${platform || "that platform"} has no external search — Referral/Talent Pool candidates come from the app's own pipeline, not a search.`,
      };
    }

    found.push(...accepted);
    executions.push({
      platform,
      query,
      ok: true,
      candidateCount: accepted.length,
      skippedCount,
    });
    const summary: SearchSummary[] = accepted.map((c) => ({
      id: c.id,
      name: c.name,
      currentTitle: c.currentTitle,
      currentCompany: c.currentCompany,
      location: c.location,
      matchScore: c.matchScore,
      sourcePlatform: c.sourcePlatform,
      url: c.githubUrl || c.linkedinUrl || c.sourceUrl || "",
      techStack: c.techStack,
      recentActivity: c.recentActivity,
    }));
    return { ok: true, content: { platform, query, found: summary, skippedByDedupe: skippedCount } };
  }

  function seedFromOrchestrator(result: {
    accepted: Candidate[];
    executions: Array<{
      platform: SourcePlatform;
      query: string;
      ok: boolean;
      candidateCount: number;
      skippedCount: number;
    }>;
  }): void {
    found.push(...result.accepted);
    for (const execution of result.executions) {
      executions.push({
        platform: execution.platform,
        query: execution.query,
        ok: execution.ok,
        candidateCount: execution.candidateCount,
        skippedCount: execution.skippedCount,
      });
    }
  }

  return {
    run,
    getFound: (): Candidate[] => found,
    getExecutions: (): SourcingQueryExecution[] => executions.map((execution) => ({ ...execution })),
    seedFromOrchestrator,
  };
}
