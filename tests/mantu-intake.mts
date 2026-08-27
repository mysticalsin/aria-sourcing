import {
  parseEmailAndJD,
  isMantuNeedEmail,
  SAMPLE_MANTU_EMAIL,
  buildLinkedInKeywords,
  buildSourcingStrategy,
  SAMPLE_VSS_CALYPSO_APP_SUPPORT,
  SAMPLE_VSS_CALYPSO_BA,
  isVssRecruitmentNeed,
  normalizeIntakePlainText,
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
ok("ACTIVE email mantuNeed format", p.mantuNeed?.format === "active-email");

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

/* ---- VSS Recruitment Need: Calypso Application Support (Tony fixture) ---- */
ok("detects VSS Calypso App Support", isVssRecruitmentNeed(SAMPLE_VSS_CALYPSO_APP_SUPPORT));
ok("isMantuNeedEmail on VSS", isMantuNeedEmail(SAMPLE_VSS_CALYPSO_APP_SUPPORT));
const calApp = parseEmailAndJD({ email: SAMPLE_VSS_CALYPSO_APP_SUPPORT });
const mApp = calApp.mantuNeed!;
ok("Calypso App Support title", calApp.jobAnalysis.title === "Calypso Application Support");
ok("Calypso App Type Consulting → Contract", calApp.jobAnalysis.employmentType === "Contract");
ok("Calypso App Category Active", mApp.category === "Active");
ok("Calypso App Priority Urgent → urgency Urgent", calApp.urgency === "Urgent" && mApp.priority === "Urgent");
ok("Calypso App Reason Opening Position", mApp.reason === "Opening Position");
ok("Calypso App Status Running", mApp.status === "Running");
ok("Calypso App Main Manager", /dupont/i.test(mApp.mainManager) && /dupont/i.test(calApp.sender.name));
ok("Calypso App Secondary Managers", mApp.secondaryManagers.some((s) => /martin/i.test(s)));
ok("Calypso App Main Recruiter", /bernard/i.test(mApp.mainRecruiter));
ok("Calypso App Secondary Recruiters", mApp.secondaryRecruiters.some((s) => /petit/i.test(s)));
ok("Calypso App Company Employed by", /amaris/i.test(mApp.companyEmployedBy));
ok("Calypso App City Paris", /paris/i.test(mApp.city) && calApp.jobAnalysis.regions.some((r) => /paris/i.test(r)));
ok("Calypso App Client", /societe generale/i.test(mApp.client) && /societe generale/i.test(calApp.jobAnalysis.department));
ok("Calypso App Company Billing To", /amaris/i.test(mApp.companyBillingTo));
ok("Calypso App Contract Type", /consulting/i.test(mApp.contractType));
ok("Calypso App Freelancer No", /no/i.test(mApp.freelancer));
ok("Calypso App Start Date ISO", Boolean(calApp.jobAnalysis.expectedStartDate?.startsWith("2026-09-15")));
ok("Calypso App headcount 1", /1/.test(calApp.jobAnalysis.teamSize));
ok("Calypso App Remote Hybrid", calApp.jobAnalysis.locationType === "Hybrid" && /hybrid/i.test(mApp.remote));
ok("Calypso App Client Sector → Fintech", calApp.jobAnalysis.industryExperience.includes("Fintech"));
ok("Calypso App Project Type/Duration", /application support/i.test(mApp.projectType) && /12 months/i.test(mApp.projectDuration));
ok("Calypso App Skill Must includes Calypso+SQL", mApp.skillsMust.some((s) => /calypso/i.test(s)) && mApp.skillsMust.some((s) => /sql/i.test(s)));
ok("Calypso App Skill Nice Java", mApp.skillsNice.some((s) => /java/i.test(s)));
ok("Calypso App Language Must EN/FR", mApp.languagesMust.some((l) => /english/i.test(l)) && mApp.languagesMust.some((l) => /french/i.test(l)));
ok("Calypso App Level + years", /5\+/i.test(mApp.levelOfExperience) && calApp.jobAnalysis.minYearsExperience === 5);
ok("Calypso App mission preserved", /L2\/L3|application support on Calypso/i.test(mApp.missionDescription));
ok("Calypso App Ideal profile Id", mApp.idealProfileId === "CAL-APP-2026-01");
ok("Calypso App Boolean on JD + strategy", /Calypso/i.test(calApp.jobAnalysis.linkedinBoolean ?? "") && /Calypso/i.test(buildSourcingStrategy(calApp.jobAnalysis).linkedinBoolean));
ok("Calypso App is finance family", roleFamily(calApp.jobAnalysis) === "finance");
ok("Calypso App reportingTo = Main Manager", /dupont/i.test(calApp.jobAnalysis.reportingTo));

/* ---- VSS: Senior Calypso Business Analyst ---- */
ok("detects VSS Calypso BA", isVssRecruitmentNeed(SAMPLE_VSS_CALYPSO_BA));
const calBa = parseEmailAndJD({ email: SAMPLE_VSS_CALYPSO_BA });
const mBa = calBa.mantuNeed!;
ok("Calypso BA title", calBa.jobAnalysis.title === "Senior Calypso Business Analyst");
ok("Calypso BA Priority 1 → Critical", calBa.urgency === "Critical");
ok("Calypso BA intent Urgent Hire", calBa.intent === "Urgent Hire");
ok("Calypso BA Main Manager Lefevre", /lefevre/i.test(mBa.mainManager));
ok("Calypso BA secondary managers 2", mBa.secondaryManagers.length >= 2);
ok("Calypso BA Client HSBC", /hsbc/i.test(mBa.client));
ok("Calypso BA City London On-site", /london/i.test(mBa.city) && calBa.jobAnalysis.locationType === "On-site");
ok("Calypso BA headcount 2", /2/.test(calBa.jobAnalysis.teamSize));
ok("Calypso BA start 2026-01-10", Boolean(calBa.jobAnalysis.expectedStartDate?.startsWith("2026-01-10")));
ok("Calypso BA skills Must derivatives", mBa.skillsMust.some((s) => /derivatives|trade lifecycle|business analysis/i.test(s)));
ok("Calypso BA nice Murex", mBa.skillsNice.some((s) => /murex/i.test(s)));
ok("Calypso BA languages must English", mBa.languagesMust.some((l) => /english/i.test(l)));
ok("Calypso BA languages nice French", mBa.languagesNice.some((l) => /french/i.test(l)));
ok("Calypso BA Senior 8 years", calBa.jobAnalysis.seniority === "Senior" && calBa.jobAnalysis.minYearsExperience === 8);
ok("Calypso BA Profile Synthesis body", /Senior BA|Calypso workflows|capital-markets/i.test(mBa.missionDescription));
ok("Calypso BA Target School", /finance|engineering/i.test(mBa.targetSchool));
ok("Calypso BA Ideal profile Id", mBa.idealProfileId === "CAL-BA-2026-09");
ok("Calypso BA LinkedIn Profile URL", /linkedin\.com/i.test(mBa.linkedinProfile));
ok("Calypso BA Boolean", /\("Calypso"\)/.test(mBa.booleanSearch));
ok("Calypso BA education from Target School", /finance|engineering/i.test(calBa.jobAnalysis.education));

/* ---- HTML-stripped VSS paste ---- */
const htmlPaste = `
<div><h1>Summary</h1>
<p>Title: Calypso Application Support</p>
<p>Type: Consulting</p>
<p>Category: Active</p>
<p>Priority: Urgent</p>
<p>Reason: Opening Position</p>
<p>Status: Running</p>
<h2>Recruitment Need Purpose</h2>
<p>Main Manager: DUPONT Marie</p>
<p>Main Recruiter: BERNARD Sophie</p>
<p>City: Paris</p>
<p>Client: Societe Generale</p>
<p>Company Employed by: Amaris Consulting</p>
<h2>Candidate Requirement</h2>
<p>Skill (Must): Calypso, SQL</p>
<p>Language (Must): English - Fluent</p>
<p>Level of Experience: Senior</p>
<p>Mission Description:</p>
<p>Support Calypso production for FO desks.</p>
</div>`;
ok("HTML normalize keeps labels", /Title:\s*Calypso/i.test(normalizeIntakePlainText(htmlPaste)));
const fromHtml = parseEmailAndJD({ email: htmlPaste });
ok("HTML VSS title", fromHtml.jobAnalysis.title === "Calypso Application Support");
ok("HTML VSS manager", /dupont/i.test(fromHtml.mantuNeed?.mainManager ?? ""));
ok("HTML VSS skills", fromHtml.jobAnalysis.requiredSkills.some((s) => /calypso/i.test(s)));

console.log(`RESULT mantu-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
