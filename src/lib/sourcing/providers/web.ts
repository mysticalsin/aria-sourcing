import { runWebTool } from "@/lib/ai/web-tools";
import { mapWebSearchCandidates } from "@/lib/sourcing/candidate-mappers";
import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import { ensureWebQueryScope, extractLead, type WebSearchPlatform } from "@/lib/sourcing/web-leads";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

function makeWebProvider(
  id: SourcingProvider["id"],
  platform: WebSearchPlatform,
): SourcingProvider {
  return {
    id,
    displayPlatform: platform,
    richness: "serp",
    isAvailable() {
      return true;
    },
    async search({ query, count, ctx }: ProviderSearchInput): Promise<ProviderSearchResult> {
      const policy = validateSourcingQuery(platform, query, ctx.campaign);
      if (!policy.ok) return { ok: false, accepted: [], skipped: [], error: policy.error };
      if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
        return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
      }
      const scopedQuery = ensureWebQueryScope(platform, query);
      const search = await runWebTool(
        "web_search",
        { query: scopedQuery },
        { tavilyKey: ctx.tavilyKey, fetchImpl: ctx.webFetchImpl },
      );
      if (!search.ok) {
        return { ok: false, accepted: [], skipped: [], error: search.error ?? "Web search failed." };
      }
      const content = search.content as
        | { results?: { title: string; url: string; snippet: string }[] }
        | undefined;
      const hits = (content?.results ?? []).slice(0, Math.max(count * 4, 16));
      const leads = hits.map((h) => extractLead(h, platform));
      const result = mapWebSearchCandidates(
        leads,
        ctx.campaign,
        scopedQuery,
        platform,
        ctx.existing,
        ctx.weights,
      );
      const roleTitle = ctx.campaign.jobAnalysis.title.trim();
      const filtered = result.accepted
        .filter((c) => candidateMatchesRoleTitle(c, roleTitle))
        .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR))
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, count);
      return {
        ok: true,
        accepted: filtered,
        skipped: [
          ...result.skipped,
          ...result.accepted
            .filter((c) => !filtered.some((f) => f.id === c.id))
            .map((c) => ({ name: c.name, reason: "Below quality floor or title mismatch" })),
        ],
      };
    },
  };
}

export const linkedinWebProvider = makeWebProvider("linkedin_web", "LinkedIn");
export const stackOverflowProvider = makeWebProvider("stackoverflow", "Stack Overflow");
export const dribbbleProvider = makeWebProvider("dribbble", "Dribbble");
export const behanceProvider = makeWebProvider("behance", "Behance");
