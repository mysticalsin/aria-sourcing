import { z } from "zod";
import type { Campaign } from "@/lib/types";

export const SourceChoiceSchema = z.object({
  source: z.enum(["LinkedIn", "GitHub"]),
  query: z.string().trim().min(1).max(256),
  limit: z.number().int().min(1).max(20),
}).strict();
export const SourcePlanSchema = z.array(SourceChoiceSchema).min(1).max(2)
  .refine((sources) => new Set(sources.map((s) => s.source)).size === sources.length);
export type SourceChoice = z.infer<typeof SourceChoiceSchema>;
export type SourceStep = SourceChoice & {
  status: "queued" | "starting" | "running" | "completed" | "failed" | "uncertain";
  found: number; added: number; duplicates: number; excluded: number;
  error?: string;
  // Server-owned provider binding; never accepted in a browser request.
  providerRunId?: string; externalRunId?: string; datasetId?: string;
};
export interface CampaignSourcingJob {
  id: string; workspace_id: string; actor_id: string; campaign_id: string;
  campaign_snapshot: Record<string, unknown>;
  status: "active" | "completed" | "partial" | "failed";
  steps: SourceStep[]; revision: number;
  claim_token: string | null; claim_until: string | null;
  created_at: string;
}
export function campaignSourcingBasis(campaign: Campaign): Record<string, unknown> {
  return { jobAnalysis: campaign.jobAnalysis, scoringWeights: campaign.scoringWeights,
    sourcingStrategy: campaign.sourcingStrategy, status: campaign.status };
}
export function orderedSteps(plan: SourceChoice[]): SourceStep[] {
  return [...plan].sort((a, b) => Number(b.source === "LinkedIn") - Number(a.source === "LinkedIn"))
    .map((s) => ({ ...s, status: "queued", found: 0, added: 0, duplicates: 0, excluded: 0 }));
}
export function jobStatus(steps: SourceStep[]): CampaignSourcingJob["status"] {
  if (steps.some((s) => ["queued", "starting", "running"].includes(s.status))) return "active";
  if (steps.every((s) => s.status === "completed")) return "completed";
  return steps.some((s) => s.status === "completed") ? "partial" : "failed";
}
export function publicSourcingJob(job: CampaignSourcingJob, actorId: string, administrator = false) {
  return { id: job.id, campaignId: job.campaign_id, status: job.status,
    createdAt: job.created_at, canAdvance: job.actor_id === actorId, canClose: administrator || job.actor_id === actorId,
    steps: job.steps.map(({ source, query, limit, status, found, added, duplicates, excluded, error }) =>
      ({ source, query, limit, status, found, added, duplicates, excluded, error })) };
}
export type PublicSourcingJob = ReturnType<typeof publicSourcingJob>;
