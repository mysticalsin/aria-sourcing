/**
 * Generate scoring and identity fixtures from Michael's TypeScript on mbe-branch.
 * Synthetic data only. Run from the repo root:
 *   node core/scripts/gen-scoring-vectors.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../..", import.meta.url).pathname;
const scoringSrc = readFileSync(join(root, "src/lib/scoring.ts"), "utf8");
const geoSrc = readFileSync(join(root, "src/lib/geo-europe.ts"), "utf8");
const rulesSrc = readFileSync(join(root, "src/lib/rules.ts"), "utf8");

const dir = mkdtempSync(join(tmpdir(), "aria-score-"));
const utils = `export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
export function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
`;
const types = `export type Candidate = any;
export type JobAnalysis = any;
export type ScoringWeights = any;
export type MatchBreakdownItem = any;
`;
function rewrite(src) {
  return src
    .replaceAll('from "./utils"', 'from "./utils.ts"')
    .replaceAll('from "./geo-europe"', 'from "./geo-europe.ts"')
    .replaceAll('from "./types"', 'from "./types.ts"');
}
writeFileSync(join(dir, "utils.ts"), utils);
writeFileSync(join(dir, "types.ts"), types);
writeFileSync(join(dir, "geo-europe.ts"), rewrite(geoSrc));
writeFileSync(join(dir, "scoring.ts"), rewrite(scoringSrc));

const scoring = await import(pathToFileURL(join(dir, "scoring.ts")).href);
const {
  scoreCandidate,
  DEFAULT_SCORING_WEIGHTS,
  scoreDistribution,
  jobAnalysisIsEuropeFocused,
  candidateMatchesEurope,
  candidateIsFarFromEurope,
  europeSourcingLocationHints,
} = scoring;

function extractFunction(src, name) {
  const key = `export function ${name}`;
  const start = src.indexOf(key);
  if (start < 0) throw new Error(`missing ${name}`);
  const paren = src.indexOf("(", start);
  let depth = 0;
  let i = paren;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const brace = src.indexOf("{", i);
  let bodyDepth = 0;
  let end = brace;
  for (; end < src.length; end++) {
    if (src[end] === "{") bodyDepth++;
    else if (src[end] === "}") {
      bodyDepth--;
      if (bodyDepth === 0) {
        end++;
        break;
      }
    }
  }
  return src.slice(brace + 1, end - 1);
}

const candidateProfileIdentity = new Function(
  "value",
  extractFunction(rulesSrc, "candidateProfileIdentity"),
);
const dedupeCandidates = new Function(
  "incoming",
  "existing",
  "opts",
  "daysSince",
  "DEDUPE_WINDOW_DAYS",
  "candidateProfileIdentity",
  extractFunction(rulesSrc, "dedupeCandidates")
    .replaceAll(": Candidate[]", "")
    .replaceAll(": { name: string; reason: string }[]", ""),
);
const daysSince = (iso, now) => (now - new Date(iso).getTime()) / 86_400_000;

function pack(result, candidate, job) {
  return {
    score: result.score,
    suggestionOnly: true,
    breakdown: result.breakdown.map((item) => ({
      key: item.key,
      label: item.label,
      score: item.score,
      weight: item.weight.toFixed(3),
      contribution: item.contribution.toFixed(1),
      rationale: item.rationale,
    })),
    geo: {
      europeFocused: jobAnalysisIsEuropeFocused(job),
      matchesEurope: candidateMatchesEurope(candidate),
      farFromEurope: candidateIsFarFromEurope(candidate),
      hints: europeSourcingLocationHints(job),
    },
  };
}

function run(candidate, job, weights) {
  const w = weights ?? DEFAULT_SCORING_WEIGHTS;
  return pack(scoreCandidate(candidate, job, w), candidate, job);
}

const baseCandidate = {
  techStack: ["TypeScript", "Node", "Postgres"],
  yearsExperience: 8,
  companyStageExperience: ["Series A"],
  industryExperience: ["fintech"],
  location: "Berlin, Germany",
  timezone: "CET",
  recentActivity: "Shipped this week",
};

const europeRemote = {
  locationType: "Remote",
  location: "Europe",
  regions: ["EU", "EMEA", "Remote"],
  timezone: "CET",
  requiredSkills: ["TypeScript", "Node"],
  niceToHaveSkills: ["Postgres"],
  minYearsExperience: 5,
  maxYearsExperience: 12,
  companyStageTarget: [],
  industryExperience: [],
};

const signalJd = {
  locationType: "Remote",
  location: "",
  regions: ["Canada"],
  timezone: "EST",
  requiredSkills: ["typescript"],
  niceToHaveSkills: ["react"],
  minYearsExperience: 4,
  maxYearsExperience: 8,
  companyStageTarget: [],
  industryExperience: [],
};

const cases = [];
function add(name, candidate, job, weights) {
  const expect = run(candidate, job, weights);
  cases.push({
    name,
    candidate,
    job,
    weights: weights ?? null,
    expect,
  });
}

add("europe-remote-berlin", baseCandidate, europeRemote);
add("europe-remote-new-york", {
  ...baseCandidate,
  location: "New York, NY",
  timezone: "EST",
}, europeRemote);
add("europe-remote-singapore", {
  ...baseCandidate,
  location: "Singapore",
  timezone: "SGT",
}, europeRemote);
add("europe-remote-eugene", {
  ...baseCandidate,
  location: "Eugene, Oregon",
  timezone: "PST",
}, europeRemote);
add("europe-remote-london-gmt", {
  ...baseCandidate,
  location: "London, United Kingdom",
  timezone: "GMT",
}, europeRemote);
add("signal-verified-experience", {
  ...baseCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: 6,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "EST",
  recentActivity: "",
}, signalJd);
add("signal-unknown-experience", {
  ...baseCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "EST",
  recentActivity: "",
}, signalJd);
add("thin-high-skill-below-floor", {
  ...baseCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  location: "",
  timezone: "",
  recentActivity: "",
}, signalJd);
add("broad-verified-typescript-only", {
  ...baseCandidate,
  techStack: ["typescript"],
  yearsExperience: 6,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "EST",
  recentActivity: "",
}, signalJd);

const skillsOnlyJd = {
  ...signalJd,
  requiredSkills: ["typescript", "react", "node", "postgres"],
  niceToHaveSkills: ["next"],
  minYearsExperience: null,
  maxYearsExperience: null,
  regions: ["APAC"],
  timezone: "",
};
add("skills-only-role", {
  ...baseCandidate,
  techStack: ["typescript", "react", "node", "next"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "",
  recentActivity: "",
}, skillsOnlyJd);

add("zeroed-scored-dimensions", {
  ...baseCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: 6,
  companyStageExperience: [],
  industryExperience: [],
  location: "Toronto, Canada",
  timezone: "EST",
  recentActivity: "",
}, signalJd, { ...DEFAULT_SCORING_WEIGHTS, skills: 0, experience: 0, location: 0 });

for (const special of ["NaN", "Infinity", "-Infinity", -5]) {
  const weights = { ...DEFAULT_SCORING_WEIGHTS, skills: special === "NaN" ? Number.NaN : special === "Infinity" ? Number.POSITIVE_INFINITY : special === "-Infinity" ? Number.NEGATIVE_INFINITY : special };
  const candidate = {
    ...baseCandidate,
    techStack: ["typescript", "react"],
    yearsExperience: 6,
    companyStageExperience: [],
    industryExperience: [],
    location: "Toronto, Canada",
    timezone: "EST",
    recentActivity: "",
  };
  cases.push({
    name: `unsafe-skills-weight-${special}`,
    candidate,
    job: signalJd,
    weights,
    weightsSpecial: { skills: String(special) },
    expect: run(candidate, signalJd, weights),
  });
}

add("degenerate-zero-applicable-weight", {
  ...baseCandidate,
  techStack: ["typescript", "react"],
  yearsExperience: null,
  companyStageExperience: [],
  industryExperience: [],
  location: "",
  timezone: "",
  recentActivity: "",
}, signalJd, {
  skills: 0,
  experience: 0,
  companyStage: 10,
  industry: 10,
  location: 0,
  activity: 10,
});

add("skills-none-match", {
  ...baseCandidate,
  techStack: ["cobol"],
}, {
  ...europeRemote,
  requiredSkills: ["Rust", "Kafka"],
  niceToHaveSkills: ["Zig"],
});
add("skills-empty-required", {
  ...baseCandidate,
  techStack: ["Go"],
}, {
  ...europeRemote,
  requiredSkills: [],
  niceToHaveSkills: ["Go"],
});
add("skills-empty-stack-unknown", {
  ...baseCandidate,
  techStack: [],
}, europeRemote);
add("skills-case-and-whitespace", {
  ...baseCandidate,
  techStack: ["  typescript ", "NODE"],
}, {
  ...europeRemote,
  requiredSkills: ["TypeScript", "node"],
  niceToHaveSkills: [],
});
add("skills-duplicate-required", {
  ...baseCandidate,
  techStack: ["Go"],
}, {
  ...europeRemote,
  requiredSkills: ["Go", "Go"],
  niceToHaveSkills: [],
});

add("experience-below-min", { ...baseCandidate, yearsExperience: 2 }, europeRemote);
add("experience-above-max", { ...baseCandidate, yearsExperience: 20 }, europeRemote);
add("experience-fractional-gap", { ...baseCandidate, yearsExperience: 4.5 }, europeRemote);
add("experience-no-band", {
  ...baseCandidate,
  yearsExperience: 9,
}, { ...europeRemote, minYearsExperience: null, maxYearsExperience: null });
add("experience-zero-years", { ...baseCandidate, yearsExperience: 0 }, europeRemote);

const stageJd = {
  ...europeRemote,
  companyStageTarget: ["Series A", "Series B", "Seed"],
  industryExperience: ["fintech", "SaaS"],
};
add("stage-partial-hit", {
  ...baseCandidate,
  companyStageExperience: ["Series A", "Public"],
  industryExperience: ["fintech"],
}, stageJd);
add("stage-miss", {
  ...baseCandidate,
  companyStageExperience: ["Public"],
  industryExperience: ["health"],
}, stageJd);
add("stage-unknown", {
  ...baseCandidate,
  companyStageExperience: [],
  industryExperience: [],
}, stageJd);
add("industry-one-vertical", {
  ...baseCandidate,
  industryExperience: ["SaaS"],
  companyStageExperience: ["Seed", "Series A", "Series B"],
}, stageJd);

const onsite = { ...europeRemote, locationType: "On-site", location: "Berlin", regions: ["Germany", "EU"] };
add("onsite-europe-in-region", baseCandidate, onsite);
add("onsite-europe-far", {
  ...baseCandidate,
  location: "Austin, Texas",
  timezone: "CST",
}, onsite);
add("onsite-europe-unconfirmed", {
  ...baseCandidate,
  location: "Reykjavik hotel district",
  timezone: "",
}, { ...onsite, regions: ["Berlin"], location: "Berlin" });
add("onsite-non-europe-in-region", {
  ...baseCandidate,
  location: "Austin, Texas",
  timezone: "CST",
}, {
  ...europeRemote,
  locationType: "On-site",
  location: "Austin",
  regions: ["Texas", "US"],
  timezone: "CST",
});
add("onsite-non-europe-outside", {
  ...baseCandidate,
  location: "Berlin, Germany",
  timezone: "CET",
}, {
  ...europeRemote,
  locationType: "Hybrid",
  location: "Austin",
  regions: ["Texas"],
  timezone: "CST",
});
add("remote-non-europe-tz-aligned", {
  ...baseCandidate,
  location: "New York, NY",
  timezone: "EST",
}, {
  ...signalJd,
  regions: ["US"],
  timezone: "EST",
  location: "United States",
});
add("remote-non-europe-region-only", {
  ...baseCandidate,
  location: "Toronto, Canada",
  timezone: "PST",
}, {
  ...signalJd,
  regions: ["Canada"],
  timezone: "EST",
});
add("remote-non-europe-neither", {
  ...baseCandidate,
  location: "Berlin, Germany",
  timezone: "CET",
}, {
  ...signalJd,
  regions: ["US"],
  timezone: "PST",
  location: "United States",
});
add("remote-europe-region-not-person", {
  ...baseCandidate,
  location: "Toronto, Canada",
  timezone: "EST",
}, {
  ...europeRemote,
  regions: ["Canada", "EU"],
});
add("global-region", baseCandidate, {
  ...europeRemote,
  locationType: "Hybrid",
  location: "Global",
  regions: ["Global"],
  timezone: "",
});
add("location-unknown", {
  ...baseCandidate,
  location: "   ",
  timezone: "",
}, europeRemote);

for (const recentActivity of [
  "Shipped this week",
  "Published a note this month",
  "Last year, quiet",
  "No activity signal",
  "",
  "Speaking next month and merged a fix",
  "Maintains the client",
]) {
  add(`activity-${recentActivity || "blank"}`, { ...baseCandidate, recentActivity }, europeRemote);
}

add("uk-only-hints", baseCandidate, {
  ...europeRemote,
  location: "London",
  regions: ["UK"],
  timezone: "GMT",
});
add("not-europe-focused", {
  ...baseCandidate,
  location: "Austin, Texas",
  timezone: "CST",
}, {
  ...europeRemote,
  location: "United States",
  regions: ["US", "Remote"],
  timezone: "EST",
});

const distributionScores = [0, 12, 54, 55, 69, 70, 79, 80, 89, 90, 99, 100];

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
}
const next = lcg(0xa11a0500);
const pick = (arr) => arr[next() % arr.length];
const cities = [
  ["Berlin, Germany", "CET"],
  ["Paris, France", "CET"],
  ["London, United Kingdom", "GMT"],
  ["Lisbon, Portugal", "WET"],
  ["New York, NY", "EST"],
  ["Singapore", "SGT"],
  ["Toronto, Canada", "EST"],
  ["Austin, Texas", "CST"],
];
const skillPool = ["TypeScript", "Node", "Postgres", "React", "Go", "Kubernetes", "Python", "Kafka"];
const activities = [
  "Shipped a service this week",
  "Published an article this month",
  "Last year spoke at a meetup",
  "No activity signal",
  "",
  "Maintains a library",
];
const stages = ["Seed", "Series A", "Series B", "Public"];
const industries = ["fintech", "SaaS", "health", "logistics"];
const batchJob = {
  locationType: "Remote",
  location: "Europe",
  regions: ["EU", "EMEA", "Remote"],
  timezone: "CET",
  requiredSkills: ["TypeScript", "Node"],
  niceToHaveSkills: ["Postgres"],
  minYearsExperience: 5,
  maxYearsExperience: 12,
  companyStageTarget: ["Series A", "Series B"],
  industryExperience: ["fintech", "SaaS"],
};
const batchCandidates = [];
const batchExpect = [];
for (let i = 0; i < 500; i++) {
  const [location, timezone] = pick(cities);
  const skillCount = next() % 5;
  const techStack = [];
  for (let s = 0; s < skillCount; s++) techStack.push(pick(skillPool));
  const yearsRoll = next() % 10;
  const candidate = {
    techStack,
    yearsExperience: yearsRoll === 0 ? null : (next() % 21),
    companyStageExperience: next() % 4 === 0 ? [] : [pick(stages)],
    industryExperience: next() % 4 === 0 ? [] : [pick(industries)],
    location: next() % 11 === 0 ? "" : location,
    timezone: next() % 11 === 0 ? "" : timezone,
    recentActivity: pick(activities),
  };
  batchCandidates.push({ id: `syn-${String(i).padStart(3, "0")}`, email: `syn${String(i).padStart(3, "0")}@example.test`, ...candidate });
  batchExpect.push(run(candidate, batchJob));
}

const scoringOut = {
  source: "src/lib/scoring.ts + src/lib/geo-europe.ts",
  sourceCommit: "e3fa3f594a6d86aec31d42a65414a96be4c8400e",
  defaultWeights: DEFAULT_SCORING_WEIGHTS,
  cases,
  distribution: {
    scores: distributionScores,
    bands: scoreDistribution(distributionScores),
  },
  batch500: {
    job: batchJob,
    candidates: batchCandidates,
    expect: batchExpect,
  },
};

const now = Date.parse("2026-06-26T09:00:00.000Z");
const day = 86_400_000;
function person(partial) {
  return {
    name: partial.name,
    email: partial.email ?? "",
    linkedinUrl: partial.linkedinUrl ?? "",
    githubUrl: partial.githubUrl ?? "",
    sourceUrl: partial.sourceUrl ?? "",
    currentCompany: partial.currentCompany ?? "Example Labs",
    lastContactedAt: partial.lastContactedAt ?? null,
  };
}
const incoming = [
  person({ name: "Ada Example", email: "Ada@example.test", linkedinUrl: "https://www.linkedin.com/in/Ada-Example/", githubUrl: "https://github.com/ada-example" }),
  person({ name: "Ada Duplicate", email: "ada@example.test", linkedinUrl: "https://linkedin.com/in/someone-else" }),
  person({ name: "Bea Example", email: "", linkedinUrl: "https://www.linkedin.com/in/Bea-Example/?trk=public" }),
  person({ name: "Bea Variant", email: "", linkedinUrl: "https://linkedin.com/in/bea-example" }),
  person({ name: "No Email One", email: "", githubUrl: "https://github.com/no-email-one" }),
  person({ name: "No Email Two", email: "", githubUrl: "https://www.github.com/other-person/" }),
  person({ name: "Cam Example", email: "cam@example.test", sourceUrl: "https://example.com/profile/Cam/?ref=1" }),
  person({ name: "Cam Variant", email: "cam2@example.test", sourceUrl: "https://www.example.com/profile/cam?ref=1" }),
  person({ name: "Excluded Co", email: "excluded@example.test", currentCompany: "Blocked Corp" }),
  person({ name: "Hiring Co", email: "hiring@example.test", currentCompany: "Example Hiring" }),
  person({ name: "Recent Contact", email: "recent@example.test", lastContactedAt: new Date(now - 10 * day).toISOString() }),
  person({ name: "Old Contact", email: "old@example.test", lastContactedAt: new Date(now - 90 * day).toISOString() }),
  person({ name: "Inside Window", email: "inside@example.test", lastContactedAt: new Date(now - 89.9 * day).toISOString() }),
  person({ name: "Bad Date", email: "baddate@example.test", lastContactedAt: "not-a-date" }),
  person({ name: "Plain Text Id", email: "plain@example.test", linkedinUrl: "not a url" }),
];
const existing = [
  person({ name: "Existing Bea", email: "existing-bea@example.test", linkedinUrl: "https://linkedin.com/in/bea-example/" }),
];
const deduped = dedupeCandidates(
  incoming,
  existing,
  { excludedCompanies: ["Blocked Corp"], currentCompany: "Example Hiring" },
  (iso) => daysSince(iso, now),
  90,
  candidateProfileIdentity,
);

const identitySamples = [
  "https://www.linkedin.com/in/Ada-Example/",
  "https://linkedin.com/in/Ada-Example",
  "https://www.linkedin.com/in/Bea-Example/?trk=public",
  "https://github.com/Example-Org/Demo/",
  "https://www.github.com/Example-Org/Demo/?tab=readme",
  "http://github.com/Example-Org/Demo",
  "https://example.com/profile/Cam/?ref=1",
  "https://www.example.com/profile/cam?ref=1",
  "https://github.com/",
  "Ada Example",
  "mailto:ada@example.test",
  "",
  "   HTTPS://WWW.LinkedIn.com/in/Ada-Example/   ",
];

const identityOut = {
  source: "src/lib/rules.ts candidateProfileIdentity + dedupeCandidates",
  sourceCommit: "e3fa3f594a6d86aec31d42a65414a96be4c8400e",
  nowMs: now,
  windowDays: 90,
  identities: identitySamples.map((value) => ({
    value,
    identity: candidateProfileIdentity(value),
  })),
  dedupe: {
    incoming,
    existing,
    excludedCompanies: ["Blocked Corp"],
    currentCompany: "Example Hiring",
    accepted: deduped.accepted.map((c) => c.name),
    skipped: deduped.skipped,
  },
};

const outDir = join(root, "core/fixtures");
mkdirSync(outDir, { recursive: true });
const scoringPath = join(outDir, "scoring-vectors.json");
const identityPath = join(outDir, "identity-vectors.json");
writeFileSync(scoringPath, `${JSON.stringify(scoringOut)}\n`);
writeFileSync(identityPath, `${JSON.stringify(identityOut)}\n`);
const digest = createHash("sha256").update(readFileSync(scoringPath)).digest("hex");
rmSync(dir, { recursive: true, force: true });
console.log(`cases=${cases.length} batch=${batchCandidates.length} scoringSha256=${digest}`);
console.log(`dedupe accepted=${identityOut.dedupe.accepted.join(",")} skipped=${identityOut.dedupe.skipped.length}`);
