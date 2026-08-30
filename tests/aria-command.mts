import assert from "node:assert/strict";
import { campaignToAriaContext, parseCommand } from "../src/lib/aria-command";
import type { Campaign } from "../src/lib/types";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

check("campaignToAriaContext survives missing jobAnalysis (shell crash repro)", () => {
  const malformed = {
    id: "camp:unispike:proof",
    title: null,
  } as unknown as Campaign;
  const ctx = campaignToAriaContext(malformed);
  assert.equal(ctx.id, "camp:unispike:proof");
  assert.equal(ctx.title, "");
  assert.equal(ctx.role, "");
  assert.equal(ctx.location, "");
});

check("campaignToAriaContext uses campaign title when jobAnalysis.title missing", () => {
  const partial = {
    id: "camp_1",
    title: "Staff Backend Engineer",
    jobAnalysis: { regions: ["Paris"], industryExperience: ["Fintech"] },
  } as unknown as Campaign;
  const ctx = campaignToAriaContext(partial);
  assert.equal(ctx.title, "Staff Backend Engineer");
  assert.equal(typeof ctx.role, "string");
  assert.match(ctx.role as string, /Staff Backend Engineer/);
  assert.match(ctx.role as string, /Fintech/);
  assert.equal(ctx.location, "Paris");
});

check("parseCommand stays empty for garbage even with malformed campaigns", () => {
  const plan = parseCommand("asdf qwerty", {
    campaigns: [campaignToAriaContext({ id: "x" } as unknown as Campaign)],
  });
  assert.equal(plan.steps.length, 0);
});

console.log(`RESULT aria-command: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
