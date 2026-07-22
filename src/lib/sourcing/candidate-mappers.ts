import { dedupeCandidates } from "@/lib/rules";
import { scoreCandidate } from "@/lib/scoring";
import type { ApolloSearchProfile } from "@/lib/sourcing/apollo";
import type { GithubUser } from "@/lib/sourcing/github";
import type { SeamlessContact } from "@/lib/sourcing/seamless";
import type { WebLead, WebSearchPlatform } from "@/lib/sourcing/web-leads";
import type { Campaign, Candidate, ScoringWeights } from "@/lib/types";
import type { CandidateDedupeIdentity } from "@/lib/rules";
import { findBoundedTextEvidence } from "@/lib/text/evidence";
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

type SkillEvidenceSource =
  | "github_bio"
  | "apollo_headline"
  | "apollo_title"
  | "seamless_title"
  | "web_title"
  | "web_snippet";

interface SkillTextSource {
  source: SkillEvidenceSource;
  text: string;
}

interface SkillEvidence {
  skill: string;
  matchedText: string;
  source: SkillEvidenceSource;
  start: number;
  end: number;
}

const SKILL_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["Go", "Golang"],
  ["Postgres", "PostgreSQL"],
];

function normalizedSkill(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function evidenceTerms(skill: string): string[] {
  const normalized = normalizedSkill(skill);
  const aliases = SKILL_ALIAS_GROUPS.find((group) =>
    group.some((alias) => normalizedSkill(alias) === normalized),
  );
  if (!aliases) return [skill];
  return [skill, ...aliases.filter((alias) => normalizedSkill(alias) !== normalized)];
}

function findSkillEvidence(
  skill: string,
  term: string,
  source: SkillTextSource,
): SkillEvidence | null {
  const match = findBoundedTextEvidence(source.text, term);
  return match ? { skill, source: source.source, ...match } : null;
}

function matchSkillEvidence(skills: string[], sources: SkillTextSource[]): SkillEvidence[] {
  const evidence: SkillEvidence[] = [];
  const seen = new Set<string>();

  for (const rawSkill of skills) {
    const skill = rawSkill.trim();
    const normalized = normalizedSkill(skill);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    let match: SkillEvidence | null = null;
    for (const term of evidenceTerms(skill)) {
      for (const source of sources) {
        match = findSkillEvidence(skill, term, source);
        if (match) break;
      }
      if (match) break;
    }
    if (match) evidence.push(match);
  }

  return evidence;
}

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
    const matched = matchSkillEvidence(allSkills, [{ source: "github_bio", text: bio }]).map(
      (evidence) => evidence.skill,
    );
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
    const headline = person.headline || person.title || "";
    const matched = matchSkillEvidence(allSkills, [
      {
        source: person.headline ? "apollo_headline" : "apollo_title",
        text: headline,
      },
    ]).map((evidence) => evidence.skill);
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
    const matched = matchSkillEvidence(allSkills, [
      { source: "seamless_title", text: contact.title || "" },
    ]).map((evidence) => evidence.skill);
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
    const techStack = matchSkillEvidence(allSkills, [
      { source: "web_title", text: lead.title },
      { source: "web_snippet", text: lead.snippet },
    ]).map((evidence) => evidence.skill);
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
