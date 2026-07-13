import { detectInjection } from "@/lib/agent-disclosure-policy";
import type { CandidateMappingCampaign } from "@/lib/sourcing/candidate-mappers";
import type { SourcePlatform } from "@/lib/types";

const SENSITIVE_PROXY =
  /\b(age|young|old|gender|male|female|race|ethnicity|religion|disabled|disability|pregnan|marital|nationality|native[- ]born|university|college|graduat(?:e|ed|ion))\b/i;

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
  const clean = query.trim();
  if (!clean || clean.length > 256 || /[\u0000-\u001f\u007f]/.test(clean)) {
    return { ok: false, error: "Search query is invalid." };
  }
  if (detectInjection(clean).flagged || SENSITIVE_PROXY.test(clean)) {
    return { ok: false, error: "Search query requires policy review." };
  }

  const roleTerms = [
    campaign.jobAnalysis.title,
    ...campaign.jobAnalysis.requiredSkills,
    ...campaign.jobAnalysis.niceToHaveSkills,
  ]
    .flatMap((value) => [value, ...value.split(/\s+/)])
    .map(token)
    .filter((value) => value.length >= 2);
  const normalizedQueryTokens = queryTokens(clean);
  if (!roleTerms.some((term) => normalizedQueryTokens.has(term))) {
    return { ok: false, error: `Search query is not bound to the approved role on ${platform}.` };
  }
  if (platform === "GitHub") {
    const languageQualifiers = [...clean.matchAll(/(?:^|\s)language:([A-Za-z0-9+#.\-]+)/gi)]
      .map((match) => token(match[1] ?? ""))
      .filter(Boolean);
    if (languageQualifiers.some((language) => !roleTerms.includes(language))) {
      return { ok: false, error: "GitHub language qualifier is not approved for this role." };
    }
  }
  return { ok: true };
}
