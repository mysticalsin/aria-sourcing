import { defaultGuardrails } from "../src/lib/seed";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const g = defaultGuardrails();
ok("Aria prompt is non-empty", g.ariaPrompt.trim().length > 40);
ok("Aria prompt names Aria", /aria/i.test(g.ariaPrompt));
ok("has rules", g.rules.length >= 6);

const locked = g.rules.filter((r) => r.locked);
const editable = g.rules.filter((r) => !r.locked);
ok("has locked safety rails", locked.length >= 5);
ok("has editable rules", editable.length >= 1);
ok("locked rules are enabled", locked.every((r) => r.enabled));

ok("anti-scrape / no-LinkedIn-automation is locked", locked.some((r) => /scrape|linkedin/i.test(r.text)));
ok("human-approval is locked", locked.some((r) => /approval|dry-run/i.test(r.text)));
ok("humanizer is locked", locked.some((r) => /humaniz/i.test(r.text)));
ok("confidentiality/PII is locked", locked.some((r) => /pii|confidential|mask/i.test(r.text)));

const ids = g.rules.map((r) => r.id);
ok("rule ids are unique", new Set(ids).size === ids.length);

console.log(`RESULT guardrails: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
