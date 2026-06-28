/* ============================================================================
   tests/linkedin-policy.mts
   Area: LinkedIn policy — ensures skills / prompts cannot bypass the
   assisted-manual rule or instruct LinkedIn automation.
   ========================================================================== */

import { checkLinkedInPolicy } from "../src/lib/linkedin-policy";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("empty text is allowed", checkLinkedInPolicy("").ok === true);
ok("normal outreach copy is allowed", checkLinkedInPolicy("Hi Jane, loved your recent Go post.").ok === true);

const forbidden = [
  "automate linkedin outreach",
  "scrape LinkedIn profiles",
  "login to LinkedIn with credentials",
  "use puppeteer to message people on LinkedIn",
  "send bulk linkedin messages",
  "bypass LinkedIn rate limit",
  "LinkedIn recruiter automation",
  "use a headless browser for LinkedIn",
];
for (const text of forbidden) {
  const res = checkLinkedInPolicy(text);
  ok(`blocks: "${text}"`, res.ok === false && res.matched != null);
}

ok("allows official RSC wording", checkLinkedInPolicy("Use LinkedIn Recruiter System Connect API").ok === true);
ok("allows assisted-manual wording", checkLinkedInPolicy("Operator copies the LinkedIn message and pastes it manually").ok === true);

console.log(`RESULT linkedin-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
