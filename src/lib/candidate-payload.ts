import {
  CANDIDATE_STAGES,
  COMPANY_STAGES,
  SOURCE_PLATFORMS,
  type Candidate,
  type CandidateStage,
  type CompanyStage,
  type ComplianceFlags,
  type MatchBreakdownItem,
  type SourcePlatform,
} from "@/lib/types";
import { initialsFrom } from "@/lib/utils";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown, fallback: number): number {
  const numeric = numberOrNull(value);
  return numeric === null ? fallback : Math.trunc(numeric);
}

function sourcePlatformValue(value: unknown): SourcePlatform {
  if (typeof value === "string") {
    for (const platform of SOURCE_PLATFORMS) {
      if (value === platform) return platform;
    }
  }
  return "Manual";
}

function candidateStageValue(value: unknown): CandidateStage {
  if (typeof value === "string") {
    for (const stage of CANDIDATE_STAGES) {
      if (value === stage) return stage;
    }
  }
  return "Sourced";
}

function companyStageArray(value: unknown): CompanyStage[] {
  if (!Array.isArray(value)) return [];
  const stages: CompanyStage[] = [];
  for (const item of value) {
    for (const stage of COMPANY_STAGES) {
      if (item === stage) stages.push(stage);
    }
  }
  return stages;
}

function complianceFlags(value: unknown): ComplianceFlags {
  const flags = isRecord(value) ? value : null;
  return {
    doNotContact: flags?.doNotContact === true,
    suppressed: flags?.suppressed === true,
    unsubscribed: flags?.unsubscribed === true,
    gdprExportRequested: flags?.gdprExportRequested === true,
    anonymized: flags?.anonymized === true,
    suppressedUntil: stringOrNull(flags?.suppressedUntil),
    preSuppressionStage: candidateStageValue(flags?.preSuppressionStage) === "Sourced"
      && flags?.preSuppressionStage !== "Sourced"
      ? null
      : candidateStageValue(flags?.preSuppressionStage),
  };
}

function matchBreakdown(value: unknown): MatchBreakdownItem[] {
  if (!Array.isArray(value)) return [];
  const items: MatchBreakdownItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const key = item.key;
    if (
      key !== "skills" &&
      key !== "experience" &&
      key !== "companyStage" &&
      key !== "industry" &&
      key !== "location" &&
      key !== "activity"
    ) {
      continue;
    }
    items.push({
      key,
      label: stringValue(item.label),
      score: integerValue(item.score, 0),
      weight: numberOrNull(item.weight) ?? 0,
      contribution: numberOrNull(item.contribution) ?? 0,
      rationale: stringValue(item.rationale),
    });
  }
  return items;
}

export function candidateFromPayload(raw: unknown): Candidate | null {
  if (!isRecord(raw)) return null;

  const id = nonEmptyString(raw.id);
  const campaignId = nonEmptyString(raw.campaignId);
  const name = nonEmptyString(raw.name);
  if (!id || !campaignId || !name) return null;

  const candidate: Candidate = {
    id,
    campaignId,
    name,
    email: stringValue(raw.email),
    phone: stringValue(raw.phone),
    avatarInitials: stringValue(raw.avatarInitials) || initialsFrom(name),
    currentTitle: stringValue(raw.currentTitle),
    currentCompany: stringValue(raw.currentCompany),
    location: stringValue(raw.location),
    timezone: stringValue(raw.timezone),
    linkedinUrl: stringValue(raw.linkedinUrl),
    githubUrl: stringValue(raw.githubUrl),
    sourceUrl: stringValue(raw.sourceUrl),
    sourceExternalId: stringValue(raw.sourceExternalId),
    sourceAuthorityId: stringValue(raw.sourceAuthorityId),
    sourcePlatform: sourcePlatformValue(raw.sourcePlatform),
    sourceQuery: stringValue(raw.sourceQuery),
    matchScore: integerValue(raw.matchScore, 0),
    matchBreakdown: matchBreakdown(raw.matchBreakdown),
    techStack: stringArray(raw.techStack),
    experience: stringArray(raw.experience),
    education: stringArray(raw.education),
    languages: stringArray(raw.languages),
    yearsExperience: numberOrNull(raw.yearsExperience),
    companyStageExperience: companyStageArray(raw.companyStageExperience),
    industryExperience: stringArray(raw.industryExperience),
    recentActivity: stringValue(raw.recentActivity),
    stage: candidateStageValue(raw.stage),
    maxStageRank: numberOrNull(raw.maxStageRank) ?? undefined,
    lastContactedAt: stringOrNull(raw.lastContactedAt),
    lastRepliedAt: stringOrNull(raw.lastRepliedAt),
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: complianceFlags(raw.complianceFlags),
    createdAt: stringValue(raw.createdAt, EPOCH_ISO),
    provenance:
      raw.provenance === "live" || raw.provenance === "manual" || raw.provenance === "synthetic"
        ? raw.provenance
        : undefined,
    lawfulBasis:
      raw.lawfulBasis === "consent" || raw.lawfulBasis === "legitimate_interest"
        ? raw.lawfulBasis
        : undefined,
    lawfulBasisRecordedAt: stringValue(raw.lawfulBasisRecordedAt) || undefined,
    lawfulBasisSource: raw.lawfulBasisSource === "operator_selection" ? "operator_selection" : undefined,
    fitEndorsedAt: stringValue(raw.fitEndorsedAt) || undefined,
    fitEndorsedSource: raw.fitEndorsedSource === "operator_selection" ? "operator_selection" : undefined,
    notes: [],
    rejectionReason: stringValue(raw.rejectionReason) || undefined,
    leadSource:
      raw.leadSource === "Applicant" || raw.leadSource === "Referral" || raw.leadSource === "Outbound"
        ? raw.leadSource
        : undefined,
    referredBy: stringValue(raw.referredBy) || undefined,
    starRating:
      raw.starRating === "TopGun" ||
      raw.starRating === "A" ||
      raw.starRating === "B" ||
      raw.starRating === "C" ||
      raw.starRating === "D"
        ? raw.starRating
        : undefined,
    vivier: raw.vivier === true,
    silverMedalist: raw.silverMedalist === true,
    recontactAt: stringOrNull(raw.recontactAt),
    prequal: undefined,
    interviews: [],
    dna: stringArray(raw.dna),
    enrichment: undefined,
  };

  return candidate;
}
