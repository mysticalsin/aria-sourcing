import { dedupeCandidates } from "@/lib/rules";
import { scoreCandidate } from "@/lib/scoring";
import type { GithubUser } from "@/lib/sourcing/github-identity";
import type { WebLead, WebSearchPlatform } from "@/lib/sourcing/web-leads";
import type { Campaign, Candidate, ScoringWeights } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import { genId, initialsFrom } from "@/lib/utils";

export interface SourceResult {
  accepted: Candidate[];
  skipped: { name: string; reason: string }[];
}

export type CandidateMappingCampaign = Pick<
  Campaign,
  "id" | "jobAnalysis" | "scoringWeights"
> & {
  sourcingStrategy: Pick<Campaign["sourcingStrategy"], "excludedCompanies">;
};

export function mapGithubCandidates(
  users: GithubUser[],
  campaign: CandidateMappingCampaign,
  query: string,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const allSkills = [...jd.requiredSkills, ...jd.niceToHaveSkills];
  const raw: Candidate[] = users.map((user) => {
    const name = (user.name && user.name.trim()) || user.login;
    const bio = (user.bio ?? "").trim();
    const bioLower = bio.toLowerCase();
    const matched = allSkills.filter((skill) => bioLower.includes(skill.toLowerCase()));
    const techStack = Array.from(new Set([...(user.topLanguage ? [user.topLanguage] : []), ...matched]));
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name,
      email: user.email ?? "",
      avatarInitials: initialsFrom(name),
      currentTitle: "",
      currentCompany: (user.company ?? "").replace(/^@/, "").trim(),
      location: user.location ?? "",
      timezone: "",
      linkedinUrl: "",
      githubUrl: user.htmlUrl,
      sourcePlatform: "GitHub",
      sourceQuery: query,
      matchScore: 0,
      matchBreakdown: [],
      techStack,
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity: `${user.publicRepos} public repos, ${user.followers} followers`,
      stage: "Sourced",
      lastContactedAt: null,
      outreachHistory: [],
      replyHistory: [],
      booking: null,
      complianceFlags: {
        doNotContact: false,
        suppressed: false,
        unsubscribed: false,
        gdprExportRequested: false,
        anonymized: false,
        suppressedUntil: null,
      },
      createdAt: new Date().toISOString(),
      provenance: "live",
    };
  });

  return scoreAndDedupe(raw, campaign, existing, weights);
}

export function mapWebSearchCandidates(
  leads: WebLead[],
  campaign: CandidateMappingCampaign,
  query: string,
  platform: WebSearchPlatform,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const allSkills = [...jd.requiredSkills, ...jd.niceToHaveSkills];
  const raw: Candidate[] = leads.map((lead) => {
    const haystack = `${lead.title} ${lead.snippet}`.toLowerCase();
    const techStack = allSkills.filter((skill) => haystack.includes(skill.toLowerCase()));
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name: lead.name,
      email: "",
      avatarInitials: initialsFrom(lead.name),
      currentTitle: lead.title,
      currentCompany: lead.company,
      location: "",
      timezone: "",
      linkedinUrl: platform === "LinkedIn" ? lead.url : "",
      githubUrl: "",
      sourceUrl: platform === "LinkedIn" ? undefined : lead.url,
      sourcePlatform: platform,
      sourceQuery: query,
      matchScore: 0,
      matchBreakdown: [],
      techStack,
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity: lead.snippet || `Found via ${platform} search.`,
      stage: "Sourced",
      lastContactedAt: null,
      outreachHistory: [],
      replyHistory: [],
      booking: null,
      complianceFlags: {
        doNotContact: false,
        suppressed: false,
        unsubscribed: false,
        gdprExportRequested: false,
        anonymized: false,
        suppressedUntil: null,
      },
      createdAt: new Date().toISOString(),
      provenance: "live",
    };
  });

  return scoreAndDedupe(raw, campaign, existing, weights);
}

function scoreAndDedupe(
  raw: Candidate[],
  campaign: CandidateMappingCampaign,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights,
): SourceResult {
  const { accepted, skipped } = dedupeCandidates(raw, existing, {
    excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
  });
  const scored = accepted.map((candidate) => {
    const { score, breakdown } = scoreCandidate(candidate, campaign.jobAnalysis, weights);
    return { ...candidate, matchScore: score, matchBreakdown: breakdown };
  });
  return { accepted: scored, skipped };
}
