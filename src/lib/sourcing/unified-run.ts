import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { Campaign, WorkspaceState } from "@/lib/types";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { mapGithubCandidates, mapWebSearchCandidates, type SourceResult } from "./candidate-mappers";
import { extractLead, type SearchHit } from "./web-leads";
import { linkedInProfileUrl, publicIdFromProfileUrl } from "@/lib/linkedin-profile-url";

/** Stored profile URL only. This does not fetch linkedin.com. */
function canonicalLinkedInProfileUrl(raw: string): string | null {
  const id = publicIdFromProfileUrl(raw);
  return id ? linkedInProfileUrl(id) : null;
}
import { effectiveWeights } from "@/lib/skills";
import { candidateProfileIdentity } from "@/lib/rules";
import { campaignAllowsLiveSourcing } from "./campaign-lifecycle";
import { computeCampaignMetrics, firstInterviewElapsedHours, realFunnelFacts } from "@/lib/metrics";
import { clearDiscoveryCriteria, clearWebSearchDiscovery } from "./provider-egress";
import type { ProviderClearance } from "./provider-transport";
import type { GithubUser } from "./github-identity";
import { campaignSourcingBasis, jobStatus, type CampaignSourcingJob, type SourceChoice, type SourceStep } from "./unified-contract";

export interface SourcingWorkspace { state: WorkspaceState; updatedAt: string }
export interface UnifiedRunRepository {
  readWorkspace(): Promise<SourcingWorkspace>;
  claim(job: CampaignSourcingJob, token: string, steps: SourceStep[]): Promise<boolean>;
  bind(job: CampaignSourcingJob, token: string, steps: SourceStep[]): Promise<void>;
  reserve(source: SourceChoice["source"], key: string, campaignId: string): Promise<string>;
  settle(providerRunId: string, succeeded: boolean, externalRunId?: string, datasetId?: string): Promise<void>;
  finish(job: CampaignSourcingJob, token: string, steps: SourceStep[], workspace: SourcingWorkspace, state?: WorkspaceState): Promise<"saved" | "conflict" | { blockedIds: string[] }>;
}
export interface UnifiedProviders {
  github(clearance: ProviderClearance, query: string, count: number, signal: AbortSignal): Promise<GithubUser[]>;
  /** Claude web search over public LinkedIn profiles; resolves the key and records spend. */
  webSearch(clearance: ProviderClearance, query: string, count: number, campaign: Campaign, signal: AbortSignal): Promise<{ ok: true; hits: SearchHit[] } | { ok: false; error: string }>;
}
export function reviewedCampaign(workspace: SourcingWorkspace, id: string): Campaign {
  const campaign = workspace.state.campaigns.find((c) => c.id === id);
  if (!campaign || !campaignAllowsLiveSourcing(campaign.status) || !evaluateNeedReadiness(campaign.jobAnalysis).ready) {
    throw new Error("Complete and review an active campaign brief before sourcing.");
  }
  return campaign;
}
function currentCampaign(workspace: SourcingWorkspace, job: CampaignSourcingJob): Campaign {
  const campaign = reviewedCampaign(workspace, job.campaign_id);
  if (!isDeepStrictEqual(campaignSourcingBasis(campaign), job.campaign_snapshot)) {
    throw new Error("The campaign brief changed. Close this run and review a new search.");
  }
  return campaign;
}
function addResults(state: WorkspaceState, campaign: Campaign, result: SourceResult): WorkspaceState {
  const candidates = [...result.accepted, ...state.candidates];
  const next = { ...state, candidates };
  return { ...next, campaigns: state.campaigns.map((c) => c.id !== campaign.id ? c : { ...c,
    metrics: computeCampaignMetrics(candidates.filter((p) => p.campaignId === c.id), c.metrics,
      firstInterviewElapsedHours(state.bookings.filter((b) => b.campaignId === c.id), c.createdAt),
      realFunnelFacts(next, { live: !state.settings.dryRunMode, campaignId: c.id })) }) };
}
/** Advance at most one source operation. All paid starts are durably marked
 * before egress; an expired/ambiguous start is never automatically retried. */
export async function advanceUnifiedRun(job: CampaignSourcingJob, repo: UnifiedRunRepository, providers: UnifiedProviders, now = Date.now()): Promise<void> {
  if (job.status !== "active" || (job.claim_until && Date.parse(job.claim_until) > now)) return;
  const index = job.steps.findIndex((s) => ["queued", "starting", "running"].includes(s.status));
  if (index < 0) return;
  const steps = structuredClone(job.steps);
  const step = steps[index];
  // Paid starts are never repeated: an interrupted web search was billed.
  const interruptedStart = step.source === "WebSearch" && step.status === "starting";
  if (step.status === "queued") step.status = "starting";
  const token = randomUUID();
  if (!(await repo.claim(job, token, steps))) return;

  const finish = async (map?: (state: WorkspaceState, campaign: Campaign) => SourceResult) => {
    const erased = new Set<string>();
    const identity = (c: WorkspaceState["candidates"][number]) => candidateProfileIdentity(c.linkedinUrl || c.githubUrl || c.sourceUrl || c.email);
    for (let attempt = 0; attempt < 4; attempt++) {
      const ws = await repo.readWorkspace();
      const campaign = currentCampaign(ws, job);
      let next: WorkspaceState | undefined;
      if (map) {
        const mapped = map(ws.state, campaign);
        const blocked = mapped.accepted.filter((c) => erased.has(identity(c)));
        mapped.accepted = mapped.accepted.filter((c) => !erased.has(identity(c)));
        mapped.skipped.push(...blocked.map((c) => ({ name: c.name, reason: "Erased identity" })));
        mapped.accepted = mapped.accepted.map((c) => ({ ...c, sourceRunId: job.id }));
        step.added = mapped.accepted.length;
        step.duplicates = mapped.skipped.filter((s) => s.reason.startsWith("Duplicate")).length;
        step.excluded = mapped.skipped.length - step.duplicates;
        next = addResults(ws.state, campaign, mapped);
      }
      const result = await repo.finish(job, token, steps, ws, next);
      if (result === "saved") return;
      if (typeof result === "object" && next) {
        for (const c of next.candidates) if (result.blockedIds.includes(c.id)) erased.add(identity(c));
      }
    }
    // The lease expires and a later poll can safely refetch read-only results.
    throw new Error("Workspace changed repeatedly. Resume this run to save its results.");
  };
  if (step.source === "LinkedIn") {
    // A step saved before Apify was retired: it ends here, nothing is called.
    step.status = "failed";
    step.error = "LinkedIn search through Apify was removed. Start a new run with LinkedIn via web search.";
    await finish(); return;
  }
  const ws = await repo.readWorkspace();
  const campaign = currentCampaign(ws, job);
  const clearance = step.source === "WebSearch"
    ? clearWebSearchDiscovery({ query: step.query }, campaign)
    : clearDiscoveryCriteria("GitHub", { query: step.query }, campaign);
  if (!clearance.ok) { step.status = "failed"; step.error = clearance.error; await finish(); return; }
  if (interruptedStart) {
    step.status = "uncertain";
    step.error = "The web search was interrupted before its results were saved. Start a new run to search again; no paid retry was made.";
    await finish(); return;
  }

  if (step.source === "GitHub") {
    let users: GithubUser[];
    try {
      step.providerRunId ??= await repo.reserve(step.source, `campaign:${job.id}:github`, job.campaign_id);
      await repo.bind(job, token, steps);
      // Recheck immediately before provider access; the route also checks role.
      currentCampaign(await repo.readWorkspace(), job);
      users = (await providers.github(clearance.clearance, step.query, step.limit, AbortSignal.timeout(45_000))).slice(0, step.limit);
    } catch {
      step.status = "failed"; step.error = "GitHub search failed or its daily quota was reached. Check the connection and retry with a new run.";
      if (step.providerRunId) await repo.settle(step.providerRunId, false);
      await finish(); return;
    }
    step.found = users.length; step.status = "completed";
    await finish((state, c) => mapGithubCandidates(users, c, step.query, state.candidates, effectiveWeights(c.scoringWeights, state.skills)));
    if (step.providerRunId) await repo.settle(step.providerRunId, true);
    return;
  }

  if (step.source === "WebSearch") {
    try {
      step.providerRunId = await repo.reserve(step.source, `campaign:${job.id}:websearch`, job.campaign_id);
    } catch {
      step.status = "failed"; step.error = "The workspace daily sourcing quota is reached or unavailable."; await finish(); return;
    }
    await repo.bind(job, token, steps);
    let outcome: Awaited<ReturnType<UnifiedProviders["webSearch"]>>;
    try {
      outcome = await providers.webSearch(clearance.clearance, step.query, step.limit, currentCampaign(await repo.readWorkspace(), job), AbortSignal.timeout(120_000));
    } catch {
      outcome = { ok: false, error: "Web search failed. Check the Anthropic key in Settings and start a new run." };
    }
    if (!outcome.ok) {
      step.status = "failed"; step.error = outcome.error;
      await finish(); await repo.settle(step.providerRunId, false); return;
    }
    // The adapter keeps only LinkedIn profile URLs; recheck here so no other
    // scheme or host can ever become a candidate's profile link.
    const leads = outcome.hits.flatMap((hit) => {
      const url = canonicalLinkedInProfileUrl(hit.url);
      return url ? [extractLead({ ...hit, url }, "LinkedIn")] : [];
    });
    const unsafe = outcome.hits.length - leads.length;
    step.found = outcome.hits.length; step.status = "completed";
    await finish((state, c) => {
      const mapped = mapWebSearchCandidates(leads, c, step.query, "LinkedIn", state.candidates, effectiveWeights(c.scoringWeights, state.skills));
      for (let i = 0; i < unsafe; i++) mapped.skipped.push({ name: "", reason: "Not a LinkedIn profile URL" });
      return mapped;
    });
    await repo.settle(step.providerRunId, true);
    return;
  }
}

export { jobStatus };
