// Live ranking gate. Protected attributes and proxy features are removed
// before the scrubbed score. A flip of a protected attribute is scored only
// as a counterfactual probe. Location and years of experience stay, because
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

function flipValue(key: string, value: unknown): unknown {
  const name = canon(key);
  if (name === "age" || name === "ageyears" || name === "dateofbirth" || name === "dob" || name === "birthyear" || name === "graduationyear" || name === "gradyear") {
    const number = Number(value);
    return Number.isFinite(number) ? number + 15 : value;
  }
  if (name === "photo" || name === "photopresent" || name === "hasphoto" || name === "avatar" || name === "avatarurl") {
    if (typeof value === "boolean") return !value;
    return value === "" || value == null ? "synthetic-photo" : "";
  }
  if (name === "postcode" || name === "postalcode" || name === "zip" || name === "zipcode") {
    return value === "SYN-001" ? "SYN-000" : "SYN-001";
  }
  return value === "group-b" ? "group-a" : "group-b";
}

export function auditLiveScore(
  features: Record<string, unknown>,
  score: (features: Record<string, unknown>) => number,
  epsilon = 1e-6,
): LiveRankingAudit {
  const scrubbed = scrubRankingFeatures(features);
  const baseline = score(scrubbed);
  let failed = false;
  for (const [key, value] of Object.entries(features)) {
    if (!stripped.has(canon(key))) continue;
    const original = { ...scrubbed, [key]: value };
    const flipped = { ...scrubbed, [key]: flipValue(key, value) };
    if (Math.abs(score(original) - score(flipped)) > epsilon) failed = true;
  }
  const proxies: ProxyDelta[] = [];
  if ("location" in features) {
    const alt = { ...scrubbed, location: features.location === "EU" ? "remote-neutral" : "EU" };
    proxies.push({ feature: "location", delta: Math.abs(score(alt) - baseline) });
  }
  if ("yearsExperience" in features && features.yearsExperience != null) {
    const years = Number(features.yearsExperience);
    const altYears = years >= 10 ? 3 : 12;
    const alt = { ...scrubbed, yearsExperience: altYears };
    proxies.push({
      feature: "yearsExperience",
      delta: Math.abs(score(alt) - score({ ...scrubbed, yearsExperience: years })),
    });
  }
  let verdict: FairnessVerdict = "Pass";
  let detail = "scrubbed score did not move when a protected attribute was flipped";
  if (failed) {
    verdict = "Fail";
    detail = "flipping a protected attribute changed the score by more than the tolerance";
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

const protectedLine = /\b(gender|ethnicity|race|religion|disability|postcode|photo)\b/i;

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
