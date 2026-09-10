import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import { mapWebSearchCandidates } from "@/lib/sourcing/candidate-mappers";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { WebLead } from "@/lib/sourcing/web-leads";
import { searchLinkedInProfiles } from "@/lib/integrations/linkedin-browser-agents";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

function enabled(flag: string): boolean {
  return process.env[flag] === "1" || process.env[flag] === "true";
}

/**
 * NightTrek LinkedIn_Agent_Tool bridge — optional metadata search for sourcing
 * batches. Fail-closed unless ARIA_LINKEDIN_AGENT_TOOL_ENABLED=1. LinkedIn
 * Connect/Message still runs on AriaBot computers, never through this path.
 */
export const linkedinAgentToolProvider: SourcingProvider = {
  id: "linkedin_agent_tool",
  displayPlatform: "LinkedIn",
  richness: "serp",
  isAvailable() {
    return enabled("ARIA_LINKEDIN_AGENT_TOOL_ENABLED");
  },
  async search({ query, count, ctx }: ProviderSearchInput): Promise<ProviderSearchResult> {
    const policy = validateSourcingQuery("LinkedIn", query, ctx.campaign);
    if (!policy.ok) return { ok: false, accepted: [], skipped: [], error: policy.error };
    if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
      return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
    }

    const keywords = query
      .split(/[\s]+/)
      .map((t) => t.trim())
      .filter((t) => t && !/^(AND|OR|NOT)$/i.test(t));
    const result = await searchLinkedInProfiles({
      keywords: keywords.slice(0, 12),
      limit: Math.min(Math.max(count * 2, 5), 25),
    });
    if (!result.ok) {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: result.detail ?? "LinkedIn agent tool search failed.",
      };
    }

    const leads: WebLead[] = result.hits.map((hit) => ({
      name: hit.name?.trim() || "Unknown",
      title: hit.title?.trim() || "",
      company: "",
      url: hit.profileUrl,
      snippet: [hit.title, hit.location].filter(Boolean).join(" · "),
    }));

    const mapped = mapWebSearchCandidates(
      leads,
      ctx.campaign,
      query,
      "LinkedIn",
      ctx.existing,
      ctx.weights,
    );
    const roleTitle = ctx.campaign.jobAnalysis.title.trim();
    const filtered = mapped.accepted
      .filter((c) => candidateMatchesRoleTitle(c, roleTitle))
      .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, count);

    return {
      ok: true,
      accepted: filtered,
      skipped: [
        ...mapped.skipped,
        ...mapped.accepted
          .filter((c) => !filtered.some((f) => f.id === c.id))
          .map((c) => ({ name: c.name, reason: "Below quality floor or title mismatch" })),
      ],
    };
  },
};
