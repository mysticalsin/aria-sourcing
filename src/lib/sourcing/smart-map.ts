/**
 * Map SMART resume/OCR hits → ARIA Candidate (provenance live, platform SMART).
 */

import { dedupeCandidates, type CandidateDedupeIdentity } from "@/lib/rules";
import { scoreCandidate } from "@/lib/scoring";
import type { SmartResumeHit } from "@/lib/sourcing/smart-contract";
import type { CandidateMappingCampaign, SourceResult } from "@/lib/sourcing/candidate-mappers";
import type { Candidate, ScoringWeights } from "@/lib/types";
import { genId, initialsFrom } from "@/lib/utils";

function skillsFromOcr(hit: SmartResumeHit, wanted: string[]): string[] {
  const hay = `${hit.ocrText} ${hit.skills.join(" ")} ${hit.currentTitle} ${hit.experience.join(" ")}`.toLowerCase();
  const fromWanted = wanted.filter((s) => hay.includes(s.toLowerCase()));
  const fromHit = hit.skills.filter(Boolean);
  return Array.from(new Set([...fromHit, ...fromWanted])).slice(0, 40);
}

function activityFromHit(hit: SmartResumeHit): string {
  const snippet = hit.ocrText.replace(/\s+/g, " ").trim().slice(0, 180);
  if (snippet) return snippet;
  if (hit.experience[0]) return hit.experience[0];
  return hit.currentTitle || "Sourced from SMART resume database.";
}

export function mapSmartCandidates(
  hits: SmartResumeHit[],
  campaign: CandidateMappingCampaign,
  query: string,
  existing: CandidateDedupeIdentity[],
  weights: ScoringWeights = campaign.scoringWeights,
): SourceResult {
  const jd = campaign.jobAnalysis;
  const allSkills = [...jd.requiredSkills, ...jd.niceToHaveSkills];
  const at = new Date().toISOString();

  const raw: Candidate[] = hits.map((hit) => {
    const name =
      [hit.firstName, hit.lastName].filter(Boolean).join(" ").trim() || "Unknown";
    const techStack = skillsFromOcr(hit, allSkills);
    const industryExperience = jd.industryExperience.filter((ind) => {
      const needle = ind.toLowerCase();
      return `${hit.ocrText} ${hit.currentCompany}`.toLowerCase().includes(needle);
    });
    return {
      id: genId("cand"),
      campaignId: campaign.id,
      name,
      email: hit.email ?? "",
      phone: hit.phone || undefined,
      avatarInitials: initialsFrom(name),
      currentTitle: hit.currentTitle || "",
      currentCompany: hit.currentCompany || "",
      location: hit.location || "",
      timezone: "",
      linkedinUrl: hit.linkedinUrl || "",
      githubUrl: "",
      sourceExternalId: hit.id,
      externalIds: { SMART: hit.id },
      sourcePlatform: "SMART",
      sourceQuery: query,
      matchScore: 0,
      matchBreakdown: [],
      techStack,
      experience: hit.experience.length ? hit.experience : undefined,
      education: hit.education.length ? hit.education : undefined,
      yearsExperience: hit.yearsExperience,
      companyStageExperience: [],
      industryExperience,
      recentActivity: activityFromHit(hit),
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
      createdAt: at,
      provenance: "live",
      leadSource: "Outbound",
      notes: [
        {
          id: genId("note"),
          at,
          text: `SMART Cvtheque/OCR match (provider score ${hit.matchScore}). Lawful-basis review required before outreach.`,
        },
      ],
    };
  });

  const { accepted, skipped } = dedupeCandidates(raw, existing, {
    excludedCompanies: campaign.sourcingStrategy.excludedCompanies,
  });
  const scored = accepted
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(candidate, jd, weights);
      return { ...candidate, matchScore: score, matchBreakdown: breakdown };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
  return { accepted: scored, skipped };
}
