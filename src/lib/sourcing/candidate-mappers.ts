import { dedupeCandidates } from "@/lib/rules";
import { scoreCandidate } from "@/lib/scoring";
import type { ApolloSearchProfile } from "@/lib/sourcing/apollo";
import {
  candidateMatchesRoleTitle,
  meetsSourcingQualityBar,
  SOURCING_QUALITY_FLOOR,
} from "@/lib/sourcing/candidate-fit";
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
  const queryLanguages = Array.from(
    query.matchAll(/\blanguage:([^\s]+)/gi),
    (match) => match[1]!.replace(/["']/g, "").trim(),
  ).filter(Boolean);
  const raw: Candidate[] = users.map((user) => {
    const name = (user.name && user.name.trim()) || user.login;
    const bio = (user.bio ?? "").trim();
    const bioLower = bio.toLowerCase();
    const matched = allSkills.filter((skill) => bioLower.includes(skill.toLowerCase()));
    const techStack = Array.from(
      new Set(
        [
          ...(user.topLanguage ? [user.topLanguage] : []),
          ...queryLanguages,
          ...matched,
        ].filter(Boolean),
      ),
    );
    const activityParts = [
      bio || null,
      `${user.publicRepos} public repos, ${user.followers} followers`,
    ].filter(Boolean);
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name,
      email: user.email ?? "",
      avatarInitials: initialsFrom(name),
      // Never promote GitHub bio into currentTitle — operators must not see a fabricated job title.
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
      // Bio belongs in recentActivity so skills/activity scoring can clear the 80% floor.
      recentActivity: activityParts.join(" · "),
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
    const techStack = allSkills.filter((skill) => {
      const needle = skill.toLowerCase().trim();
      if (!needle) return false;
      if (haystack.includes(needle)) return true;
      const tokens = needle
        .split(/[^a-z0-9+.#]+/i)
        .filter((t) => t.length > 2 && !["and", "the", "for", "with", "software", "systems"].includes(t));
      if (tokens.length === 0) return false;
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      return hits >= Math.max(1, Math.ceil(tokens.length * 0.6));
    });
    const location =
      jd.regions.find((region) => {
        const r = region.toLowerCase().trim();
        return r.length > 1 && haystack.includes(r);
      }) ??
      (/montr[eé]al/i.test(haystack)
        ? "Montreal"
        : /\bquebec\b|\bqu[eé]bec\b/i.test(haystack)
          ? "Quebec"
          : /\bcanada\b/i.test(haystack)
            ? "Canada"
            : "");
    const industryExperience = inferIndustryFromText(haystack, jd.industryExperience);
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name: lead.name,
      email: "",
      avatarInitials: initialsFrom(lead.name),
      currentTitle: lead.title,
      currentCompany: lead.company,
      location,
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
      industryExperience,
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

  const roleTitle = jd.title.trim();
  const titleMatched = raw.filter((candidate) => candidateMatchesRoleTitle(candidate, roleTitle));
  const titleSkipped = raw
    .filter((candidate) => !candidateMatchesRoleTitle(candidate, roleTitle))
    .map((candidate) => ({
      name: candidate.name,
      reason: `Title "${candidate.currentTitle}" does not match role "${roleTitle}".`,
    }));

  const scored = scoreAndDedupe(titleMatched, campaign, existing, weights);
  return {
    accepted: scored.accepted,
    skipped: [...titleSkipped, ...scored.skipped],
  };
}

/** Map JD industry targets onto SERP text when structured fields are absent. */
function inferIndustryFromText(haystack: string, targets: string[]): string[] {
  if (targets.length === 0) return [];
  return targets.filter((target) => {
    const needle = target.toLowerCase().trim();
    if (!needle) return false;
    if (haystack.includes(needle)) return true;
    if (/healthtech|health\s*tech|healthcare|medical device|pharma|fda|iso\s*13485/i.test(haystack)) {
      return /health|medical|pharma|life sciences/i.test(target);
    }
    if (/fintech|finance|financial|trading|murex|capital markets|bank/i.test(haystack)) {
      return /fin|banking|capital|trading/i.test(target);
    }
    return false;
  });
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
  const scored = accepted
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(candidate, campaign.jobAnalysis, weights);
      return { ...candidate, matchScore: score, matchBreakdown: breakdown };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
  const qualityAccepted = scored.filter((candidate) =>
    meetsSourcingQualityBar(candidate, SOURCING_QUALITY_FLOOR),
  );
  const qualitySkipped = scored
    .filter((candidate) => !meetsSourcingQualityBar(candidate, SOURCING_QUALITY_FLOOR))
    .map((candidate) => ({
      name: candidate.name,
      reason: `Match score ${candidate.matchScore} is below the ${SOURCING_QUALITY_FLOOR}% sourcing quality floor.`,
    }));
  return { accepted: qualityAccepted, skipped: [...qualitySkipped, ...skipped] };
}
