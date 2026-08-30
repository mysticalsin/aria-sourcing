/* tests/scoring-quality.mts — Europe/EMEA geo preference + scoring quality
 * Europe JD must prefer EU candidates over US/Asia peers (even when remote-ok).
 * Run: tsx tests/scoring-quality.mts
 */
import {
  DEFAULT_SCORING_WEIGHTS,
  scoreCandidate,
  jobAnalysisIsEuropeFocused,
  candidateMatchesEurope,
  candidateIsFarFromEurope,
  europeSourcingLocationHints,
} from "../src/lib/scoring";
import { buildSourcingStrategy, parseEmailAndJD } from "../src/lib/mock-ai";
import { buildSeedState } from "../src/lib/seed";
import { candidatesForCampaign } from "../src/lib/metrics";
import type { Candidate, JobAnalysis } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const state = buildSeedState();
const campaign = state.campaigns[0];
ok("seed has campaign", !!campaign?.jobAnalysis);
const seedCand = candidatesForCampaign(state, campaign!.id)[0] as Candidate;
ok("seed has candidate fixture", !!seedCand);

const europeJd: JobAnalysis = {
  ...campaign!.jobAnalysis,
  title: "Senior Backend Engineer",
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

ok("Europe JD detected as Europe-focused", jobAnalysisIsEuropeFocused(europeJd));
ok(
  "remote-ok international Europe JD still Europe-focused",
  jobAnalysisIsEuropeFocused({
    ...europeJd,
    location: "International remote",
    regions: ["Remote", "EU"],
  }),
);
ok(
  "US-only JD is not Europe-focused",
  !jobAnalysisIsEuropeFocused({
    ...europeJd,
    location: "United States",
    regions: ["US", "Remote"],
    timezone: "EST",
  }),
);

const peerBase: Candidate = {
  ...seedCand,
  currentTitle: "Senior Backend Engineer",
  techStack: ["TypeScript", "Node", "Postgres"],
  yearsExperience: 8,
  companyStageExperience: [],
  industryExperience: [],
  recentActivity: "Shipped production services this week",
};

const euPeer: Candidate = {
  ...peerBase,
  id: "sq-cand-eu",
  name: "Elena Europe",
  location: "Berlin, Germany",
  timezone: "CET",
};
const usPeer: Candidate = {
  ...peerBase,
  id: "sq-cand-us",
  name: "Alex America",
  location: "New York, NY",
  timezone: "EST",
};
const asiaPeer: Candidate = {
  ...peerBase,
  id: "sq-cand-asia",
  name: "Priya Asia",
  location: "Singapore",
  timezone: "SGT",
};

ok("EU candidate matches Europe", candidateMatchesEurope(euPeer));
ok("US candidate is far from Europe", candidateIsFarFromEurope(usPeer));
ok("Asia candidate is far from Europe", candidateIsFarFromEurope(asiaPeer));

const scored = [euPeer, usPeer, asiaPeer].map((c) => {
  const { score, breakdown } = scoreCandidate(c, europeJd, DEFAULT_SCORING_WEIGHTS);
  return { id: c.id, score, breakdown, location: breakdown.find((b) => b.key === "location") };
});
const byId = Object.fromEntries(scored.map((c) => [c.id, c]));

ok(
  `Europe JD prefers EU over US (EU=${byId["sq-cand-eu"]!.score} US=${byId["sq-cand-us"]!.score})`,
  byId["sq-cand-eu"]!.score > byId["sq-cand-us"]!.score,
);
ok(
  `Europe JD prefers EU over Asia (EU=${byId["sq-cand-eu"]!.score} Asia=${byId["sq-cand-asia"]!.score})`,
  byId["sq-cand-eu"]!.score > byId["sq-cand-asia"]!.score,
);
ok(
  "Europe location rationale names Europe/EMEA",
  /Europe|EMEA|CET/i.test(byId["sq-cand-eu"]!.location?.rationale ?? ""),
);
ok(
  "US dampened on Europe JD (location score gap >= 40)",
  (byId["sq-cand-eu"]!.location?.score ?? 0) - (byId["sq-cand-us"]!.location?.score ?? 100) >= 40,
);
ok(
  "Asia dampened on Europe JD (location score gap >= 40)",
  (byId["sq-cand-eu"]!.location?.score ?? 0) - (byId["sq-cand-asia"]!.location?.score ?? 100) >= 40,
);

const ranked = [...scored].sort((a, b) => b.score - a.score);
ok("top-ranked peer on Europe JD is EU candidate", ranked[0]!.id === "sq-cand-eu");
ok("US does not outrank EU on Europe JD", ranked.findIndex((c) => c.id === "sq-cand-us") > 0);
ok("Asia does not outrank EU on Europe JD", ranked.findIndex((c) => c.id === "sq-cand-asia") > 0);

const hints = europeSourcingLocationHints(europeJd);
ok(
  "Europe sourcing hints include concrete countries",
  hints.includes("Germany") && hints.includes("United Kingdom"),
);
const strategy = buildSourcingStrategy(europeJd);
ok(
  "GitHub queries use concrete Europe location qualifier",
  strategy.githubQueries.some((q) =>
    /location:(Germany|United Kingdom|France|Netherlands|Spain)/i.test(q.query),
  ),
);
ok(
  "geoTargets prefer concrete Europe hints over bare EU",
  strategy.geoTargets.some((g) => /Germany|United Kingdom|France/i.test(g)),
);
ok(
  "LinkedIn boolean uses concrete Europe geos not bare EU-only",
  /Germany|United Kingdom|France|Netherlands|Spain/i.test(strategy.linkedinBoolean),
);

const parsed = parseEmailAndJD({
  email:
    "Hiring a Senior Backend Engineer, fully remote across the EU (CET). Europe/EMEA focus. Must overlap Berlin hours.",
});
ok("mock JD parse tags EU for Europe/CET text", parsed.jobAnalysis.regions.includes("EU"));
ok("mock JD parse captures CET timezone", parsed.jobAnalysis.timezone === "CET");
ok(
  "parsed Europe JD is Europe-focused",
  jobAnalysisIsEuropeFocused(parsed.jobAnalysis),
);

console.log(`RESULT scoring-quality: ${pass} passed, ${fail} failed`);
for (const c of ranked) {
  console.log(
    `  rank ${c.id} score=${c.score} location=${c.location?.score} :: ${c.location?.rationale ?? ""}`,
  );
}
if (fail > 0) process.exitCode = 1;
