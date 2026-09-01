// Built-in, stateful sourcing tool for the agentic sourcing loop (server-side
// only). Unlike the read-only web-research tools (web-tools.ts), this one is
// bound to a specific campaign/JD per request via makeSourcingToolRunner() and
// accumulates every REAL candidate it finds — the caller reads that
// accumulated list after the loop finishes instead of trusting the model to
// echo back names/scores/URLs correctly in its final text.
//
// search_candidates reuses the exact real-sourcing pipeline already shipped:
// GitHub's Search API (keyless by default) for GitHub, Apify harvestapi for
// LinkedIn public profiles, and site:-scoped web_search for LinkedIn/SO/
// Dribbble/Behance. The model never invents a candidate or a score.

import type { McpTool } from "@/lib/mcp-client";
import type { Campaign, Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import { searchGithubUsers } from "@/lib/sourcing/github";
import { runWebTool, type WebFetch } from "@/lib/ai/web-tools";
import { ensureWebQueryScope, extractLead, isWebSearchPlatform } from "@/lib/sourcing/web-leads";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import { APIFY_HARVEST_WAIT_MS, runProfileSearchAndWait } from "@/lib/sourcing/apify";
import { HARVEST_ACTOR, type HarvestEvidence } from "@/lib/sourcing/harvest-evidence";
import { SHORTLIST_CAP } from "@/lib/sourcing/engine";
import { mapApifyCandidates } from "@/lib/store/sourcing-helpers";
import {
  mapGithubCandidates,
  mapWebSearchCandidates,
  type CandidateMappingCampaign,
} from "@/lib/sourcing/candidate-mappers";
import { applyLiveEngineGate } from "@/lib/sourcing/live-shortlist";
import { isPeopleFirstContactComplete } from "@/lib/sourcing/people-first-contact";
export const SOURCING_TOOL_DEFS: McpTool[] = [
  {
    name: "search_candidates",
    description:
      "Search ONE platform for real candidates matching this role, already deduped and scored " +
      "against the job description. Returns real people found via that platform's real search " +
      "(LinkedIn site-scoped web search, Apify harvestapi, or GitHub Search API) — never fabricated. " +
      "Call LinkedIn and Apify first for people who have the skills; GitHub only for real " +
      "programming-language queries. Call it once per platform worth checking; call it again with " +
      "a different query on the same platform to broaden a search that returned too few good matches.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["GitHub", "LinkedIn", "Apify", "Stack Overflow", "Dribbble", "Behance"],
          description: "Which platform to search. LinkedIn + Apify first for trading-platform needs.",
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
  contactCompleteCount?: number;
  harvest?: HarvestEvidence;
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
  apifyToken?: string,
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
    const requested = Math.trunc(Number(args.count)) || (platform === "Apify" ? 8 : 5);
    const count =
      platform === "Apify"
        ? Math.min(Math.max(requested, 1), SHORTLIST_CAP)
        : Math.min(Math.max(requested, 1), 10);
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
    let harvestEvidence: HarvestEvidence | undefined;
    let rawHarvestCount = -1;
    let contactCompleteCount: number | undefined;

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
    } else if (platform === "Apify") {
      if (!apifyToken) {
        executions.push({
          platform,
          query,
          ok: false,
          candidateCount: 0,
          skippedCount: 0,
          harvest: {
            actor: HARVEST_ACTOR,
            query,
            runId: "",
            status: "NOT_STARTED",
            itemCount: -1,
            started: false,
          },
        });
        return { ok: false, error: "Connect an Apify key in Settings first." };
      }
      try {
        const clearance = clearDiscoveryCriteria(platform, { searchQuery: query }, campaign);
        if (!clearance.ok) {
          executions.push({
            platform,
            query,
            ok: false,
            candidateCount: 0,
            skippedCount: 0,
            harvest: {
              actor: HARVEST_ACTOR,
              query,
              runId: "",
              status: "NOT_STARTED",
              itemCount: -1,
              started: false,
            },
          });
          return clearance;
        }
        const profiles = await runProfileSearchAndWait(
          clearance.clearance,
          apifyToken,
          {
            searchQuery: query,
            // Short mode has no headline/about/skills — finance ≥60 skill-match cannot hold.
            profileScraperMode: "Full",
            maxItems: count,
          },
          { timeoutMs: APIFY_HARVEST_WAIT_MS, signal },
        );
        if (!profiles.ok) {
          executions.push({
            platform,
            query,
            ok: false,
            candidateCount: 0,
            skippedCount: 0,
            harvest: profiles.harvest,
          });
          return { ok: false, error: profiles.title || "Apify search failed." };
        }
        harvestEvidence = profiles.harvest;
        rawHarvestCount = profiles.data.length;
        const mapped = mapApifyCandidates(
          profiles.data,
          campaign as Campaign,
          query,
          alreadySeen as Candidate[],
          weights,
        );
        const withContacts = mapped.accepted.filter(isPeopleFirstContactComplete);
        contactCompleteCount = withContacts.length;
        skippedCount = mapped.skipped.length + (mapped.accepted.length - withContacts.length);
        accepted = withContacts;
      } catch (err) {
        executions.push({
          platform,
          query,
          ok: false,
          candidateCount: 0,
          skippedCount: 0,
          harvest: {
            actor: HARVEST_ACTOR,
            query,
            runId: "",
            status: "NOT_STARTED",
            itemCount: -1,
            started: false,
          },
        });
        return { ok: false, error: err instanceof Error ? err.message : "Apify search failed." };
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
      accepted = result.accepted;
      skippedCount = result.skipped.length;
    } else {
      return {
        ok: false,
        error: `${platform || "that platform"} has no external search — Referral/Talent Pool candidates come from the app's own pipeline, not a search.`,
      };
    }

    if (platform === "LinkedIn" || platform === "Apify") {
      const gated = applyLiveEngineGate(accepted, campaign.jobAnalysis);
      skippedCount += accepted.length - gated.length;
      accepted = gated;
    }

    found.push(...accepted);
    executions.push({
      platform,
      query,
      ok: true,
      candidateCount: accepted.length,
      skippedCount,
      ...(contactCompleteCount !== undefined ? { contactCompleteCount } : {}),
      ...(harvestEvidence
        ? {
            harvest: {
              ...harvestEvidence,
              itemCount: rawHarvestCount >= 0 ? rawHarvestCount : harvestEvidence.itemCount,
            },
          }
        : {}),
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
