import type { getServerSupabase } from "@/lib/supabase/server";
import type { Campaign } from "@/lib/types";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

function isCampaign(value: unknown): value is CandidateMappingCampaign {
  const campaign = value as Partial<Campaign> | null;
  return Boolean(
    campaign &&
      typeof campaign === "object" &&
      typeof campaign.id === "string" &&
      campaign.jobAnalysis &&
      typeof campaign.jobAnalysis.title === "string" &&
      Array.isArray(campaign.jobAnalysis.requiredSkills) &&
      Array.isArray(campaign.jobAnalysis.niceToHaveSkills) &&
      campaign.scoringWeights &&
      campaign.sourcingStrategy &&
      Array.isArray(campaign.sourcingStrategy.excludedCompanies),
  );
}

export async function loadSourcingCampaign(
  session: Session,
  campaignId: string,
  workspaceId?: string,
): Promise<CandidateMappingCampaign | null> {
  const resolvedWorkspaceId = workspaceId || (await session.rpc("current_workspace_id")).data;
  if (typeof resolvedWorkspaceId !== "string" || !resolvedWorkspaceId) return null;
  const { data: row } = await session
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", resolvedWorkspaceId)
    .maybeSingle();
  const state = (row?.state && typeof row.state === "object" ? row.state : {}) as { campaigns?: unknown[] };
  const campaign = Array.isArray(state.campaigns)
    ? state.campaigns.find((item) => (item as { id?: unknown })?.id === campaignId)
    : null;
  return isCampaign(campaign) ? campaign : null;
}
