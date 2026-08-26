// Built-in, stateful sourcing tool for the agentic sourcing loop (server-side
// only). Unlike the read-only web-research tools (web-tools.ts), this one is
// bound to a specific campaign/JD per request via makeSourcingToolRunner() and
// accumulates every REAL candidate it finds — the caller reads that
// accumulated list after the loop finishes instead of trusting the model to
// echo back names/scores/URLs correctly in its final text.
//
// search_candidates reuses the exact real-sourcing pipeline already shipped:
// GitHub's Search API (keyless by default) for GitHub, and the compliant
// web_search tool (site:-scoped) + extractLead for LinkedIn/Stack Overflow/
// Dribbble/Behance — the SAME mapGithubCandidates/mapWebSearchCandidates that
// already do real dedupe + real deterministic scoring. The model never invents
// a candidate or a score; it only chooses which real, already-scored people to
// draft outreach for.

import type { McpTool } from "@/lib/mcp-client";
import type { Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import { searchGithubUsers } from "@/lib/sourcing/github";
import { runWebTool, type WebFetch } from "@/lib/ai/web-tools";
import { ensureWebQueryScope, extractLead, isWebSearchPlatform } from "@/lib/sourcing/web-leads";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import {
  mapGithubCandidates,
  mapWebSearchCandidates,
  type CandidateMappingCampaign,
} from "@/lib/sourcing/candidate-mappers";
import { candidateMatchesRoleTitle } from "@/lib/sourcing/candidate-fit";

export const SOURCING_TOOL_DEFS: McpTool[] = [
  {
    name: "search_candidates",
    description:
      "Search ONE platform for real candidates matching this role, already deduped and scored " +
      "against the job description. Returns real people found via that platform's real search " +
      "(GitHub's Search API, or a site:-scoped web search for the others) — never fabricated. " +
      "Call it once per platform worth checking; call it again with a different query on the same " +
      "platform to broaden a search that returned too few good matches.",
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
        count: { type: "number", description: "Max candidates to return this call (1-10). Default 5." },
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
  tavilyKey?: string,
  webFetchImpl?: WebFetch,
  beforeExternalCall?: () => Promise<boolean>,
) {
  const found: Candidate[] = [];
  const executions: SourcingQueryExecution[] = [];

  async function run(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; content?: unknown; error?: string }> {
    if (name !== "search_candidates") return { ok: false, error: "Unknown tool." };

    const platform = String(args.platform ?? "").trim() as SourcePlatform;
    const query = String(args.query ?? "").trim().slice(0, 256);
    const count = Math.min(Math.max(Math.trunc(Number(args.count)) || 5, 1), 10);
    if (!platform) return { ok: false, error: "Missing platform." };
    if (!query) return { ok: false, error: "Missing query." };
    const policy = validateSourcingQuery(platform, query, campaign);
    if (!policy.ok) return policy;
    if (beforeExternalCall && !(await beforeExternalCall())) {
      return { ok: false, error: "Sourcing authority changed." };
    }

    const alreadySeen = [...existing, ...found];
    let accepted: Candidate[] = [];
    let skippedCount = 0;

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
    } else if (isWebSearchPlatform(platform)) {
      const scopedQuery = ensureWebQueryScope(platform, query);
      const search = await runWebTool("web_search", { query: scopedQuery }, { tavilyKey, fetchImpl: webFetchImpl });
      if (!search.ok) {
        executions.push({ platform, query, ok: false, candidateCount: 0, skippedCount: 0 });
        return { ok: false, error: search.error ?? "Web search failed." };
      }
      const content = search.content as { results?: { title: string; url: string; snippet: string }[] } | undefined;
      const hits = (content?.results ?? []).slice(0, count);
      const leads = hits.map((h) => extractLead(h, platform));
      const result = mapWebSearchCandidates(leads, campaign, scopedQuery, platform, alreadySeen, weights);
      const roleTitle = campaign.jobAnalysis.title.trim();
      const filtered = result.accepted.filter((c) => candidateMatchesRoleTitle(c, roleTitle));
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

  return {
    run,
    getFound: (): Candidate[] => found,
    getExecutions: (): SourcingQueryExecution[] => executions.map((execution) => ({ ...execution })),
  };
}
