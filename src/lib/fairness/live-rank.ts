// Live ranking gate. Protected attributes and proxy features are removed
// before every score call. Location and years of experience stay, because
// they are role criteria, and their score movement is reported as a warning.

export type FairnessVerdict = "Insufficient" | "Pass" | "Warn" | "Fail";

export interface ProxyDelta {
  feature: "location" | "yearsExperience";
  delta: number;
}

export interface LiveRankingAudit {
  verdict: FairnessVerdict;
  autoReject: false;
  humanDecisionRequired: true;
  scrubbedScore: number;
  proxies: ProxyDelta[];
  detail: string;
}

export interface PromptAudit {
  prompt: string;
  verdict: FairnessVerdict;
  proxies: Array<"location" | "yearsExperience">;
}

const stripped = new Set([
  "gender",
  "sex",
  "genderidentity",
  "genderid",
  "race",
  "racialgroup",
  "age",
  "ageyears",
  "dateofbirth",
  "dob",
  "birthyear",
  "yearofbirth",
  "ethnicity",
  "ethnicgroup",
  "religion",
  "religiousbelief",
  "faith",
  "disability",
  "disabled",
  "handicap",
  "postcode",
  "postalcode",
  "zip",
  "zipcode",
  "graduationyear",
  "gradyear",
  "photo",
  "photopresent",
  "hasphoto",
  "avatar",
  "avatarurl",
  "protectedgroup",
  "protected",
  "grouplabel",
]);

function canon(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

export function scrubRankingFeatures(features: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(features)) {
    if (!stripped.has(canon(key))) out[key] = value;
  }
  return out;
}

export function auditLiveScore(
  features: Record<string, unknown>,
  score: (features: Record<string, unknown>) => number,
  epsilon = 1e-6,
): LiveRankingAudit {
  const scrubbed = scrubRankingFeatures(features);
  const baseline = score(scrubbed);
  const proxies: ProxyDelta[] = [];
  if ("location" in features) {
    const alt = { ...scrubbed, location: features.location === "EU" ? "remote-neutral" : "EU" };
    proxies.push({ feature: "location", delta: Math.abs(score(alt) - baseline) });
  }
  if ("yearsExperience" in features && features.yearsExperience != null) {
    const years = Number(features.yearsExperience);
    const altYears = Number.isFinite(years) && years >= 10 ? 3 : 12;
    const alt = { ...scrubbed, yearsExperience: altYears };
    proxies.push({
      feature: "yearsExperience",
      delta: Math.abs(score(alt) - baseline),
    });
  }
  let verdict: FairnessVerdict = "Pass";
  let detail = "every score call used scrubbed features";
  const nonFinite = !Number.isFinite(baseline) || proxies.some((item) => !Number.isFinite(item.delta));
  if (nonFinite) {
    verdict = "Warn";
    detail = "a score was not finite; a human reviews the live ranker";
  } else if (proxies.some((item) => item.delta > epsilon)) {
    verdict = "Warn";
    detail = "location or years of experience changed the score; a human reviews that proxy";
  }
  return {
    verdict,
    autoReject: false,
    humanDecisionRequired: true,
    scrubbedScore: baseline,
    proxies,
    detail,
  };
}

const protectedLine =
  /\b(?:gender(?:\s*-?\s*identity|\s*id)?|sex|racial(?:\s+group)?|race|ethnic(?:ity|\s+group)?|religio(?:n|us(?:\s+belief)?)|faith|disabilit(?:y|ies)|disabled|handicap|post(?:al)?\s*-?\s*code|zip(?:\s*-?\s*code)?|graduation(?:\s+year)?|grad\s*-?\s*year|date\s+of\s+birth|birth\s*year|year\s+of\s+birth|dob|age(?:\s*years)?|photos?|photograph|avatar(?:\s*url)?|protected(?:\s+group)?|group\s+label)\b/i;

export function auditLivePrompt(prompt: string): PromptAudit {
  const kept = prompt
    .split("\n")
    .filter((line) => !protectedLine.test(line));
  const proxies: PromptAudit["proxies"] = [];
  if (/experience|\byears\b/i.test(prompt)) proxies.push("yearsExperience");
  if (/location|region|\bsetup\b/i.test(prompt)) proxies.push("location");
  return {
    prompt: kept.join("\n"),
    verdict: proxies.length > 0 ? "Warn" : "Pass",
    proxies,
  };
}
