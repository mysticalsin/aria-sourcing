import {
  parseEmailAndJD,
  isMantuNeedEmail,
  SAMPLE_MANTU_EMAIL,
  buildLinkedInKeywords,
} from "../src/lib/mock-ai";
import { roleFamily } from "../src/lib/roles";

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
ok("location type is On-site when a city is stated without remote/hybrid", p.jobAnalysis.locationType === "On-site");
ok("offshore captured as nice-to-have", p.jobAnalysis.niceToHaveSkills.some((s) => /offshore/i.test(s)));
ok("salary flagged missing", p.jobAnalysis.validationWarnings.some((w) => w.field === "salary"));

const systemDesigner = parseEmailAndJD({
  email: `Hello,
This need is now ACTIVE: System Designer
Type: Consulting
Category: Active
Status: Running
Client: Magnit Global Canada Ltd
Manager: MAAMAR Nicolas
Recruiter: LAMOUCHI Imène
Priority: 1 - Urgent and critical
Location: MONTREAL
Start date: 8/31/2026
Nb people: 1
Languages: English - Good
Profile description:
5+ years of experience in system design and/or product development within the medical device industry.
Skills: Mean Time to Failure (MTTF) Software,Quality Systems Management,FDA Regulations`,
});
ok("System Designer title parsed", systemDesigner.jobAnalysis.title === "System Designer");
ok("System Designer seniority from 5+ years", systemDesigner.jobAnalysis.seniority === "Senior");
ok("System Designer employment Contract", systemDesigner.jobAnalysis.employmentType === "Contract");
ok("System Designer location On-site Montreal", systemDesigner.jobAnalysis.locationType === "On-site");
ok(
  "System Designer has required skills",
  systemDesigner.jobAnalysis.requiredSkills.some((s) => /FDA|Quality|MTTF/i.test(s)),
);
ok(
  "System Designer profile skills include system design",
  systemDesigner.jobAnalysis.requiredSkills.some((s) => /system design|product development|medical device/i.test(s)),
);
ok("System Designer industry Healthtech", systemDesigner.jobAnalysis.industryExperience.includes("Healthtech"));
ok(
  "System Designer department is client not Type",
  /magnit/i.test(systemDesigner.jobAnalysis.department),
);

ok("System Designer is not finance family", roleFamily(systemDesigner.jobAnalysis) !== "finance");
ok(
  "System Designer LinkedIn query leads with title",
  buildLinkedInKeywords(systemDesigner.jobAnalysis).toLowerCase().startsWith("system designer"),
);

const eightYearsPlus = parseEmailAndJD({
  email: `Hello,
This need is now ACTIVE: Platform Architect
Type: Consulting
Priority: 2 - Urgent
Location: TORONTO
Profile description:
8 years + of experience designing distributed platforms.
Skills: Kubernetes,AWS,Terraform`,
});
ok("8 years + parses to 8", eightYearsPlus.jobAnalysis.minYearsExperience === 8);
ok("8 years + maps to Senior", eightYearsPlus.jobAnalysis.seniority === "Senior");

const atLeastSix = parseEmailAndJD({
  email: `Role: Backend Engineer
Location: Remote
Employment: Full-time
We need at least 6 years of experience with Go.
Skills: Go, Kafka`,
});
ok("at least 6 years → Senior", atLeastSix.jobAnalysis.seniority === "Senior");
ok("at least 6 years floor", atLeastSix.jobAnalysis.minYearsExperience === 6);

// robustness: a minimal recruiter line must not throw
let threw = false;
try {
  parseEmailAndJD({ email: "Recruiter: Someone\nKey required skills\n- C++ and Go" });
} catch {
  threw = true;
}
ok("no throw on minimal/odd need text", !threw);

const javaBrief = parseEmailAndJD({
  email: `Role title: Java Consultant
Location: Paris
Duration: 4 weeks
Headcount: 3
Rate: 650 EUR/day
Employment: Contract/consulting
Skills: Java, Spring, Microservices
We need 5+ years of experience.`,
});
ok("freeform Java Consultant title", /java consultant/i.test(javaBrief.jobAnalysis.title));
ok("freeform Contract/consulting → Contract", javaBrief.jobAnalysis.employmentType === "Contract");
ok("freeform headcount 3", /3/.test(javaBrief.jobAnalysis.teamSize));
ok("freeform day rate 650 EUR", javaBrief.jobAnalysis.salaryMin === 650 && javaBrief.jobAnalysis.currency === "EUR");

console.log(`RESULT mantu-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
