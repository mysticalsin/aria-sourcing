import assert from "node:assert/strict";
import { normalizeHermesState } from "../src/lib/store/migrations";
import { STATE_VERSION, buildSeedState } from "../src/lib/seed";
import type { HermesState } from "../src/lib/types";
import { campaignToAriaContext } from "../src/lib/aria-command";

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

check("normalizeHermesState drops campaign holes and repairs missing jobAnalysis", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    campaigns: [
      null,
      undefined,
      { id: "camp:unispike:proof", title: null },
      base.campaigns[0],
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.equal(normalized.campaigns.some((c) => !c), false);
  const proof = normalized.campaigns.find((c) => c.id === "camp:unispike:proof");
  assert.ok(proof);
  assert.equal(proof.title, "camp:unispike:proof");
  assert.ok(proof.jobAnalysis);
  assert.equal(proof.jobAnalysis.title, "camp:unispike:proof");

  // Shell path that previously crashed global-error
  const ctxs = normalized.campaigns.map(campaignToAriaContext);
  assert.equal(ctxs.length, normalized.campaigns.length);
  assert.ok(ctxs.every((c) => typeof c.id === "string"));
});

console.log(`RESULT campaign-repair: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
