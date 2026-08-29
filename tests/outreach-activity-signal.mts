import assert from "node:assert/strict";
import { sanitizeOutreachActivitySignal } from "../src/lib/outreach-activity-signal";

const cases: Array<[string, (out: string) => boolean]> = [
  ["60 public repos, 12 followers", (o) => o === "recent open-source work"],
  ["Vos 60 dépôts publics sur GitHub", (o) => o.includes("recent open-source work") && !/\d/.test(o)],
  ["Shipped a zero-downtime migration tool", (o) => o === "Shipped a zero-downtime migration tool"],
  ["Active GitHub profile with recent public work", (o) => o === "Active GitHub profile with recent public work"],
  ["", (o) => o === ""],
  ["no activity signal", (o) => o === ""],
];

let pass = 0;
let fail = 0;
for (const [input, check] of cases) {
  const out = sanitizeOutreachActivitySignal(input);
  if (check(out)) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL: ${JSON.stringify(input)} → ${JSON.stringify(out)}`);
  }
}

assert.equal(fail, 0, `sanitizeOutreachActivitySignal failures=${fail}`);
console.log(`RESULT outreach-activity-signal: ${pass} passed, ${fail} failed`);
