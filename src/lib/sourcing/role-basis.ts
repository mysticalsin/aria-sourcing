import type { SourcingAgentCampaign } from "@/lib/sourcing/sourcing-agent-contract";
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";

/** One canonical role basis keeps learning lookup and sourcing-run binding on
 * the same exact-role fingerprint across framework and provider boundaries. */
export function sourcingRoleBasisForCampaign(campaign: SourcingAgentCampaign) {
  const seen = new Set<string>();
  const skills = tokenizeMustHaveSkills([
    ...campaign.jobAnalysis.requiredSkills,
    ...campaign.jobAnalysis.niceToHaveSkills,
  ]).filter((skill) => {
      const key = skill.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const region =
    campaign.jobAnalysis.location?.trim() ||
    campaign.jobAnalysis.regions.find((value) => value.trim())?.trim() ||
    "";
  const timezone = campaign.jobAnalysis.timezone.trim();
  return {
    title: campaign.jobAnalysis.title.trim(),
    seniority: campaign.jobAnalysis.seniority,
    employmentType: campaign.jobAnalysis.employmentType,
    locationType: campaign.jobAnalysis.locationType,
    ...(region ? { region } : {}),
    ...(timezone ? { timezone } : {}),
    skills,
  };
}
