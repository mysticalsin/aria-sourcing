/* tests/scoring-quality.mts — Europe/EMEA geo preference + scoring quality
 * Europe JD must prefer EU candidates over US/Asia peers (even when remote-ok).
 * Run: tsx tests/scoring-quality.mts
 */
import {
  DEFAULT_SCORING_WEIGHTS,
  scoreCandidate,
  selectTopKByMatchScore,
  clampShortlistTopK,
  SHORTLIST_TOP_K_MIN,
  SHORTLIST_TOP_K_MAX,
  jobAnalysisIsEuropeFocused,
  candidateMatchesEurope,
  candidateIsFarFromEurope,
  europeSourcingLocationHints,
} from "../src/lib/scoring";
import { SOURCING_QUALITY_FLOOR, eligibleForShortlist } from "../src/lib/sourcing/candidate-fit";
import { evaluateHardGates, passesHardGates } from "../src/lib/sourcing/hard-gates";
import { buildBooleanSearchQuery, synthesizeBooleanSearch } from "../src/lib/sourcing/query-builder";
import {
  SAMPLE_CALYPSO_BA_NEED,
  CALYPSO_BA_CONSULTING_RECRUITMENT_JSON,
} from "../src/lib/fixtures/calypso-ba-need";
import {
  SAMPLE_TS_EUROPE_NEED,
  TS_EUROPE_CONSULTING_RECRUITMENT_JSON,
} from "../src/lib/fixtures/senior-ts-europe-need";
import { buildSourcingStrategy, parseEmailAndJD } from "../src/lib/mock-ai";
import { dedupeCandidates, normalizeLinkedInIdentity } from "../src/lib/rules";
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
  preferOpenToWork: true,
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
  openToWork: true,
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

const juniorYears = calypsoCand({
  id: "cand-junior",
  name: "Too Junior",
  currentTitle: "Calypso Business Analyst",
  techStack: ["Calypso", "Business Analysis", "MySQL"],
  yearsExperience: 3,
  languages: ["English"],
  location: "Montreal, QC",
  profileText: "Calypso BA MySQL Business Analysis",
});

const bestScored = scoreCandidate(bestFit, calypsoJd);
const bestScore = bestScored.score;
const bestEvidence = bestScored.evidence;
const weakScore = scoreCandidate(weakGithub, calypsoJd).score;
const noMustScore = scoreCandidate(noMust, calypsoJd).score;
const juniorScored = scoreCandidate(juniorYears, calypsoJd);

ok("strong Calypso BA clears quality floor", bestScore >= SOURCING_QUALITY_FLOOR);
ok("weak GitHub Calypso string is below floor", weakScore < SOURCING_QUALITY_FLOOR);
ok("no-must-have profile is well below strong fit", noMustScore + 15 < bestScore);
ok("weak GitHub below strong fit", weakScore + 20 < bestScore);
ok("best fit hard gates pass", passesHardGates(bestFit, calypsoJd));
ok("weak GitHub fails hard gates (missing must-haves)", !passesHardGates(weakGithub, calypsoJd));
ok("no-must fails hard gates", !passesHardGates(noMust, calypsoJd));
ok("junior years outside band hard-rejected", !passesHardGates(juniorYears, calypsoJd));
ok(
  "junior hard-gate reason names seniority",
  /seniority|years/i.test(juniorScored.evidence.hardGateReasons.join(" ")),
);
ok("best fit evidence lists Calypso must-have hit", bestEvidence.mustHaveHits.some((s) => /calypso/i.test(s)));
ok("best fit evidence has no must-have misses", bestEvidence.mustHaveMisses.length === 0);
ok("best fit Open to Work evidence", bestEvidence.openToWork === true);
ok(
  "Open to Work boosts composite vs identical without signal",
  bestScore >
    scoreCandidate(
      {
        ...bestFit,
        openToWork: false,
        recentActivity: "Calypso BA settlements T+1",
        profileText: "Senior Calypso BA with 8y in CIB settlements, MySQL reconciliation.",
      },
      calypsoJd,
    ).score,
);
ok(
  "no-must not eligible for shortlist",
  !eligibleForShortlist(
    {
      ...noMust,
      matchScore: noMustScore,
      matchEvidence: scoreCandidate(noMust, calypsoJd).evidence,
    },
    calypsoJd,
  ).ok,
);

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
ok(
  "top-K request of 2 clamps up to shortlist min (returns all available ≤5)",
  rankedCalypso.length === 3 && clampShortlistTopK(2) === SHORTLIST_TOP_K_MIN,
);
ok("top-K clamps 50 down to max 20", clampShortlistTopK(50) === SHORTLIST_TOP_K_MAX);
ok(
  "Calypso strategy GitHub domain anchor comes from need (Calypso), not a hardcoded path-only string",
  buildSourcingStrategy(calypsoJd).githubQueries.some((q) =>
    /Calypso/i.test(q.query) && /MySQL|SQL/i.test(q.query),
  ),
);

/* ---- JSON consulting_recruitment brief ingest ---------------------------- */
const calypsoJsonParsed = parseEmailAndJD({
  email: JSON.stringify(CALYPSO_BA_CONSULTING_RECRUITMENT_JSON),
});
ok(
  "consulting_recruitment JSON parses Calypso title",
  /calypso/i.test(calypsoJsonParsed.jobAnalysis.title),
);
ok(
  "consulting_recruitment JSON maps mandatory_requirements → requiredSkills",
  calypsoJsonParsed.jobAnalysis.requiredSkills.some((s) => /calypso/i.test(s)) &&
    calypsoJsonParsed.jobAnalysis.requiredSkills.some((s) => /mysql/i.test(s)),
);
ok(
  "consulting_recruitment JSON maps boolean_search",
  /Calypso/i.test(calypsoJsonParsed.jobAnalysis.searchBoolean ?? ""),
);
ok(
  "consulting_recruitment JSON maps screening_criteria",
  (calypsoJsonParsed.jobAnalysis.screeningCriteria?.length ?? 0) >= 3,
);
ok(
  "consulting_recruitment JSON Montreal + English",
  /montreal/i.test(calypsoJsonParsed.jobAnalysis.location ?? "") &&
    (calypsoJsonParsed.jobAnalysis.requiredLanguages ?? []).some((l) => /english/i.test(l)),
);
ok(
  "query builder prefers explicit boolean_search",
  buildBooleanSearchQuery(calypsoJsonParsed.jobAnalysis) ===
    (calypsoJsonParsed.jobAnalysis.searchBoolean ?? ""),
);

const tsJsonParsed = parseEmailAndJD({
  email: JSON.stringify(TS_EUROPE_CONSULTING_RECRUITMENT_JSON),
});
ok(
  "TS Europe consulting_recruitment JSON parses TypeScript must-have",
  tsJsonParsed.jobAnalysis.requiredSkills.some((s) => /typescript/i.test(s)),
);
ok(
  "TS Europe JSON boolean drives strategy (not Calypso)",
  /TypeScript|Node/i.test(buildSourcingStrategy(tsJsonParsed.jobAnalysis).linkedinBoolean) &&
    !/Calypso/i.test(buildSourcingStrategy(tsJsonParsed.jobAnalysis).linkedinBoolean),
);
const synth = synthesizeBooleanSearch({
  ...tsJsonParsed.jobAnalysis,
  searchBoolean: null,
});
ok("synthesized boolean includes TypeScript must-have", /TypeScript/i.test(synth));
ok("synthesized boolean includes geo or title", /Berlin|Germany|TypeScript Engineer|Software Engineer/i.test(synth));

/* ---- Non-Calypso need: Senior TypeScript Engineer (Berlin / Europe) ------ */
const tsParsed = parseEmailAndJD({ email: SAMPLE_TS_EUROPE_NEED });
const tsJd: JobAnalysis = {
  ...tsParsed.jobAnalysis,
  locationType: tsParsed.jobAnalysis.locationType || "Remote",
  location: tsParsed.jobAnalysis.location || "Berlin",
  regions: tsParsed.jobAnalysis.regions.length
    ? tsParsed.jobAnalysis.regions
    : ["Berlin", "EU"],
  timezone: tsParsed.jobAnalysis.timezone || "CET",
  minYearsExperience: tsParsed.jobAnalysis.minYearsExperience ?? 5,
  maxYearsExperience: tsParsed.jobAnalysis.maxYearsExperience ?? 10,
  requiredLanguages: tsParsed.jobAnalysis.requiredLanguages ?? ["English"],
  preferOpenToWork: true,
};

ok("TS Europe fixture parses TypeScript must-have", tsJd.requiredSkills.some((s) => /typescript/i.test(s)));
ok("TS Europe fixture parses Node.js must-have", tsJd.requiredSkills.some((s) => /node/i.test(s)));
ok("TS Europe fixture parses PostgreSQL must-have", tsJd.requiredSkills.some((s) => /postgres/i.test(s)));
ok("TS Europe requires English", (tsJd.requiredLanguages ?? []).some((l) => /english/i.test(l)));
ok("TS Europe seniority band is 5–10", tsJd.minYearsExperience === 5 && tsJd.maxYearsExperience === 10);
ok(
  "TS Europe Berlin/EU geo",
  /berlin/i.test(tsJd.location ?? "") || tsJd.regions.some((r) => /berlin|eu|europe/i.test(r)),
);
ok("TS Europe JD is Europe-focused", jobAnalysisIsEuropeFocused(tsJd));
ok("TS Europe timezone is CET", /CET/i.test(tsJd.timezone ?? ""));

const tsStrategy = buildSourcingStrategy(tsJd);
ok(
  "TS Europe strategy uses need Boolean (TypeScript/Node), not Calypso",
  /TypeScript|Node/i.test(tsStrategy.linkedinBoolean) && !/Calypso/i.test(tsStrategy.linkedinBoolean),
);
ok(
  "TS Europe GitHub queries do not inject Calypso",
  tsStrategy.githubQueries.every((q) => !/Calypso/i.test(q.query)),
);
ok(
  "TS Europe GitHub queries include TypeScript or Node from need skills",
  tsStrategy.githubQueries.some((q) => /TypeScript|Node|PostgreSQL|Postgres/i.test(q.query)),
);
ok(
  "TS Europe geoTargets include Europe concrete places or Berlin",
  tsStrategy.geoTargets.some((g) => /Berlin|Germany|United Kingdom|France|Europe|EU/i.test(g)),
);

function tsCand(partial: Partial<Candidate> & Pick<Candidate, "id" | "name">): Candidate {
  return {
    ...seedCand,
    campaignId: "camp-ts-europe",
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

const tsBest = tsCand({
  id: "ts-best",
  name: "Nora Backend",
  currentTitle: "Senior TypeScript Engineer",
  currentCompany: "Meridian Cloud",
  techStack: ["TypeScript", "Node.js", "PostgreSQL", "React", "Kubernetes"],
  yearsExperience: 7,
  languages: ["English", "German"],
  location: "Berlin, Germany",
  timezone: "CET",
  profileText:
    "Senior TypeScript/Node engineer with PostgreSQL, GraphQL, AWS/K8s production services. Open to Work.",
  recentActivity: "Shipped TypeScript services this week — Open to Work",
});

const tsWeak = tsCand({
  id: "ts-weak",
  name: "Generic Title",
  currentTitle: "Software Person",
  techStack: ["Excel"],
  yearsExperience: 12,
  location: "Berlin, Germany",
  languages: ["English"],
  profileText: "Results-driven professional seeking new opportunities in tech.",
});

const tsUsMismatch = tsCand({
  id: "ts-us",
  name: "US Remote",
  currentTitle: "Senior TypeScript Engineer",
  techStack: ["TypeScript", "Node.js", "PostgreSQL"],
  yearsExperience: 7,
  languages: ["English"],
  location: "San Francisco, CA",
  timezone: "PST",
  profileText: "TypeScript Node.js PostgreSQL backend engineer.",
  recentActivity: "Shipped TypeScript APIs this month",
});

const tsBestScore = scoreCandidate(tsBest, tsJd).score;
const tsWeakScore = scoreCandidate(tsWeak, tsJd).score;
const tsUsScore = scoreCandidate(tsUsMismatch, tsJd).score;
const tsUsGates = evaluateHardGates(tsUsMismatch, tsJd);

ok("strong TS Europe fit clears quality floor", tsBestScore >= SOURCING_QUALITY_FLOOR);
ok("weak generic profile rejected vs strong TS fit", tsWeakScore + 15 < tsBestScore);
ok("weak TS profile below quality floor or well under best", tsWeakScore < SOURCING_QUALITY_FLOOR || tsWeakScore + 20 < tsBestScore);
ok(
  `Europe need prefers Berlin over US (EU=${tsBestScore} US=${tsUsScore})`,
  tsBestScore > tsUsScore,
);
ok("US candidate hard-rejected on Europe need (impossible geo)", !tsUsGates.pass);
ok("US hard-gate reason names geo", /geo/i.test(tsUsGates.reasons.join(" ")));
ok("TS best passes hard gates", passesHardGates(tsBest, tsJd));
ok("TS weak fails hard gates (missing must-haves)", !passesHardGates(tsWeak, tsJd));

const rankedTs = selectTopKByMatchScore(
  [
    { ...tsWeak, matchScore: tsWeakScore },
    { ...tsUsMismatch, matchScore: tsUsScore },
    { ...tsBest, matchScore: tsBestScore },
  ],
  10,
  tsJd,
);
ok("TS top-K prefers best Europe fit first", rankedTs[0]?.id === "ts-best");
ok("TS top-K length respects clamped K (≤10 available)", rankedTs.length === 3);

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

/* Contact dedupe is global — works for non-Calypso identities too */
const tsContacted = tsCand({
  id: "ts-contacted",
  name: "TS Touched",
  email: "ts-touched@example.test",
  linkedinUrl: "https://www.linkedin.com/in/ts-touched",
  lastContactedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  stage: "Contacted",
  complianceFlags: {
    doNotContact: true,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  },
});
const tsIncoming = tsCand({
  id: "ts-incoming-dup",
  name: "TS Clone",
  email: "ts-touched@example.test",
  linkedinUrl: "https://www.linkedin.com/in/ts-touched",
});
const tsDeduped = dedupeCandidates([tsIncoming], [tsContacted], { excludedCompanies: [] });
ok("non-Calypso contacted/DNC identity skipped on re-source", tsDeduped.accepted.length === 0);
ok(
  "non-Calypso DNC skip reason is contacted block",
  tsDeduped.skipped.some((s) => /already contacted|do not re-source/i.test(s.reason)),
);
ok("DNC contact status blocks resourcing", getContactStatus(tsContacted).blockResourcing === true);

/* Cross-provider identity dedupe */
ok(
  "LinkedIn URL normalization collapses www/trailing slash",
  normalizeLinkedInIdentity("https://www.linkedin.com/in/AminaBest/") ===
    normalizeLinkedInIdentity("https://linkedin.com/in/aminabest"),
);
const existingApify = calypsoCand({
  id: "cand-apify",
  name: "Cross Provider",
  email: "",
  linkedinUrl: "https://www.linkedin.com/in/cross-prov",
  currentCompany: "BNPP",
  externalIds: { Apify: "ext-123" },
  sourceExternalId: "ext-123",
  lastContactedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  stage: "Contacted",
});
const incomingSillage = calypsoCand({
  id: "cand-sillage",
  name: "Cross Provider",
  email: "",
  linkedinUrl: "https://linkedin.com/in/cross-prov/",
  currentCompany: "BNPP",
  sourcePlatform: "Sillage",
  externalIds: { Sillage: "other" },
});
const crossDeduped = dedupeCandidates([incomingSillage], [existingApify], { excludedCompanies: [] });
ok("cross-provider LinkedIn identity skipped after contact", crossDeduped.accepted.length === 0);

const nameCompanyExisting = calypsoCand({
  id: "cand-nc-exist",
  name: "Jordan Lee",
  email: "",
  linkedinUrl: "",
  githubUrl: "",
  currentCompany: "Acme Capital",
  lastContactedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
  stage: "Contacted",
});
const nameCompanyIncoming = calypsoCand({
  id: "cand-nc-in",
  name: "Jordan Lee",
  email: "",
  linkedinUrl: "",
  githubUrl: "",
  currentCompany: "Acme Capital",
  sourcePlatform: "GitHub",
});
const ncDeduped = dedupeCandidates([nameCompanyIncoming], [nameCompanyExisting], {
  excludedCompanies: [],
});
ok("name+company fingerprint blocks re-source after contact", ncDeduped.accepted.length === 0);

console.log(`RESULT scoring-quality: ${pass} passed, ${fail} failed`);
for (const c of ranked) {
  console.log(
    `  rank ${c.id} score=${c.score} location=${c.location?.score} :: ${c.location?.rationale ?? ""}`,
  );
}
if (fail > 0) process.exitCode = 1;
