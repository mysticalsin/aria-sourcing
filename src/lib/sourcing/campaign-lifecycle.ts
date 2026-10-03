import type { CampaignStatus } from "../types";

export function campaignAllowsLiveSourcing(status: CampaignStatus): boolean {
  return status === "Sourcing" || status === "Outreach";
}

export function campaignAllowsManualCandidateIntake(status: CampaignStatus): boolean {
  return status !== "Filled" && status !== "Paused";
}
