/**
 * Map POST /api/source/need fixture JSON onto campaign Candidate records.
 * Client-safe: does not import the sourcing engine (OCR).
 * Lab emails are not Talent Pool / Fly live people.
 */
import type { Campaign, Candidate, JobAnalysis, MatchBreakdownItem } from "@/lib/types";

const FIXTURE_EMAIL_HOST = "fixture.example";

export function needTextFromJob(job: JobAnalysis): string {
  return [
    `Title: ${job.title}`,
    `Skill (Must): ${job.requiredSkills.join(", ")}`,
    job.niceToHaveSkills.length ? `Skill (Nice to have): ${job.niceToHaveSkills.join(", ")}` : "",
    job.industryExperience.length ? `Client Sector: ${job.industryExperience.join(", ")}` : "",
    job.department ? `Profiles: ${job.department}` : "",
    job.location ? `City: ${job.location}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, max)
    .map((item) => item.trim());
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function fixtureEmail(name: string): string {
  const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "person";
  return `${handle}@${FIXTURE_EMAIL_HOST}`;
}

function breakdownItems(row: Record<string, unknown>): MatchBreakdownItem[] {
  const breakdown = isRecord(row.breakdown) ? row.breakdown : {};
  const skills = typeof breakdown.skills === "number" ? breakdown.skills : 0;
  const cv = typeof breakdown.cv === "number" ? breakdown.cv : 0;
  const linkedin = typeof breakdown.linkedin === "number" ? breakdown.linkedin : 0;
  const requiredHits = stringList(breakdown.requiredHits);
  const cvHits = stringList(breakdown.cvHits);
  const linkedinHits = stringList(breakdown.linkedinHits);
  return [
    {
      key: "skills",
      label: "Skills match",
      score: skills,
      weight: 0.5,
      contribution: skills * 0.5,
      rationale: requiredHits.length > 0 ? `Required hits: ${requiredHits.join(", ")}` : "No required skill attested after name-strip.",
    },
    {
      key: "experience",
      label: "CV / resume",
      score: cv,
      weight: 0.3,
      contribution: cv * 0.3,
      rationale: cvHits.length > 0 ? `CV: ${cvHits.join(", ")}` : "No CV experience signal.",
    },
    {
      key: "activity",
      label: "LinkedIn / other",
      score: linkedin,
      weight: 0.2,
      contribution: linkedin * 0.2,
      rationale:
        linkedinHits.length > 0
          ? `LinkedIn/other: ${linkedinHits.join(", ")}`
          : "No LinkedIn/other experience signal.",
    },
  ];
}

export function isFixtureApiRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    value.provenance === "fixture"
  );
}

export function mapFixtureApiRowToCandidate(
  campaign: Pick<Campaign, "id" | "jobAnalysis">,
  row: Record<string, unknown>,
): Candidate {
  const name = String(row.name).trim();
  const evidence = isRecord(row.evidence) ? row.evidence : {};
  const cvHits = stringList(evidence.cv);
  const linkedinHits = stringList(evidence.linkedin);
  const requiredHits = stringList(isRecord(row.breakdown) ? row.breakdown.requiredHits : []);
  return {
    id: `${campaign.id}-${String(row.id)}`,
    campaignId: campaign.id,
    name,
    email: fixtureEmail(name),
    avatarInitials: initials(name),
    currentTitle: campaign.jobAnalysis.title,
    currentCompany: "Fixture desk (dry-run)",
    location: campaign.jobAnalysis.location || campaign.jobAnalysis.regions[0] || "",
    timezone: campaign.jobAnalysis.timezone,
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform: "Talent Pool",
    sourceQuery: "engine-fixture dry-run",
    matchScore: Number(row.score),
    matchBreakdown: breakdownItems(row),
    techStack: requiredHits,
    experience: cvHits.length > 0 ? cvHits : undefined,
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: campaign.jobAnalysis.industryExperience,
    recentActivity: linkedinHits.join(" · "),
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

export function mapFixtureApiShortlist(input: {
  campaign: Pick<Campaign, "id" | "jobAnalysis">;
  shortlist: unknown;
  rejected?: unknown;
}): { accepted: Candidate[]; skipped: { name: string; reason: string }[] } | null {
  if (!Array.isArray(input.shortlist)) return null;
  const rows = input.shortlist.filter(isFixtureApiRow);
  if (rows.length !== input.shortlist.length) return null;
  const accepted = rows
    .filter((row) => row.ineligible !== true && Number(row.score) >= 60)
    .map((row) => mapFixtureApiRowToCandidate(input.campaign, row));
  const rejected = Array.isArray(input.rejected) ? input.rejected.filter(isFixtureApiRow) : [];
  const skipped = rejected
    .filter((row) => row.reason === "name_only" || row.reason === "empty")
    .map((row) => ({ name: String(row.name), reason: String(row.reason) }));
  return { accepted, skipped };
}
