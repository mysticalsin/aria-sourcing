import { parseEmailAndJD, isMantuNeedEmail, SAMPLE_MANTU_EMAIL } from "../src/lib/mock-ai";

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

console.log(`RESULT mantu-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
