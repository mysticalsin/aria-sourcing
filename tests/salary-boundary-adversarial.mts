// Adversarial re-verify of the salary disclosure boundary (the phrasings the
// 4-lens verify said a denylist would miss). The allowlist topic-gate must BLOCK
// every leak and PASS the two safe moves.
import { validateCandidateBoundText } from "../src/lib/agent-disclosure-policy";

let pass = 0, fail = 0;
const internal = { salaryMin: 90000, salaryMax: 110000, forbidden: ["Engineering", "VP Eng", "EUR"] };

const LEAKS = [
  "You are well within our range.",
  "You would be at the top of what we do.",
  "C'est dans la fourchette pour nous.",
  "That's workable on our end.",
  "We are in the same ballpark.",
  "You're a bit on the high side.",
  "in-range for us",
  "Our budget is around 100k.",
  "The salary is 95000.",
  "We can go up to 110000 EUR.",
];
const SAFE = [
  "What salary range are you targeting?",
  "A recruiter can discuss compensation with you.",
  "Thanks for your interest! The role uses TypeScript and Kubernetes and needs distributed-systems depth.",
  "What range are you looking for?",
];

for (const l of LEAKS) {
  const r = validateCandidateBoundText(l, internal);
  if (!r.safe) { pass++; } else { fail++; console.log("LEAK PASSED (BAD):", l); }
}
for (const s of SAFE) {
  const r = validateCandidateBoundText(s, internal);
  if (r.safe) { pass++; } else { fail++; console.log("OVER-BLOCKED (BAD):", r.reason, "|", s); }
}
console.log(`RESULT salary-boundary-adversarial: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
