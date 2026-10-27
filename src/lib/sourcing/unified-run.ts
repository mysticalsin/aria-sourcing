import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { Campaign, HermesState } from "@/lib/types";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { mapApifyCandidates } from "@/lib/store/sourcing-helpers";
import { mapGithubCandidates, type SourceResult } from "./candidate-mappers";
import { effectiveWeights } from "@/lib/skills";
import { candidateProfileIdentity } from "@/lib/rules";
import { campaignAllowsLiveSourcing } from "./campaign-lifecycle";
import { computeCampaignMetrics, firstInterviewElapsedHours, realFunnelFacts } from "@/lib/metrics";
import { clearDiscoveryCriteria, clearIdentityResolution } from "./provider-egress";
import type { ProviderClearance } from "./provider-transport";
import type { ApifyProfile, ApifyProfileSearchInput, ApifyResult } from "./apify";
import type { GithubUser } from "./github-identity";
import { campaignSourcingBasis, jobStatus, type CampaignSourcingJob, type SourceStep } from "./unified-contract";
import { APIFY_ACCOUNT_LIMIT_ERROR, type ApifyRunStatus } from "./apify-status";

export interface SourcingWorkspace { state: HermesState; updatedAt: string }
export interface UnifiedRunRepository {
  readWorkspace(): Promise<SourcingWorkspace>;
  claim(job: CampaignSourcingJob, token: string, steps: SourceStep[]): Promise<boolean>;
  bind(job: CampaignSourcingJob, token: string, steps: SourceStep[]): Promise<void>;
  reserve(source: SourceStep["source"], key: string, campaignId: string): Promise<string>;
  settle(providerRunId: string, succeeded: boolean, externalRunId?: string, datasetId?: string): Promise<void>;
  finish(job: CampaignSourcingJob, token: string, steps: SourceStep[], workspace: SourcingWorkspace, state?: HermesState): Promise<"saved" | "conflict" | { blockedIds: string[] }>;
}
export interface UnifiedProviders {
  apifyKey(): Promise<string | null>;
  start(clearance: ProviderClearance, key: string, input: ApifyProfileSearchInput): Promise<ApifyResult<{runId: string; datasetId: string; status: string}>>;
  poll(clearance: ProviderClearance, key: string, runId: string): Promise<ApifyResult<ApifyRunStatus>>;
  items(clearance: ProviderClearance, key: string, datasetId: string, limit: number): Promise<ApifyResult<ApifyProfile[]>>;
  github(clearance: ProviderClearance, query: string, count: number, signal: AbortSignal): Promise<GithubUser[]>;
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
function addResults(state: HermesState, campaign: Campaign, result: SourceResult): HermesState {
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
  const interruptedStart = step.source === "LinkedIn" && step.status === "starting";
  if (step.status === "queued") step.status = "starting";
  const token = randomUUID();
  if (!(await repo.claim(job, token, steps))) return;

  const finish = async (map?: (state: HermesState, campaign: Campaign) => SourceResult) => {
    const erased = new Set<string>();
    const identity = (c: HermesState["candidates"][number]) => candidateProfileIdentity(c.linkedinUrl || c.githubUrl || c.sourceUrl || c.email);
    for (let attempt = 0; attempt < 4; attempt++) {
      const ws = await repo.readWorkspace();
      const campaign = currentCampaign(ws, job);
      let next: HermesState | undefined;
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
  const ws = await repo.readWorkspace();
  const campaign = currentCampaign(ws, job);
  const clearance = clearDiscoveryCriteria(step.source === "LinkedIn" ? "Apify" : "GitHub", { query: step.query }, campaign);
  if (!clearance.ok) { step.status = "failed"; step.error = clearance.error; await finish(); return; }
  if (interruptedStart) {
    step.status = "uncertain";
    step.error = "The LinkedIn start was interrupted. Check Apify runs before launching again; no paid retry was made.";
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

  const key = await providers.apifyKey();
  if (!key) { step.status = "failed"; step.error = "Connect an Apify key in Settings before searching LinkedIn."; await finish(); return; }
  if (step.status === "starting") {
    try {
      step.providerRunId = await repo.reserve(step.source, `campaign:${job.id}:linkedin`, job.campaign_id);
    } catch {
      step.status = "failed"; step.error = "The workspace daily sourcing quota is reached or unavailable."; await finish(); return;
    }
    await repo.bind(job, token, steps);
    currentCampaign(await repo.readWorkspace(), job);
    const started = await providers.start(clearance.clearance, key, { searchQuery: step.query, maxItems: step.limit, takePages: 1, profileScraperMode: "Short" });
    if (!started.ok || !started.data.runId || !started.data.datasetId) {
      // A timeout/5xx can happen after acceptance by Apify. Never retry a start.
      step.status = !started.ok && started.status >= 400 && started.status < 500 ? "failed" : "uncertain";
      step.error = step.status === "uncertain"
        ? "LinkedIn start could not be confirmed. Check Apify runs before launching again; no paid retry was made."
        : "Apify refused the search. Check its key, account credits and actor access in Settings.";
      await finish(); await repo.settle(step.providerRunId, false); return;
    }
    step.externalRunId = started.data.runId; step.datasetId = started.data.datasetId; step.status = "running";
    // Persist the external identity first, even if quota-ledger attachment fails.
    await repo.bind(job, token, steps);
    await repo.settle(step.providerRunId, true, step.externalRunId, step.datasetId);
    await finish(); return;
  }
  if (!step.externalRunId || !step.datasetId) throw new Error("LinkedIn run binding is unavailable.");
  const identity = clearIdentityResolution("Apify", { runId: step.externalRunId, datasetId: step.datasetId });
  if (!identity.ok) throw new Error("LinkedIn run binding is invalid.");
  const polled = await providers.poll(identity.clearance, key, step.externalRunId);
  if (!polled.ok) {
    // Transient polling errors retain the provider binding for a safe resume.
    step.error = "Apify status is temporarily unavailable. Resume this run; no new actor will be started.";
    await finish(); return;
  }
  delete step.error;
  if (polled.data.blockedReason === "account_limit") {
    step.status = "failed"; step.error = APIFY_ACCOUNT_LIMIT_ERROR;
    await finish(); if (step.providerRunId) await repo.settle(step.providerRunId, false); return;
  }
  if (["FAILED", "TIMED-OUT", "ABORTED"].includes(polled.data.status)) {
    step.status = "failed"; step.error = `Apify run ${polled.data.status.toLowerCase()}. Check its run log.`;
    await finish(); if (step.providerRunId) await repo.settle(step.providerRunId, false); return;
  }
  if (polled.data.status !== "SUCCEEDED") { await finish(); return; }
  currentCampaign(await repo.readWorkspace(), job);
  const items = await providers.items(identity.clearance, key, step.datasetId, step.limit);
  if (!items.ok) { step.error = "LinkedIn results are temporarily unavailable. Resume to retrieve the same dataset."; await finish(); return; }
  const profiles = items.data.slice(0, step.limit);
  step.found = profiles.length; step.status = "completed";
  await finish((state, c) => mapApifyCandidates(profiles, c, step.query, state.candidates, effectiveWeights(c.scoringWeights, state.skills)));
  if (step.providerRunId) await repo.settle(step.providerRunId, true);
}

export { jobStatus };
