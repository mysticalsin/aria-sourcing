import { parseEmailAndJD } from "../src/lib/mock-ai";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const parsed = parseEmailAndJD({
  email: `From: Priya Nair <priya@brightloop.io>
Subject: Senior Backend Engineer

Hi, we're hiring a Senior Backend Engineer to join our platform team in London.
Must have strong Python and distributed systems experience.

Thanks,
Priya`,
});

ok("extracts London from team in London", parsed.jobAnalysis.location === "London");

console.log(`RESULT intake-location: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
