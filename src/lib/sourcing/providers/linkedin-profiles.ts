import "server-only";

import {
  fetchDatasetItems,
  getRunStatus,
  startProfileSearchRun,
  type ApifyProfileSearchInput,
} from "@/lib/sourcing/apify";
import { clearDiscoveryCriteria } from "@/lib/sourcing/provider-egress";
import { mapApifyCandidates } from "@/lib/store/sourcing-helpers";
import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import type { Campaign } from "@/lib/types";
import type { ProviderSearchInput, ProviderSearchResult, SourcingProvider } from "./types";

const POLL_MS = 3_000;
/** Full + email search needs longer than Short discovery; keep under Fly soft timeouts. */
const DEFAULT_BUDGET_MS = 150_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "TIMED_OUT"]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * LinkedIn public-profile search via the workspace's LinkedIn profile search
 * connector (Apify harvestapi under the hood). Operator-facing platform is
 * always LinkedIn — never "Apify".
 */
export const linkedinProfilesProvider: SourcingProvider = {
  id: "linkedin_profiles",
  displayPlatform: "LinkedIn",
  richness: "profile",
  isAvailable(ctx) {
    return Boolean(ctx.linkedInProfileToken?.trim());
  },
  async search({ query, count, ctx }: ProviderSearchInput): Promise<ProviderSearchResult> {
    const token = ctx.linkedInProfileToken?.trim();
    if (!token) {
      return { ok: false, accepted: [], skipped: [], error: "LinkedIn profile search is not connected." };
    }
    const policy = validateSourcingQuery("LinkedIn", query, ctx.campaign);
    if (!policy.ok) return { ok: false, accepted: [], skipped: [], error: policy.error };
    if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
      return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
    }

    const clearance = clearDiscoveryCriteria("Apify", { searchQuery: query }, ctx.campaign);
    if (!clearance.ok) return { ok: false, accepted: [], skipped: [], error: clearance.error };

    const jd = ctx.campaign.jobAnalysis;
    // Short mode returns no headline/about/skills/email — scored profiles then
    // fail the 80% quality floor and Source soft-empties. Full + email search
    // is required for Calypso BA / LinkedIn-first shortlists that stay contactable.
    const input: ApifyProfileSearchInput = {
      searchQuery: query,
      currentJobTitles: jd.title.trim() ? [jd.title.trim()] : undefined,
      locations: jd.regions.filter(Boolean).slice(0, 3),
      maxItems: Math.min(Math.max(count * 2, 10), 25),
      profileScraperMode: "Full + email search",
    };

    const started = await startProfileSearchRun(clearance.clearance, token, input);
    if (!started.ok) {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: started.detail || started.title || "LinkedIn profile search failed to start.",
      };
    }
    const { runId, datasetId } = started.data;
    if (!runId || !datasetId) {
      return { ok: false, accepted: [], skipped: [], error: "LinkedIn profile search returned no run id." };
    }

    const deadline = Date.now() + DEFAULT_BUDGET_MS;
    let status = started.data.status;
    while (!TERMINAL.has(status.toUpperCase())) {
      if (Date.now() >= deadline || ctx.signal?.aborted) {
        return { ok: false, accepted: [], skipped: [], error: "LinkedIn profile search timed out." };
      }
      if (ctx.beforeExternalCall && !(await ctx.beforeExternalCall())) {
        return { ok: false, accepted: [], skipped: [], error: "Sourcing authority changed." };
      }
      try {
        await sleep(POLL_MS, ctx.signal);
      } catch {
        return { ok: false, accepted: [], skipped: [], error: "LinkedIn profile search aborted." };
      }
      const polled = await getRunStatus(clearance.clearance, token, runId);
      if (!polled.ok) {
        return {
          ok: false,
          accepted: [],
          skipped: [],
          error: polled.detail || polled.title || "LinkedIn profile search status failed.",
        };
      }
      status = polled.data.status;
    }

    if (status.toUpperCase() !== "SUCCEEDED") {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: `LinkedIn profile search ended with status ${status}.`,
      };
    }

    const items = await fetchDatasetItems(
      clearance.clearance,
      token,
      datasetId,
      Math.min(Math.max(count * 2, 10), 50),
    );
    if (!items.ok) {
      return {
        ok: false,
        accepted: [],
        skipped: [],
        error: items.detail || items.title || "LinkedIn profile fetch failed.",
      };
    }

    // mapApifyCandidates expects a Campaign-shaped object; SourcingAgentCampaign is compatible.
    const campaign = ctx.campaign as unknown as Campaign;
    const mapped = mapApifyCandidates(items.data, campaign, query, [], ctx.weights, {
      displayPlatform: "LinkedIn",
    });
    const roleTitle = jd.title.trim();
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
