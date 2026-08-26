import { candidateMatchesRoleTitle } from "../src/lib/sourcing/candidate-fit";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "System Designer matches system designer title",
  candidateMatchesRoleTitle(
    { currentTitle: "Senior System Designer", recentActivity: "Medical device product development in Montreal." },
    "System Designer",
  ),
);
ok(
  "Quality manager does not match System Designer",
  !candidateMatchesRoleTitle(
    { currentTitle: "Quality Systems Manager", recentActivity: "FDA and ISO 13485 compliance." },
    "System Designer",
  ),
);
ok(
  "Murex consultant matches Murex Support",
  candidateMatchesRoleTitle(
    { currentTitle: "Murex Front Office Consultant", recentActivity: "Pricing and trading support." },
    "Murex Support",
  ),
);
ok(
  "empty role title accepts any lead",
  candidateMatchesRoleTitle({ currentTitle: "Analyst", recentActivity: "" }, "  "),
);

console.log(`RESULT candidate-fit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
