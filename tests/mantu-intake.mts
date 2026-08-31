import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseEmailAndJD, isMantuNeedEmail, SAMPLE_MANTU_EMAIL, buildSourcingStrategy } from "../src/lib/mock-ai";
import { SAMPLE_VSS_CALYPSO_BA_MONTREAL } from "../src/lib/fixtures/trading-platform-need";
import { evaluateNeedReadiness } from "../src/lib/needs/readiness";

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
ok("LinkedIn boolean is not an empty AND ()", !/AND\s*\(\s*\)/.test(strategy.linkedinBoolean));
ok("LinkedIn boolean includes a must-have skill", /Linux|Python|Oracle|Calypso/i.test(strategy.linkedinBoolean));

console.log(`RESULT mantu-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
