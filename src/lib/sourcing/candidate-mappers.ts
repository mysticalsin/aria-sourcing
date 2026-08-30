import { dedupeCandidates } from "@/lib/rules";
import { scoreCandidate, selectTopKByMatchScore, SHORTLIST_TOP_K_MAX } from "@/lib/scoring";
import { eligibleForShortlist, SOURCING_QUALITY_FLOOR } from "@/lib/sourcing/candidate-fit";
import { passesHardGates } from "@/lib/sourcing/hard-gates";
import type { ApolloSearchProfile } from "@/lib/sourcing/apollo";
import type { GithubUser } from "@/lib/sourcing/github-identity";
import type { SeamlessContact } from "@/lib/sourcing/seamless";
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

export function mapApolloCandidates(
  people: ApolloSearchProfile[],
  campaign: CandidateMappingCampaign,
  query: string,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const allSkills = [...jd.requiredSkills, ...jd.niceToHaveSkills];
  const raw: Candidate[] = people.map((person) => {
    const headline = (person.headline || person.title || "").toLowerCase();
    const matched = allSkills.filter((skill) => headline.includes(skill.toLowerCase()));
    const location = [person.city, person.state, person.country].filter(Boolean).join(", ");
    const recentActivity = person.seniority
      ? `${person.seniority}${person.departments.length ? ` · ${person.departments.join(", ")}` : ""}`
      : "Apollo profile";
    return {
      id: person.candidateId,
      campaignId: campaign.id,
      name: person.name,
      email: "",
      avatarInitials: initialsFrom(person.name),
      currentTitle: person.title || "",
      currentCompany: person.company,
      location,
      timezone: "",
      linkedinUrl: person.linkedinUrl,
      githubUrl: "",
      sourceAuthorityId: person.targetId,
      sourcePlatform: "Apollo",
      sourceQuery: query,
      matchScore: 0,
      matchBreakdown: [],
      techStack: matched,
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity,
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

export function mapSeamlessCandidates(
  contacts: SeamlessContact[],
  campaign: CandidateMappingCampaign,
  query: string,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const allSkills = [...jd.requiredSkills, ...jd.niceToHaveSkills];
  const raw: Candidate[] = contacts.map((contact) => {
    const headline = (contact.title || "").toLowerCase();
    const matched = allSkills.filter((skill) => headline.includes(skill.toLowerCase()));
    const location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ");
    const recentActivity = contact.seniority
      ? `${contact.seniority}${contact.department ? ` · ${contact.department}` : ""}`
      : "Seamless profile";
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name: contact.name,
      email: "",
      avatarInitials: initialsFrom(contact.name),
      currentTitle: contact.title || "",
      currentCompany: contact.company,
      location,
      timezone: "",
      linkedinUrl: contact.liUrl,
      githubUrl: "",
      sourceExternalId: contact.searchResultId || undefined,
      sourcePlatform: "Seamless",
      sourceQuery: query,
      matchScore: 0,
      matchBreakdown: [],
      techStack: matched,
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity,
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
  const jd = campaign.jobAnalysis;
  const { accepted, skipped } = dedupeCandidates(raw, existing, {
    excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
  });
  const scored = accepted.map((candidate) => {
    const { score, breakdown, evidence } = scoreCandidate(candidate, jd, weights);
    return { ...candidate, matchScore: score, matchBreakdown: breakdown, matchEvidence: evidence };
  });
  const gateOk = scored.filter((c) => passesHardGates(c, jd));
  const quality = gateOk.filter((c) => eligibleForShortlist(c, jd, SOURCING_QUALITY_FLOOR).ok);
  return {
    accepted: selectTopKByMatchScore(quality.length > 0 ? quality : gateOk, SHORTLIST_TOP_K_MAX, jd),
    skipped: [
      ...skipped,
      ...scored
        .filter((c) => !passesHardGates(c, jd))
        .map((c) => ({
          name: c.name,
          reason: c.matchEvidence?.hardGateReasons.join("; ") || "Failed mandatory hard gates",
        })),
      ...gateOk
        .filter((c) => !eligibleForShortlist(c, jd, SOURCING_QUALITY_FLOOR).ok)
        .map((c) => ({
          name: c.name,
          reason: `Match score ${c.matchScore} below ${SOURCING_QUALITY_FLOOR}% quality floor`,
        })),
    ],
  };
}
