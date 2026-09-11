import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import { mapWebSearchCandidates } from "@/lib/sourcing/candidate-mappers";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { WebLead } from "@/lib/sourcing/web-leads";
import {
  qualifyLeadAgainstIcp,
  searchLinkedInProfiles,
} from "@/lib/integrations/linkedin-browser-agents";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

/**
 * NightTrek LinkedIn_Agent_Tool bridge — real LinkedIn profile discovery via
 * public web_search (site:linkedin.com/in), with optional sidecar override.
 * Always available (same posture as linkedin_web). ICP qualify boosts scores
 * when public evidence overlaps the campaign role. Connect/Message stays on
 * AriaBot computers, never through this path.
 */
export const linkedinAgentToolProvider: SourcingProvider = {
  id: "linkedin_agent_tool",
  displayPlatform: "LinkedIn",
  richness: "serp",
  isAvailable() {
    return true;
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
      .filter((t) => t && !/^(AND|OR|NOT|site:linkedin\.com\/in)$/i.test(t));
    const result = await searchLinkedInProfiles({
      keywords: keywords.slice(0, 12),
      limit: Math.min(Math.max(count * 2, 5), 25),
      tavilyKey: ctx.tavilyKey,
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
      snippet: [hit.snippet, hit.title, hit.location].filter(Boolean).join(" · ").slice(0, 300),
    }));

    const mapped = mapWebSearchCandidates(
      leads,
      ctx.campaign,
      query,
      "LinkedIn",
      ctx.existing,
      ctx.weights,
    );

    const ja = ctx.campaign.jobAnalysis;
    const icp = [
      ja.title,
      ...(ja.requiredSkills ?? []).slice(0, 8),
      ...(ja.regions ?? []).slice(0, 3),
      ja.locationType,
    ]
      .filter(Boolean)
      .join(" ");

    // Boost match scores with real ICP overlap (snippet + URL); never invent leads.
    const boosted = await Promise.all(
      mapped.accepted.map(async (c) => {
        const profileUrl = c.linkedinUrl || c.sourceUrl || "";
        const hit = result.hits.find((h) => h.profileUrl === profileUrl);
        const lead = leads.find((l) => l.url === profileUrl);
        try {
          const q = await qualifyLeadAgainstIcp({
            profileUrl: hit?.profileUrl || lead?.url || profileUrl || undefined,
            snippet: hit?.snippet || lead?.snippet || `${c.currentTitle} ${c.currentCompany}`,
            icp,
          });
          if (!q.ok) return c;
          const blended = Math.round(c.matchScore * 0.7 + q.score * 0.3);
          return { ...c, matchScore: Math.max(c.matchScore, Math.min(99, blended)) };
        } catch {
          return c;
        }
      }),
    );

    const roleTitle = ctx.campaign.jobAnalysis.title.trim();
    const filtered = boosted
      .filter((c) => candidateMatchesRoleTitle(c, roleTitle))
      .filter((c) => meetsSourcingQualityBar(c, SOURCING_QUALITY_FLOOR))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, count);

    return {
      ok: true,
      accepted: filtered,
      skipped: [
        ...mapped.skipped,
        ...boosted
          .filter((c) => !filtered.some((f) => f.id === c.id))
          .map((c) => ({ name: c.name, reason: "Below quality floor or title mismatch" })),
      ],
    };
  },
};
