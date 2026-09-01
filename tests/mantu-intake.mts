import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEmailAndJD, isMantuNeedEmail, SAMPLE_MANTU_EMAIL, SAMPLE_CALYPSO_APP_SUPPORT_NEED, buildSourcingStrategy, createCampaign } from "../src/lib/mock-ai";
import { deriveValidationWarnings } from "../src/lib/ai/intake";
import { SAMPLE_VSS_CALYPSO_BA_MONTREAL } from "../src/lib/fixtures/trading-platform-need";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";
import { roleFamily, roleProfile } from "../src/lib/roles";
import { splitGluedSkillBlob, tokenizeMustHaveSkills } from "../src/lib/sourcing/vss-need";
import { githubSkillQueryToken, repairGithubQueries } from "../src/lib/sourcing/github-search-language";
import { repairLinkedinBoolean } from "../src/lib/sourcing/linkedin-boolean";
import { apifyHarvestQueryFromBrief, plannedSourcingSearches } from "../src/lib/sourcing/multi-source-plan";

const TONY_AMACAN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/tony-calypso-amacan-need.txt"),
  "utf8",
);

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("detects Mantu need format", isMantuNeedEmail(SAMPLE_MANTU_EMAIL));

const p = parseEmailAndJD({ email: SAMPLE_MANTU_EMAIL });
ok("title pulled from 'need is now ACTIVE' (Murex Support)", /murex support/i.test(p.jobAnalysis.title));
ok("urgency = Critical (Priority 1)", p.urgency === "Critical");
ok("intent = Urgent Hire", p.intent === "Urgent Hire");
ok("required skills include Murex", p.jobAnalysis.requiredSkills.some((s) => /murex/i.test(s)));
ok("required skills include Pricing", p.jobAnalysis.requiredSkills.some((s) => /pricing/i.test(s)));
ok("hiring manager = MARGIOTTA Lisa", /margiotta/i.test(p.sender.name));
ok("min years experience = 5", p.jobAnalysis.minYearsExperience === 5);
ok("employmentType = Contract (Consulting)", p.jobAnalysis.employmentType === "Contract");
ok("currency stays unknown when only Montreal is stated", p.jobAnalysis.currency === "");
ok("location type stays unknown when no work arrangement is stated", p.jobAnalysis.locationType === "Unspecified");
ok("offshore captured as nice-to-have", p.jobAnalysis.niceToHaveSkills.some((s) => /offshore/i.test(s)));
ok("salary flagged missing", p.jobAnalysis.validationWarnings.some((w) => w.field === "salary"));

// robustness: a minimal recruiter line must not throw
let threw = false;
try {
  parseEmailAndJD({ email: "Recruiter: Someone\nKey required skills\n- C++ and Go" });
} catch {
  threw = true;
}
ok("no throw on minimal/odd need text", !threw);

ok("Tony AMACAN VSS is detected as a Mantu/VSS need", isMantuNeedEmail(TONY_AMACAN));
const app = parseEmailAndJD({ email: TONY_AMACAN });
ok("VSS paste recovers Calypso Application Support title", /calypso application support/i.test(app.jobAnalysis.title));
ok("VSS urgency is Urgent, not Critical", app.urgency === "Urgent" && app.jobAnalysis.urgency === "Urgent");
ok("VSS seniority is Mid (Middle 4-6)", app.jobAnalysis.seniority === "Mid");
ok("VSS years are 4 to 6", app.jobAnalysis.minYearsExperience === 4 && app.jobAnalysis.maxYearsExperience === 6);
ok("VSS location type is Hybrid (partial remote)", app.jobAnalysis.locationType === "Hybrid");
ok("VSS employment type is specified (CDI/Consulting)", app.jobAnalysis.employmentType !== "Unspecified");
ok(
  "VSS must-haves include Linux Python Shell Oracle Grafana Dynatrace",
  ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace"].every((skill) =>
    app.jobAnalysis.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
  ),
);
ok(
  "VSS adds Calypso as a platform skill from the title/synthesis",
  app.jobAnalysis.requiredSkills.some((s) => s.toLowerCase() === "calypso"),
);
ok("VSS city is Montreal", /montreal/i.test(app.jobAnalysis.location ?? "") || app.jobAnalysis.regions.some((r) => /montreal/i.test(r)));
const unlabeled = parseEmailAndJD({
  email: [
    "Recruitment Need Purpose",
    "Title",
    "Calypso Application Support",
    "Skill (Must)",
    "Linux Python Shell Oracle Grafana Dynatrace Linux Server",
    "Language (Must)",
    "English - Fluent",
    "Remote",
    "Possible partially remote",
    "Type",
    "Consulting",
    "Middle 4-6 years in Montreal",
    "Candidate requirement",
  ].join("\n"),
});
ok(
  "unlabeled Middle 4-6 and Montreal still recover",
  unlabeled.jobAnalysis.seniority === "Mid" &&
    unlabeled.jobAnalysis.minYearsExperience === 4 &&
    unlabeled.jobAnalysis.maxYearsExperience === 6 &&
    (/montreal/i.test(unlabeled.jobAnalysis.location ?? "") ||
      unlabeled.jobAnalysis.regions.some((r) => /montreal/i.test(r))),
);
ok(
  "VSS intake is ready enough to source (no critical readiness holes)",
  evaluateNeedReadiness(app.jobAnalysis).ready,
);

const ba = parseEmailAndJD({ jd: SAMPLE_VSS_CALYPSO_BA_MONTREAL, email: "" });
ok("BA VSS title is Senior Calypso Business Analyst", /senior calypso business analyst/i.test(ba.jobAnalysis.title));
ok("BA VSS urgency is Critical", ba.urgency === "Critical");
ok("BA VSS seniority is Senior 7-10", ba.jobAnalysis.seniority === "Senior" && ba.jobAnalysis.minYearsExperience === 7);
ok(
  "BA must-haves include Calypso Business Analysis MySQL",
  ["Calypso", "Business Analysis", "MySQL"].every((skill) =>
    ba.jobAnalysis.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
  ),
);
ok(
  "BA harvest query is Calypso Business Analyst, not leftover Business Analysis MySQL",
  apifyHarvestQueryFromBrief(ba.jobAnalysis) === "Calypso Business Analyst" &&
    apifyHarvestQueryFromBrief(ba.jobAnalysis) !== "Calypso Business Analysis MySQL",
);
ok(
  "BA scoring chips stay Calypso / Business Analysis / MySQL",
  ["Calypso", "Business Analysis", "MySQL"].every((skill) =>
    ba.jobAnalysis.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
  ),
);

const both = parseEmailAndJD({ email: `${TONY_AMACAN}\n\n${SAMPLE_VSS_CALYPSO_BA_MONTREAL}` });
ok("combined VSS primary is Application Support", /application support/i.test(both.jobAnalysis.title));
ok(
  "combined VSS exposes the BA as an additional need",
  (both.additionalNeeds ?? []).some((need) => /business analyst/i.test(need.title)),
);

const strategy = buildSourcingStrategy(app.jobAnalysis);
ok(
  "GitHub queries do not use language:Calypso",
  strategy.githubQueries.every((q) => !/language:Calypso/i.test(q.query)),
);
ok(
  "GitHub still emits a keyword query for non-language must-haves",
  strategy.githubQueries.length >= 2 &&
    strategy.githubQueries.some((q) => /language:Python/i.test(q.query)),
);
ok("LinkedIn boolean is not an empty AND ()", !/AND\s*\(\s*\)/.test(strategy.linkedinBoolean));
ok("LinkedIn boolean includes a must-have skill", /Linux|Python|Oracle|Calypso/i.test(strategy.linkedinBoolean));
ok(
  "LinkedIn boolean does not quote the Skill (Must) line as one phrase",
  !/"Linux Python Shell Oracle Grafana Dynatrace Linux Server"/i.test(strategy.linkedinBoolean) &&
    /"Linux"/.test(strategy.linkedinBoolean) &&
    /"Python"/.test(strategy.linkedinBoolean),
);
ok(
  "two-word skill names stay one chip",
  tokenizeMustHaveSkills(["Distributed Systems", "Design Systems"]).join("|") ===
    "Distributed Systems|Design Systems",
);
ok(
  "unsplit Skill (Must) line tokenizes on spaces",
  tokenizeMustHaveSkills("Linux Python Shell Oracle Grafana Dynatrace Linux Server").filter((s) =>
    ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server"].some(
      (want) => s.toLowerCase() === want.toLowerCase(),
    ),
  ).length >= 7,
);
ok(
  "unsplit blob never becomes language:LinuxPython…",
  !/language:LinuxPython/i.test(githubSkillQueryToken("Linux Python Shell Oracle Grafana Dynatrace Linux Server")) &&
    buildSourcingStrategy({
      ...app.jobAnalysis,
      requiredSkills: ["Linux Python Shell Oracle Grafana Dynatrace Linux Server"],
    }).githubQueries.every((q) => !/language:LinuxPython/i.test(q.query)),
);
ok(
  "glued CamelCase Skill (Must) line splits into the same chips",
  splitGluedSkillBlob("LinuxPythonShellOracleGrafanaDynatraceLinuxServer").filter((s) =>
    ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server"].some(
      (want) => s.toLowerCase() === want.toLowerCase(),
    ),
  ).length >= 7,
);
ok(
  "glued blob never becomes language:LinuxPython…",
  !/language:LinuxPython/i.test(
    githubSkillQueryToken("LinuxPythonShellOracleGrafanaDynatraceLinuxServer"),
  ) &&
    repairGithubQueries(app.jobAnalysis, [
      {
        label: "stale",
        query: "language:LinuxPythonShellOracleGrafanaDynatraceLinuxServer followers:>40",
        estimatedResults: 0,
      },
    ]).every(
      (q) =>
        !/language:LinuxPython/i.test(q.query) &&
        (/language:Python/i.test(q.query) || /language:Shell/i.test(q.query) || !/language:[A-Za-z]{12,}/.test(q.query)),
    ),
);
ok(
  "repaired GitHub queries use separate skill tokens",
  repairGithubQueries(
    { requiredSkills: ["Linux", "Python", "Shell", "Oracle"] },
    [
      {
        label: "stale",
        query: "language:LinuxPythonShellOracleGrafanaDynatraceLinuxServer",
        estimatedResults: 0,
      },
    ],
  ).some((q) => /language:Python/i.test(q.query)),
);
const staleLinkedin =
  '("Calypso Application Support") AND ("Linux Python Shell Oracle Grafana Dynatrace Linux Server") NOT "recruiter"';
const repairedLinkedin = repairLinkedinBoolean(app.jobAnalysis, staleLinkedin);
ok(
  "stale LinkedIn boolean splits the quoted Skill (Must) phrase into tokens",
  !/"Linux Python Shell Oracle Grafana Dynatrace Linux Server"/i.test(repairedLinkedin) &&
    /"Linux" OR "Python" OR "Shell"/.test(repairedLinkedin) &&
    /"Linux Server"/.test(repairedLinkedin),
);
ok(
  "LinkedIn repair does not split the job title into skill tokens",
  /"Calypso Application Support"/.test(repairedLinkedin),
);
ok(
  "buildSourcingStrategy tokenizes an unsplit Skill (Must) line in the boolean",
  !/"Linux Python Shell Oracle Grafana Dynatrace Linux Server"/i.test(
    buildSourcingStrategy({
      ...app.jobAnalysis,
      requiredSkills: ["Linux Python Shell Oracle Grafana Dynatrace Linux Server"],
    }).linkedinBoolean,
  ),
);
ok("App Support is a finance/trading-platform need, not GitHub-first software", roleFamily(app.jobAnalysis) === "finance");
ok(
  "App Support sources LinkedIn and Apify, not GitHub-only",
  roleProfile(app.jobAnalysis).platforms.includes("LinkedIn") &&
    roleProfile(app.jobAnalysis).platforms.includes("Apify") &&
    roleProfile(app.jobAnalysis).platforms[0] === "LinkedIn",
);
const campFromBlob = createCampaign(
  { ...app.jobAnalysis, requiredSkills: ["Linux Python Shell Oracle Grafana Dynatrace Linux Server"] },
  { hiringManager: "X", hiringManagerEmail: "x@y.example" },
);
ok(
  "createCampaign persists split skills, not one chip",
  ["Linux", "Python", "Shell"].every((skill) =>
    campFromBlob.jobAnalysis.requiredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()),
  ) && !campFromBlob.jobAnalysis.requiredSkills.some((s) => /Linux Python Shell/i.test(s)),
);
const multi = plannedSourcingSearches(campFromBlob);
ok("people-first plan starts with the wired Apify harvest", multi[0]?.platform === "Apify");
ok("multi-source plan includes Apify", multi.some((step) => step.platform === "Apify"));
ok("people-first plan still keeps the LinkedIn boolean after Apify", multi.some((step) => step.platform === "LinkedIn"));
const apifyStep = multi.find((step) => step.platform === "Apify");
ok(
  "Apify harvest query is Calypso Linux Python, not title+six AND and not language:Calypso",
  apifyStep?.query === "Calypso Linux Python" && !/language:/i.test(apifyStep?.query ?? ""),
);
ok(
  "harvestapi query is not the full title jammed with six skills",
  !/Application Support Linux Python Shell Oracle Grafana/i.test(apifyStep?.query ?? ""),
);
ok(
  "people-first Apify harvest does not require a LinkedIn boolean",
  plannedSourcingSearches({
    jobAnalysis: campFromBlob.jobAnalysis,
    sourcingStrategy: { githubQueries: [], linkedinBoolean: "" },
  }).some((step) => step.platform === "Apify" && step.query === "Calypso Linux Python"),
);
ok(
  "apifyHarvestQueryFromBrief is skill-match keywords, not a name",
  apifyHarvestQueryFromBrief(campFromBlob.jobAnalysis) === "Calypso Linux Python",
);
ok(
  "multi-source GitHub steps are not language:Calypso or a skill blob",
  multi
    .filter((step) => step.platform === "GitHub")
    .every((step) => !/language:Calypso|language:LinuxPython/i.test(step.query)),
);
ok("finance / App Support plan has no GitHub steps", multi.every((step) => step.platform !== "GitHub"));
const staleLinkedinPlan = plannedSourcingSearches({
  jobAnalysis: campFromBlob.jobAnalysis,
  sourcingStrategy: {
    ...campFromBlob.sourcingStrategy,
    linkedinBoolean:
      '("Calypso Application Support") AND ("Linux Python Shell Oracle Grafana Dynatrace Linux Server") NOT "recruiter"',
  },
});
ok(
  "planned LinkedIn search splits the quoted Skill (Must) phrase before harvest",
  !/"Linux Python Shell Oracle Grafana Dynatrace Linux Server"/i.test(
    staleLinkedinPlan.find((step) => step.platform === "LinkedIn")?.query ?? "",
  ) &&
    /"Linux" OR "Python"/.test(
      staleLinkedinPlan.find((step) => step.platform === "LinkedIn")?.query ?? "",
    ),
);
ok(
  "planned Apify query uses tokenized skills, not the quoted Skill (Must) phrase",
  !/"Linux Python Shell Oracle Grafana Dynatrace Linux Server"/i.test(
    staleLinkedinPlan.find((step) => step.platform === "Apify")?.query ?? "",
  ) && /Python/i.test(staleLinkedinPlan.find((step) => step.platform === "Apify")?.query ?? ""),
);
ok(
  "Load Mantu sample is Calypso Application Support, not Crédit Agricole Murex",
  /calypso application support/i.test(SAMPLE_CALYPSO_APP_SUPPORT_NEED) &&
    /skill\s*\(\s*must\s*\)/i.test(SAMPLE_CALYPSO_APP_SUPPORT_NEED) &&
    !/cr[eé]dit agricole/i.test(SAMPLE_CALYPSO_APP_SUPPORT_NEED),
);
const blobWarnings = deriveValidationWarnings({
  ...app.jobAnalysis,
  requiredSkills: ["Linux Python Shell Oracle Grafana Dynatrace Linux Server"],
});
ok(
  "validation does not treat a space-separated Skill (Must) line as fewer than 3 skills",
  !blobWarnings.some((w) => /fewer than 3/i.test(w.message)),
);
const campaignPage = readFileSync(
  new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
  "utf8",
);
ok(
  "Strategy tab renders repaired GitHub queries, not the raw glued blob",
  /repairGithubQueries/.test(campaignPage) && /githubQueries\.map/.test(campaignPage),
);
ok(
  "Strategy tab renders a repaired LinkedIn boolean, not the raw quoted skill phrase",
  /repairLinkedinBoolean/.test(campaignPage) && /linkedinBoolean/.test(campaignPage),
);

console.log(`RESULT mantu-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
