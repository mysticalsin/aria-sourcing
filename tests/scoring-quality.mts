/* tests/scoring-quality.mts — Europe/EMEA geo preference + scoring quality
 * Europe JD must prefer EU candidates over US/Asia peers (even when remote-ok).
 * Run: tsx tests/scoring-quality.mts
 */
import {
  DEFAULT_SCORING_WEIGHTS,
  scoreCandidate,
  selectTopKByMatchScore,
  jobAnalysisIsEuropeFocused,
  candidateMatchesEurope,
  candidateIsFarFromEurope,
  europeSourcingLocationHints,
} from "../src/lib/scoring";
import { SOURCING_QUALITY_FLOOR } from "../src/lib/sourcing/candidate-fit";
import { SAMPLE_CALYPSO_BA_NEED } from "../src/lib/fixtures/calypso-ba-need";
import { buildSourcingStrategy, parseEmailAndJD } from "../src/lib/mock-ai";
import { dedupeCandidates } from "../src/lib/rules";
import { getContactStatus } from "../src/lib/contact-status";
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


/* ---- Calypso BA must-have discrimination (AMACAN / BNPP Montreal) -------- */
const calypsoParsed = parseEmailAndJD({ email: SAMPLE_CALYPSO_BA_NEED });
const calypsoJd: JobAnalysis = {
  ...calypsoParsed.jobAnalysis,
  locationType: calypsoParsed.jobAnalysis.locationType || "Hybrid",
  location: calypsoParsed.jobAnalysis.location || "Montreal",
  regions: calypsoParsed.jobAnalysis.regions.length
    ? calypsoParsed.jobAnalysis.regions
    : ["Montreal", "Canada"],
  timezone: calypsoParsed.jobAnalysis.timezone || "EST",
  minYearsExperience: calypsoParsed.jobAnalysis.minYearsExperience ?? 7,
  maxYearsExperience: calypsoParsed.jobAnalysis.maxYearsExperience ?? 10,
  requiredLanguages:
    calypsoParsed.jobAnalysis.requiredLanguages ?? ["English"],
};

ok("Calypso BA fixture parses must-have Calypso", calypsoJd.requiredSkills.some((s) => /calypso/i.test(s)));
ok(
  "Calypso BA fixture parses Business Analysis must-have",
  calypsoJd.requiredSkills.some((s) => /business analysis/i.test(s)),
);
ok("Calypso BA fixture parses MySQL must-have", calypsoJd.requiredSkills.some((s) => /mysql/i.test(s)));
ok("Calypso BA requires English fluency", (calypsoJd.requiredLanguages ?? []).some((l) => /english/i.test(l)));
ok("Calypso BA seniority band is 7–10", calypsoJd.minYearsExperience === 7 && calypsoJd.maxYearsExperience === 10);
ok("Calypso BA Montreal geo", /montreal/i.test(calypsoJd.location ?? "") || calypsoJd.regions.some((r) => /montreal/i.test(r)));
ok("quality floor stays at 80", SOURCING_QUALITY_FLOOR === 80);
ok("default skills weight dominates (>= 40)", DEFAULT_SCORING_WEIGHTS.skills >= 40);
ok(
  "sourcing strategy uses provided Boolean",
  /Calypso/i.test(buildSourcingStrategy(calypsoJd).linkedinBoolean),
);

function calypsoCand(partial: Partial<Candidate> & Pick<Candidate, "id" | "name">): Candidate {
  return {
    ...seedCand,
    campaignId: "camp-calypso-ba",
    email: `${partial.id}@example.test`,
    avatarInitials: "XX",
    currentTitle: "",
    currentCompany: "",
    location: "",
    timezone: "",
    linkedinUrl: "",
    githubUrl: "",
    sourcePlatform: "Manual",
    sourceQuery: "resume-bank",
    matchScore: 0,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: "manual",
    ...partial,
  };
}

const bestFit = calypsoCand({
  id: "cand-best",
  name: "Amina Best",
  currentTitle: "Senior Calypso Business Analyst",
  currentCompany: "BNPP CIB",
  techStack: ["Calypso", "Business Analysis", "MySQL", "Settlements", "SQL"],
  yearsExperience: 8,
  languages: ["English", "French"],
  location: "Montreal, QC",
  timezone: "EST",
  domainTags: ["Calypso", "CIB", "settlements", "MOA"],
  profileText:
    "Senior Calypso BA with 8y in CIB settlements, MySQL reconciliation, UAT/NRT, Mumbai offshore coordination, Open to Work.",
  recentActivity: "Open to Work — Calypso BA settlements T+1",
});

const weakGithub = calypsoCand({
  id: "cand-weak-gh",
  name: "Weak Github",
  currentTitle: "Developer",
  sourcePlatform: "GitHub",
  techStack: ["Calypso"],
  profileText: "Calypso",
  yearsExperience: null,
  location: "Remote",
  provenance: "live",
  recentActivity: "1 public repo mention Calypso",
});

const noMust = calypsoCand({
  id: "cand-no-must",
  name: "Generic Recruiter",
  currentTitle: "Talent Partner",
  techStack: ["Excel", "Salesforce"],
  yearsExperience: 10,
  location: "Montreal, QC",
  languages: ["English"],
  profileText: "Results-driven professional seeking new opportunities.",
});

const bestScore = scoreCandidate(bestFit, calypsoJd).score;
const weakScore = scoreCandidate(weakGithub, calypsoJd).score;
const noMustScore = scoreCandidate(noMust, calypsoJd).score;

ok("strong Calypso BA clears quality floor", bestScore >= SOURCING_QUALITY_FLOOR);
ok("weak GitHub Calypso string is below floor", weakScore < SOURCING_QUALITY_FLOOR);
ok("no-must-have profile is well below strong fit", noMustScore + 15 < bestScore);
ok("weak GitHub below strong fit", weakScore + 20 < bestScore);

const rankedCalypso = selectTopKByMatchScore(
  [
    { ...noMust, matchScore: noMustScore },
    { ...weakGithub, matchScore: weakScore },
    { ...bestFit, matchScore: bestScore },
  ],
  2,
  calypsoJd,
);
ok("top-K prefers best Calypso BA first", rankedCalypso[0]?.id === "cand-best");
ok("top-K length respects K", rankedCalypso.length === 2);

/* ---- Contact tracking: do not re-source contacted identities ------------- */
const contactedExisting = calypsoCand({
  id: "cand-contacted",
  name: "Already Touched",
  email: "touched@example.test",
  linkedinUrl: "https://www.linkedin.com/in/touched",
  lastContactedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  stage: "Contacted",
});
const incomingDup = calypsoCand({
  id: "cand-incoming",
  name: "Clone Touched",
  email: "touched@example.test",
  linkedinUrl: "https://www.linkedin.com/in/touched",
});
const deduped = dedupeCandidates([incomingDup], [contactedExisting], { excludedCompanies: [] });
ok("contacted identity skipped on re-source", deduped.accepted.length === 0);
ok(
  "skip reason mentions contacted",
  deduped.skipped.some((s) => /already contacted|do not re-contact|contacted/i.test(s.reason)),
);
const contactInfo = getContactStatus(contactedExisting);
ok("contact status is in_window after recent send", contactInfo.status === "in_window");
ok("contact status blocks resourcing", contactInfo.blockResourcing === true);


console.log(`RESULT scoring-quality: ${pass} passed, ${fail} failed`);
for (const c of ranked) {
  console.log(
    `  rank ${c.id} score=${c.score} location=${c.location?.score} :: ${c.location?.rationale ?? ""}`,
  );
}
if (fail > 0) process.exitCode = 1;
