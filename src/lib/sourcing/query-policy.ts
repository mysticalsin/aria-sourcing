import { detectInjection } from "@/lib/agent-disclosure-policy";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import type { SourcePlatform } from "@/lib/types";

export const PROHIBITED_CRITERIA =
  /\b(age|young|old|gender|male|female|race|ethnicity|religion|disabled|disability|pregnan|marital|nationality|native[- ]born|university|college|graduat(?:e|ed|ion))\b/i;

const NAME_CRITERIA_FIELDS = new Set(["firstNames", "lastNames"]);
const DISCOVERY_CRITERIA_FIELDS = new Set([
  "query",
  "searchQuery",
  "locations",
  "currentJobTitles",
  "pastJobTitles",
  "currentCompanies",
  "pastCompanies",
  "schools",
]);

function token(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, "");
}

function queryTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map(token)
      .filter(Boolean),
  );
}

export function validateSourcingQuery(
  platform: SourcePlatform,
  query: string,
  campaign: CandidateMappingCampaign,
): { ok: true } | { ok: false; error: string } {
  return validateSourcingCriteria(platform, { query }, campaign);
}

export function prohibitedCriteriaViolation(
  value: string,
): "control_chars" | "too_long" | "injection" | "protected_proxy" | null {
  const clean = value.trim();
  if (!clean || clean.length > 256 || /[\u0000-\u001f\u007f]/.test(clean)) {
    return clean.length > 256 ? "too_long" : "control_chars";
  }
  if (detectInjection(clean).flagged) return "injection";
  if (PROHIBITED_CRITERIA.test(clean)) return "protected_proxy";
  return null;
}

function valuesByField(criteria: Record<string, string | string[]>): { field: string; value: string }[] {
  return Object.entries(criteria).flatMap(([field, raw]) =>
    (Array.isArray(raw) ? raw : [raw])
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ field, value })),
  );
}

function fieldAllowsIdentityShapeOnly(field: string): boolean {
  if (NAME_CRITERIA_FIELDS.has(field)) return true;
  if (DISCOVERY_CRITERIA_FIELDS.has(field)) return false;
  return false;
}

export function validateSourcingCriteria(
  platform: SourcePlatform,
  criteria: Record<string, string | string[]>,
  campaign: CandidateMappingCampaign,
): { ok: true } | { ok: false; error: string } {
  const fieldValues = valuesByField(criteria);
  if (fieldValues.length === 0) {
    return { ok: false, error: "Search query is invalid." };
  }

  for (const { field, value } of fieldValues) {
    const violation = prohibitedCriteriaViolation(value);
    if (violation === "control_chars" || violation === "too_long") {
      return { ok: false, error: "Search query is invalid." };
    }
    if (violation === "injection" || (violation === "protected_proxy" && !fieldAllowsIdentityShapeOnly(field))) {
      return { ok: false, error: "Search query requires policy review." };
    }
  }

  const roleTerms = [
    campaign.jobAnalysis.title,
    ...campaign.jobAnalysis.requiredSkills,
    ...campaign.jobAnalysis.niceToHaveSkills,
  ]
    .flatMap((value) => [value, ...value.split(/\s+/)])
    .map(token)
    .filter((value) => value.length >= 2);
  const normalizedQueryTokens = new Set(fieldValues.flatMap(({ value }) => [...queryTokens(value)]));
  if (!roleTerms.some((term) => normalizedQueryTokens.has(term))) {
    return { ok: false, error: `Search query is not bound to the approved role on ${platform}.` };
  }
  if (platform === "GitHub") {
    const languageQualifiers = fieldValues
      .map(({ value }) => value)
      .flatMap((value) => [...value.matchAll(/(?:^|\s)language:([A-Za-z0-9+#.\-]+)/gi)])
      .map((match) => token(match[1] ?? ""))
      .filter(Boolean);
    if (languageQualifiers.some((language) => !roleTerms.includes(language))) {
      return { ok: false, error: "GitHub language qualifier is not approved for this role." };
    }
  }
  return { ok: true };
}
