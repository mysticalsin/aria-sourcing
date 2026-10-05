/**
 * Live LinkedIn / Apify rows: engine score, name-only fail, per-row CV citations.
 * Server-only. Do not import from client store modules (engine pulls OCR).
 */

import { roleFamily } from "@/lib/roles";
import {
  SHORTLIST_CAP,
  SHORTLIST_FLOOR,
  citeHits,
  scoreEvidence,
  type CandidateEvidence,
} from "@/lib/sourcing/engine";
import { tokenizeMustHaveSkills } from "@/lib/sourcing/vss-need";
import type { Candidate, JobAnalysis, MatchBreakdownItem } from "@/lib/types";
import type { SourcingNeed } from "@/lib/sourcing/need-types";

const EXPERIENCE_PHRASES = [
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
];

export function liveSourcingNeedFromJob(job: JobAnalysis): SourcingNeed {
  const required = tokenizeMustHaveSkills(job.requiredSkills);
  const nice = tokenizeMustHaveSkills(job.niceToHaveSkills);
  const hay = `${job.title}\n${required.join(" ")}\n${job.industryExperience.join(" ")}`.toLowerCase();
  const phrases = EXPERIENCE_PHRASES.filter(
    (phrase) => hay.includes(phrase) || required.some((skill) => skill.toLowerCase().includes(phrase)),
  );
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

/** JD title stamped onto a thin harvest row is not evidence. */
function evidenceTitle(currentTitle: string | undefined, jobTitle: string): string {
  const title = (currentTitle ?? "").trim();
  if (!title) return "";
  if (title.toLowerCase() === jobTitle.trim().toLowerCase()) return "";
  return title;
}

function cvTextFor(candidate: Candidate, job: JobAnalysis): string {
  return [...(candidate.experience ?? []), candidate.recentActivity, evidenceTitle(candidate.currentTitle, job.title)]
    .filter(Boolean)
    .join("\n");
}

function linkedinTextFor(candidate: Candidate, job: JobAnalysis): string {
  return [
    evidenceTitle(candidate.currentTitle, job.title),
    candidate.currentCompany,
    candidate.recentActivity,
    candidate.location,
  ]
    .filter(Boolean)
    .join("\n");
}

function breakdownFromRow(
  skillsScore: number,
  cvScore: number,
  linkedinScore: number,
  requiredHits: string[],
  cvCitations: string[],
  linkedinCitations: string[],
): MatchBreakdownItem[] {
  return [
    {
      key: "skills",
      label: "Skills match",
      score: skillsScore,
      weight: 0.5,
      contribution: skillsScore * 0.5,
      rationale:
        requiredHits.length > 0
          ? `Required hits: ${requiredHits.join(", ")}`
          : "No required skill attested after name-strip.",
    },
    {
      key: "experience",
      label: "CV / resume",
      score: cvScore,
      weight: 0.3,
      contribution: cvScore * 0.3,
      rationale: cvCitations.length > 0 ? `CV: ${cvCitations.join(" · ")}` : "No CV experience signal.",
    },
    {
      key: "activity",
      label: "LinkedIn / other",
      score: linkedinScore,
      weight: 0.2,
      contribution: linkedinScore * 0.2,
      rationale:
        linkedinCitations.length > 0
          ? `LinkedIn/other: ${linkedinCitations.join(" · ")}`
          : "No LinkedIn/other experience signal.",
    },
  ];
}

/**
 * Drop name-only / empty rows. Finance (Calypso, Murex, application support)
 * also requires the 60 floor, cap 20, and at least one CV citation.
 * Other role families keep the mapper score and attach citations when present.
 */
export function applyLiveEngineGate(candidates: Candidate[], job: JobAnalysis): Candidate[] {
  const need = liveSourcingNeedFromJob(job);
  const finance = roleFamily(job) === "finance";
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const cvText = cvTextFor(candidate, job);
    const linkedinText = linkedinTextFor(candidate, job);
    const evidence: CandidateEvidence = {
      id: candidate.id,
      name: candidate.name,
      skills: tokenizeMustHaveSkills(candidate.techStack),
      cvText,
      linkedinText,
      yearsExperience: candidate.yearsExperience,
      provenance: "live",
    };
    const row = scoreEvidence(need, evidence);
    if (row.reason === "name_only" || row.reason === "empty") continue;
    const cvCitations =
      row.evidence.cv.length > 0
        ? row.evidence.cv
        : citeHits(cvText, [...row.breakdown.requiredHits, ...need.experienceSignals]);
    if (finance) {
      if (row.ineligible || row.score < SHORTLIST_FLOOR) continue;
      if (cvCitations.length === 0) continue;
    }
    kept.push({
      ...candidate,
      matchScore: finance ? row.score : candidate.matchScore,
      techStack: row.breakdown.requiredHits.length ? row.breakdown.requiredHits : candidate.techStack,
      matchBreakdown: breakdownFromRow(
        row.breakdown.skills,
        row.breakdown.cv,
        row.breakdown.linkedin,
        row.breakdown.requiredHits,
        cvCitations,
        row.evidence.linkedin,
      ),
    });
  }
  return finance ? kept.slice(0, SHORTLIST_CAP) : kept;
}
