import { buildPipelineRows, type PipelineRow } from "@/lib/pipeline";
import type { Campaign, Candidate } from "@/lib/types";

export interface PipelineView {
  campaigns: Campaign[];
  candidates: Candidate[];
  rows: PipelineRow[];
}

/** Live pipeline board. Rows follow the stage the candidate is in now. */
export function readPipeline(campaigns: Campaign[], candidates: Candidate[]): PipelineView {
  return {
    campaigns,
    candidates,
    rows: buildPipelineRows(campaigns, candidates),
  };
}
