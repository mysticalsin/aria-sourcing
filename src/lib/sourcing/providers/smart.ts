import "server-only";

import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import {
  searchSmartResumes,
  selectBestSmartMatches,
  SMART_DEFAULT_RANK_WINDOW,
  smartForceMock,
  smartLiveConfigured,
} from "@/lib/sourcing/smart";
import { mapSmartCandidates } from "@/lib/sourcing/smart-map";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

export const smartProvider: SourcingProvider = {
  id: "smart",
  displayPlatform: "SMART",
  richness: "profile",
  isAvailable(ctx) {
    if (smartForceMock()) return true;
    return smartLiveConfigured(ctx.smartApiKey);
  },
  async search({ query, count, ctx }: ProviderSearchInput): Promise<ProviderSearchResult> {
    const policy = validateSourcingQuery("SMART", query, ctx.campaign);
    if (!policy.ok) return { ok: false, accepted: [], skipped: [], error: policy.error };
    if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
      return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
    }

    const clearance = clearDiscoveryCriteria(
      "SMART",
      {
        title: ctx.campaign.jobAnalysis.title,
        skills: ctx.campaign.jobAnalysis.requiredSkills.slice(0, 8),
        query,
      },
      ctx.campaign,
    );
    if (!clearance.ok) return { ok: false, accepted: [], skipped: [], error: clearance.error };

    const jd = ctx.campaign.jobAnalysis;
    const rankWindow = Math.min(Math.max(count * 3, SMART_DEFAULT_RANK_WINDOW), 100);
    const searched = await searchSmartResumes(
      clearance.clearance,
      {
        title: jd.title,
        requiredSkills: jd.requiredSkills,
        niceToHaveSkills: jd.niceToHaveSkills,
        regions: jd.regions,
        keywords: query,
        limit: rankWindow,
      },
      ctx.smartApiKey,
    );
    if (!searched.ok) {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: searched.detail || searched.title || "SMART search failed.",
      };
    }

    const best = selectBestSmartMatches(searched.data.results, Math.max(count, 1));
    const mapped = mapSmartCandidates(
      best,
      ctx.campaign,
      query || jd.title,
      ctx.existing,
      ctx.weights,
    );
    return {
      ok: true,
      accepted: mapped.accepted.slice(0, count),
      skipped: mapped.skipped,
    };
  },
};
