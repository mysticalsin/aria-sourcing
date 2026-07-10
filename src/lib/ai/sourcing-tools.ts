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
import type { Campaign, Candidate, ScoringWeights, SourcePlatform } from "@/lib/types";
import { searchGithubUsers } from "@/lib/sourcing/github";
import { runWebTool } from "@/lib/ai/web-tools";
import { ensureWebQueryScope, extractLead, isWebSearchPlatform } from "@/lib/sourcing/web-leads";
import { mapGithubCandidates, mapWebSearchCandidates } from "@/lib/mock-ai";

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

/**
 * Build a stateful search_candidates runner bound to one campaign/request.
 * `run` dispatches the tool call; `getFound()` returns every real, scored
 * Candidate accumulated across all calls made during the loop — the
 * authoritative record the caller should use, not the model's prose.
 */
export function makeSourcingToolRunner(
  campaign: Campaign,
  existing: Candidate[],
  weights: ScoringWeights,
  githubToken: string,
  tavilyKey?: string,
) {
  const found: Candidate[] = [];

  async function run(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content?: unknown; error?: string }> {
    if (name !== "search_candidates") return { ok: false, error: "Unknown tool." };

    const platform = String(args.platform ?? "").trim() as SourcePlatform;
    const query = String(args.query ?? "").trim().slice(0, 256);
    const count = Math.min(Math.max(Math.trunc(Number(args.count)) || 5, 1), 10);
    if (!platform) return { ok: false, error: "Missing platform." };
    if (!query) return { ok: false, error: "Missing query." };

    const alreadySeen = [...existing, ...found];
    let accepted: Candidate[] = [];
    let skippedCount = 0;

    if (platform === "GitHub") {
      try {
        const users = await searchGithubUsers(query, count, githubToken);
        const result = mapGithubCandidates(users, campaign, query, alreadySeen, weights);
        accepted = result.accepted;
        skippedCount = result.skipped.length;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "GitHub search failed." };
      }
    } else if (isWebSearchPlatform(platform)) {
      const scopedQuery = ensureWebQueryScope(platform, query);
      const search = await runWebTool("web_search", { query: scopedQuery }, { tavilyKey });
      if (!search.ok) return { ok: false, error: search.error ?? "Web search failed." };
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

    found.push(...accepted);
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

  return { run, getFound: (): Candidate[] => found };
}
