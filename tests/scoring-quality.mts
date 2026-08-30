/* tests/scoring-quality.mts — Calypso BA JD-fit ranking + must-have discrimination
 * Run: tsx tests/scoring-quality.mts
 */
import {
  DEFAULT_SCORING_WEIGHTS,
  scoreCandidate,
  selectTopKByMatchScore,
  rankScoredCandidates,
  jobAnalysisIsEuropeFocused,
  candidateMatchesEurope,
  candidateIsFarFromEurope,
} from "../src/lib/scoring";
import { SOURCING_QUALITY_FLOOR } from "../src/lib/sourcing/candidate-fit";
import { SAMPLE_VSS_CALYPSO_BA } from "../src/lib/mantu-need-parse";
import { parseEmailAndJD } from "../src/lib/mock-ai";
import type { Candidate, JobAnalysis } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const parsed = parseEmailAndJD({ email: SAMPLE_VSS_CALYPSO_BA });
const jd: JobAnalysis = {
  ...parsed.jobAnalysis,
  locationType: "Remote",
  location: "Montreal",
  regions: ["Montreal", "Canada"],
  timezone: "EST",
  minYearsExperience: parsed.jobAnalysis.minYearsExperience ?? 7,
  maxYearsExperience: 10,
  requiredLanguages:
    parsed.jobAnalysis.requiredLanguages ??
    parsed.mantuNeed?.languagesMust.map((l) => l.replace(/\s*-\s*.*$/, "").trim()) ??
    ["English"],
};

ok("Calypso BA fixture parses must-have Calypso", jd.requiredSkills.some((s) => /calypso/i.test(s)));
ok(
  "Calypso BA fixture has Business Analysis / derivatives must-haves",
  jd.requiredSkills.some((s) => /business analysis|derivatives|trade lifecycle/i.test(s)),
);
ok("Calypso BA requires English fluency", (jd.requiredLanguages ?? []).some((l) => /english/i.test(l)));
ok("minScore / quality floor stays at 80", SOURCING_QUALITY_FLOOR === 80);
ok("default skills weight dominates (>= 40)", DEFAULT_SCORING_WEIGHTS.skills >= 40);

function baseCand(partial: Partial<Candidate> & Pick<Candidate, "id" | "name">): Candidate {
  return {
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

const best = baseCand({
  id: "cand-best",
  name: "Amina Best",
  currentTitle: "Senior Calypso Business Analyst",
  currentCompany: "HSBC CIB",
  techStack: ["Calypso", "Business Analysis", "Derivatives", "Trade Lifecycle", "SQL"],
  yearsExperience: 8,
  languages: ["English", "French"],
  location: "Montreal, QC",
  timezone: "EST",
  domainTags: ["Calypso", "CIB", "settlements", "MOA"],
  profileText: `
    Senior Calypso Business Analyst with 8 years in capital markets CIB.
    Owned trade lifecycle, settlements, and MOA/back-office workflows on Calypso.
    Fluent English. Based in Montreal. Business Analysis for rates derivatives.
  `,
  industryExperience: ["Fintech"],
  provenance: "live",
});

const strong = baseCand({
  id: "cand-strong",
  name: "Bruno Strong",
  currentTitle: "Calypso Business Analyst",
  techStack: ["Calypso", "Business Analysis", "Derivatives"],
  yearsExperience: 9,
  languages: ["English"],
  location: "Toronto, ON",
  timezone: "EST",
  profileText:
    "Calypso BA for derivatives and trade lifecycle. English fluent. Capital markets delivery.",
  provenance: "live",
});

const mid = baseCand({
  id: "cand-mid",
  name: "Chris Mid",
  currentTitle: "Business Analyst",
  techStack: ["Jira", "Agile"],
  yearsExperience: 5,
  location: "Montreal",
  profileText: "Business analyst with Agile delivery. Seeking new opportunities in Montreal.",
  provenance: "manual",
});

const weak = baseCand({
  id: "cand-weak",
  name: "Dana Weak",
  currentTitle: "Professional",
  techStack: [],
  yearsExperience: null,
  profileText: "Results-driven professional seeking new opportunities. Motivated individual.",
  provenance: "manual",
});

const syntheticTwin = baseCand({
  ...best,
  id: "cand-synth",
  name: "Synth Twin",
  provenance: "synthetic",
  sourcePlatform: "Talent Pool",
});

const scored = [best, strong, mid, weak, syntheticTwin].map((c) => {
  const { score, breakdown } = scoreCandidate(c, jd, DEFAULT_SCORING_WEIGHTS);
  return { ...c, matchScore: score, matchBreakdown: breakdown };
});

const byId = Object.fromEntries(scored.map((c) => [c.id, c]));

ok(`best clears quality floor (got ${byId["cand-best"]!.matchScore})`, byId["cand-best"]!.matchScore >= SOURCING_QUALITY_FLOOR);
ok(`strong clears or nears floor (got ${byId["cand-strong"]!.matchScore})`, byId["cand-strong"]!.matchScore >= 70);
ok(`weak stays below floor (got ${byId["cand-weak"]!.matchScore})`, byId["cand-weak"]!.matchScore < SOURCING_QUALITY_FLOOR);
ok("best outranks strong", byId["cand-best"]!.matchScore > byId["cand-strong"]!.matchScore);
ok("strong outranks mid", byId["cand-strong"]!.matchScore > byId["cand-mid"]!.matchScore);
ok("mid outranks weak", byId["cand-mid"]!.matchScore > byId["cand-weak"]!.matchScore);
ok("live best outranks synthetic twin (no demo inflation)", byId["cand-best"]!.matchScore > byId["cand-synth"]!.matchScore);

const ranked = rankScoredCandidates(scored, jd);
ok(
  "rank order is best → strong → … → weak",
  ranked[0]!.id === "cand-best" &&
    ranked[1]!.id === "cand-strong" &&
    ranked[ranked.length - 1]!.id === "cand-weak",
);

const shuffledApiOrder = [
  weak,
  mid,
  syntheticTwin,
  strong,
  best,
  ...Array.from({ length: 20 }, (_, i) =>
    baseCand({
      id: `cand-filler-${i}`,
      name: `Filler ${i}`,
      currentTitle: "Coordinator",
      techStack: ["Excel"],
      profileText: "Administrative coordinator. Open to work.",
      yearsExperience: 2,
    }),
  ),
];
const scoredBank = shuffledApiOrder.map((c) => {
  const { score, breakdown } = scoreCandidate(c, jd, DEFAULT_SCORING_WEIGHTS);
  return { ...c, matchScore: score, matchBreakdown: breakdown };
});
const top3 = selectTopKByMatchScore(scoredBank, 3, jd);
ok("top-K size is 3", top3.length === 3);
ok("top-K[0] is best despite worst-first API order", top3[0]!.id === "cand-best");
ok("top-K[1] is strong", top3[1]!.id === "cand-strong");
ok("filler volume does not displace quality leaders", !top3.some((c) => c.id.startsWith("cand-filler")));

const bestSkills = byId["cand-best"]!.matchBreakdown.find((b) => b.key === "skills");
ok(
  "skills rationale names must-have hits",
  /must-have/i.test(bestSkills?.rationale ?? "") && /Calypso/i.test(bestSkills?.rationale ?? ""),
);
const bestIndustry = byId["cand-best"]!.matchBreakdown.find((b) => b.key === "industry");
ok("industry rationale surfaces domain signals", /domain signals/i.test(bestIndustry?.rationale ?? ""));
const bestLocation = byId["cand-best"]!.matchBreakdown.find((b) => b.key === "location");
ok(
  "location rationale mentions English fluency and/or Montreal",
  /English|Montreal/i.test(bestLocation?.rationale ?? ""),
);
const bestExp = byId["cand-best"]!.matchBreakdown.find((b) => b.key === "experience");
ok(
  "experience rationale cites years in band (never fabricated)",
  /8 yrs/i.test(bestExp?.rationale ?? "") && /band/i.test(bestExp?.rationale ?? ""),
);

const missingYears = scoreCandidate(
  { ...best, yearsExperience: null, provenance: "manual" },
  jd,
  DEFAULT_SCORING_WEIGHTS,
);
ok(
  "missing years are not fabricated to zero",
  /never fabricated|unknown/i.test(
    missingYears.breakdown.find((b) => b.key === "experience")?.rationale ?? "",
  ),
);


/* ---- Europe / EMEA timezone preference (remote-ok still prefers Europe) ---- */

const europeJd: JobAnalysis = {
  ...jd,
  locationType: "Remote",
  location: "Europe",
  regions: ["EU", "EMEA", "Remote"],
  timezone: "CET",
  requiredLanguages: undefined,
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

const euPeer = baseCand({
  id: "cand-eu",
  name: "Elena Europe",
  currentTitle: "Senior Calypso Business Analyst",
  currentCompany: "BNP Paribas CIB",
  techStack: ["Calypso", "Business Analysis", "Derivatives", "Trade Lifecycle", "SQL"],
  yearsExperience: 8,
  languages: ["English"],
  location: "Berlin, Germany",
  timezone: "CET",
  domainTags: ["Calypso", "CIB", "settlements"],
  profileText:
    "Senior Calypso BA in capital markets. Derivatives and trade lifecycle. Based in Berlin (CET).",
  provenance: "live",
});

const usPeer = baseCand({
  id: "cand-us",
  name: "Alex America",
  currentTitle: "Senior Calypso Business Analyst",
  currentCompany: "JPMorgan CIB",
  techStack: ["Calypso", "Business Analysis", "Derivatives", "Trade Lifecycle", "SQL"],
  yearsExperience: 8,
  languages: ["English"],
  location: "New York, NY",
  timezone: "EST",
  domainTags: ["Calypso", "CIB", "settlements"],
  profileText:
    "Senior Calypso BA in capital markets. Derivatives and trade lifecycle. Based in New York (EST).",
  provenance: "live",
});

const asiaPeer = baseCand({
  id: "cand-asia",
  name: "Priya Asia",
  currentTitle: "Senior Calypso Business Analyst",
  currentCompany: "DBS Capital Markets",
  techStack: ["Calypso", "Business Analysis", "Derivatives", "Trade Lifecycle", "SQL"],
  yearsExperience: 8,
  languages: ["English"],
  location: "Singapore",
  timezone: "SGT",
  domainTags: ["Calypso", "CIB", "settlements"],
  profileText:
    "Senior Calypso BA in capital markets. Derivatives and trade lifecycle. Based in Singapore (SGT).",
  provenance: "live",
});

ok("EU candidate matches Europe", candidateMatchesEurope(euPeer));
ok("US candidate is far from Europe", candidateIsFarFromEurope(usPeer));
ok("Asia candidate is far from Europe", candidateIsFarFromEurope(asiaPeer));

const europeScored = [euPeer, usPeer, asiaPeer].map((c) => {
  const { score, breakdown } = scoreCandidate(c, europeJd, DEFAULT_SCORING_WEIGHTS);
  return { ...c, matchScore: score, matchBreakdown: breakdown };
});
const euById = Object.fromEntries(europeScored.map((c) => [c.id, c]));
ok(
  `EU candidate outranks US peer with similar skills (EU=${euById["cand-eu"]!.matchScore} US=${euById["cand-us"]!.matchScore})`,
  euById["cand-eu"]!.matchScore > euById["cand-us"]!.matchScore,
);
ok(
  `EU candidate outranks Asia peer with similar skills (EU=${euById["cand-eu"]!.matchScore} Asia=${euById["cand-asia"]!.matchScore})`,
  euById["cand-eu"]!.matchScore > euById["cand-asia"]!.matchScore,
);
const euLoc = euById["cand-eu"]!.matchBreakdown.find((b) => b.key === "location");
const usLoc = euById["cand-us"]!.matchBreakdown.find((b) => b.key === "location");
ok(
  "Europe location rationale names Europe/EMEA",
  /Europe|EMEA|CET/i.test(euLoc?.rationale ?? ""),
);
ok(
  "US dampened on Europe JD (location score gap >= 40)",
  (euLoc?.score ?? 0) - (usLoc?.score ?? 100) >= 40,
);

const europeRanked = selectTopKByMatchScore(europeScored, 3, europeJd);
ok("Europe top-K[0] is EU candidate", europeRanked[0]!.id === "cand-eu");

console.log(`RESULT scoring-quality: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  for (const c of ranked) console.log(`  ${c.id} score=${c.matchScore}`);
  for (const c of europeRanked) console.log(`  europe ${c.id} score=${c.matchScore}`);
  process.exitCode = 1;
}
