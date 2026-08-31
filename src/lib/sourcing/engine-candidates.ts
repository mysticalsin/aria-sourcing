/**
 * Map engine shortlist rows onto campaign Candidate records.
 * Tests and recorded fixture batches only. Talent Pool / Fly must not import
 * this — lab emails (@fixture.example) are not production candidates.
 */

import {
  TRADING_PLATFORM_POOL,
} from "@/lib/fixtures/trading-platform-need";
import type { SourceResult } from "@/lib/sourcing/candidate-mappers";
import {
  SHORTLIST_CAP,
  SHORTLIST_FLOOR,
  shortlistNeed,
  type CandidateEvidence,
  type ScoredRow,
  type SourcingNeed,
} from "@/lib/sourcing/engine";
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";
import type { Campaign, Candidate, JobAnalysis, MatchBreakdownItem } from "@/lib/types";

const ENGINE_NEED_RE =
  /calypso|murex|grafana|dynatrace|linux server|business analysis|prime brokerage/i;

export function jobUsesEngineFixture(job: JobAnalysis): boolean {
  return ENGINE_NEED_RE.test(`${job.title}\n${job.requiredSkills.join("\n")}`);
}

export function sourcingNeedFromJob(job: JobAnalysis): SourcingNeed {
  const required = tokenizeMustHaveSkills(job.requiredSkills);
  const nice = tokenizeMustHaveSkills(job.niceToHaveSkills);
  const hay = `${job.title}\n${required.join(" ")}\n${job.industryExperience.join(" ")}`.toLowerCase();
  const phrases = [
    "production support",
    "trade life cycle",
    "trade lifecycle",
    "prime brokerage",
    "capital markets",
    "settlement",
    "settlements",
    "securities",
    "back office",
    "t+1",
    "business analysis",
    "calypso",
  ].filter((phrase) => hay.includes(phrase) || required.some((s) => s.toLowerCase().includes(phrase)));
  return {
    title: job.title,
    requiredSkills: required,
    niceToHaveSkills: nice,
    experienceSignals: phrases.length ? phrases : required,
    minYearsExperience: job.minYearsExperience,
    industry: job.industryExperience,
    source: "paste",
    rawText: job.title,
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function breakdownItems(row: ScoredRow): MatchBreakdownItem[] {
  return [
    {
      key: "skills",
      label: "Skills match",
      score: row.breakdown.skills,
      weight: 0.5,
      contribution: row.breakdown.skills * 0.5,
      rationale:
        row.breakdown.requiredHits.length > 0
          ? `Required hits: ${row.breakdown.requiredHits.join(", ")}`
          : "No required skill attested after name-strip.",
    },
    {
      key: "experience",
      label: "CV / resume",
      score: row.breakdown.cv,
      weight: 0.3,
      contribution: row.breakdown.cv * 0.3,
      rationale:
        row.breakdown.cvHits.length > 0
          ? `CV: ${row.breakdown.cvHits.join(", ")}`
          : "No CV experience signal.",
    },
    {
      key: "activity",
      label: "LinkedIn / other",
      score: row.breakdown.linkedin,
      weight: 0.2,
      contribution: row.breakdown.linkedin * 0.2,
      rationale:
        row.breakdown.linkedinHits.length > 0
          ? `LinkedIn/other: ${row.breakdown.linkedinHits.join(", ")}`
          : "No LinkedIn/other experience signal.",
    },
  ];
}

function evidenceFor(row: ScoredRow, pool: CandidateEvidence[]): CandidateEvidence | undefined {
  return pool.find((item) => item.id === row.id);
}

export function mapEngineRowToCandidate(
  campaign: Pick<Campaign, "id" | "jobAnalysis">,
  row: ScoredRow,
  evidence: CandidateEvidence | undefined,
): Candidate {
  const cv = evidence?.cvText.trim() ?? "";
  const linkedin = evidence?.linkedinText.trim() ?? "";
  const handle = row.name.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  return {
    id: `${campaign.id}-${row.id}`,
    campaignId: campaign.id,
    name: row.name,
    email: `${handle}@fixture.example`,
    avatarInitials: initials(row.name),
    currentTitle: campaign.jobAnalysis.title,
    currentCompany: "Fixture desk (not live)",
    location: campaign.jobAnalysis.location || campaign.jobAnalysis.regions[0] || "",
    timezone: campaign.jobAnalysis.timezone,
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform: "Talent Pool",
    sourceQuery: `engine-fixture floor=${SHORTLIST_FLOOR} cap=${SHORTLIST_CAP}`,
    matchScore: row.score,
    matchBreakdown: breakdownItems(row),
    techStack: row.breakdown.requiredHits,
    experience: cv ? [cv] : undefined,
    languages: /english/i.test(`${cv} ${linkedin}`) ? ["English"] : undefined,
    yearsExperience: evidence?.yearsExperience ?? null,
    companyStageExperience: [],
    industryExperience: campaign.jobAnalysis.industryExperience,
    recentActivity: linkedin,
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
    provenance: "synthetic",
  };
}

export function sourceEngineFixtureCandidates(
  campaign: Campaign,
  existing: Candidate[],
  cap = SHORTLIST_CAP,
): SourceResult {
  const need = sourcingNeedFromJob(campaign.jobAnalysis);
  const result = shortlistNeed(need, TRADING_PLATFORM_POOL, Math.min(cap, SHORTLIST_CAP));
  const seen = new Set(existing.map((c) => c.name.toLowerCase()));
  const accepted = result.shortlist
    .filter((row) => !seen.has(row.name.toLowerCase()) && row.score >= SHORTLIST_FLOOR)
    .map((row) => mapEngineRowToCandidate(campaign, row, evidenceFor(row, TRADING_PLATFORM_POOL)));
  return {
    accepted,
    skipped: result.rejected
      .filter((row) => row.reason === "name_only" || row.reason === "empty")
      .map((row) => ({ name: row.name, reason: row.reason ?? "rejected" })),
  };
}
