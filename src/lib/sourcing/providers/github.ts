import { searchGithubUsers } from "@/lib/sourcing/github";
import { mapGithubCandidates } from "@/lib/sourcing/candidate-mappers";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

export const githubProvider: SourcingProvider = {
  id: "github",
  displayPlatform: "GitHub",
  richness: "identity",
  isAvailable() {
    return true; // keyless GitHub search always available
  },
  async search({ query, count, ctx }: ProviderSearchInput): Promise<ProviderSearchResult> {
    const policy = validateSourcingQuery("GitHub", query, ctx.campaign);
    if (!policy.ok) return { ok: false, accepted: [], skipped: [], error: policy.error };
    if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
      return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
    }
    try {
      const clearance = clearDiscoveryCriteria("GitHub", { query }, ctx.campaign);
      if (!clearance.ok) return { ok: false, accepted: [], skipped: [], error: clearance.error };
      const users = await searchGithubUsers(
        clearance.clearance,
        query,
        count,
        ctx.githubToken,
        ctx.signal,
      );
      const result = mapGithubCandidates(users, ctx.campaign, query, ctx.existing, ctx.weights);
      return { ok: true, accepted: result.accepted, skipped: result.skipped };
    } catch (err) {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: err instanceof Error ? err.message : "GitHub search failed.",
      };
    }
  },
};
