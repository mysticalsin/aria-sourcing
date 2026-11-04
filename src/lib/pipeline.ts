/* ============================================================================
   Pipeline overview model — pure, dependency-free.
   One row per campaign, one column per stage: how many candidates sit where
   right now (the live stage, not the funnel high-water mark).
   ========================================================================== */

import type { Campaign, CandidateStage, Candidate } from "./types";

export type PipelineStageKey =
  | "sourced"
  | "contacted"
  | "replied"
  | "interested"
  | "interview"
  | "offer"
  | "hired"
  | "out";

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  /** Underlying candidate stages counted in this column. */
  stages: CandidateStage[];
  /** Representative stage for the colour (see toneForStage). */
  tone: CandidateStage;
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { key: "sourced", label: "Sourced", stages: ["Sourced"], tone: "Sourced" },
  { key: "contacted", label: "Contacted", stages: ["Contacted"], tone: "Contacted" },
  { key: "replied", label: "Replied", stages: ["Replied"], tone: "Replied" },
  { key: "interested", label: "Interested", stages: ["Interested"], tone: "Interested" },
  { key: "interview", label: "Interview", stages: ["Booked", "Interviewed"], tone: "Interviewed" },
  { key: "offer", label: "Offer", stages: ["Offer"], tone: "Offer" },
  { key: "hired", label: "Hired", stages: ["Hired"], tone: "Hired" },
  { key: "out", label: "Out", stages: ["Not Interested", "Rejected", "Suppressed"], tone: "Rejected" },
];

export function pipelineStageFor(stage: CandidateStage): PipelineStageKey {
  return PIPELINE_STAGES.find((s) => s.stages.includes(stage))?.key ?? "out";
}

/** Campaigns no longer hiring; listed after the open ones. */
export function campaignIsClosed(c: Pick<Campaign, "status">): boolean {
  return c.status === "Filled" || c.status === "Paused";
}

export type StageBuckets = Record<PipelineStageKey, Candidate[]>;

export interface PipelineRow {
  campaign: Campaign;
  /** Candidates per column, best match first. */
  buckets: StageBuckets;
  /** Everyone not in "out". */
  inProgress: number;
  total: number;
}

function emptyBuckets(): StageBuckets {
  return Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, [] as Candidate[]])) as StageBuckets;
}

export function bucketCandidates(candidates: readonly Candidate[]): StageBuckets {
  const buckets = emptyBuckets();
  for (const c of candidates) buckets[pipelineStageFor(c.stage)].push(c);
  for (const list of Object.values(buckets)) list.sort((a, b) => b.matchScore - a.matchScore);
  return buckets;
}

/** Open campaigns first (most candidates in progress on top), closed ones last. */
export function buildPipelineRows(campaigns: readonly Campaign[], candidates: readonly Candidate[]): PipelineRow[] {
  const byCampaign = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byCampaign.get(c.campaignId);
    if (list) list.push(c);
    else byCampaign.set(c.campaignId, [c]);
  }
  return campaigns
    .map((campaign) => {
      const own = byCampaign.get(campaign.id) ?? [];
      const buckets = bucketCandidates(own);
      return { campaign, buckets, inProgress: own.length - buckets.out.length, total: own.length };
    })
    .sort(
      (a, b) =>
        Number(campaignIsClosed(a.campaign)) - Number(campaignIsClosed(b.campaign)) || b.inProgress - a.inProgress,
    );
}

export function stageTotals(rows: readonly PipelineRow[]): Record<PipelineStageKey, number> {
  const totals = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, 0])) as Record<PipelineStageKey, number>;
  for (const row of rows) for (const s of PIPELINE_STAGES) totals[s.key] += row.buckets[s.key].length;
  return totals;
}
