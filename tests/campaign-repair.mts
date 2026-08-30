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

check("normalizeHermesState fills missing metrics so CampaignCard cannot throw", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    campaigns: [
      {
        id: "camp:sparse:metrics",
        title: "Sparse Metrics Role",
        // metrics intentionally omitted
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  const sparse = normalized.campaigns.find((c) => c.id === "camp:sparse:metrics");
  assert.ok(sparse);
  assert.ok(sparse.metrics);
  assert.equal(typeof sparse.metrics.sourced, "number");
  assert.equal(sparse.metrics.sourced, 0);
  assert.equal(sparse.metrics.contacted, 0);
  // Mimic CampaignCard reads that previously threw TypeError
  assert.equal(sparse.metrics.sourced + sparse.metrics.contacted, 0);
});

check("normalizeHermesState fills missing complianceFlags so /candidates cannot throw", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    candidates: [
      null,
      undefined,
      {
        id: "cand:sparse:flags",
        campaignId: "camp:1",
        name: "Sparse Flags",
        // complianceFlags intentionally omitted
      },
      {
        id: "cand:no-campaign",
        name: "No Campaign",
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.equal(normalized.candidates.some((c) => !c), false);
  const sparse = normalized.candidates.find((c) => c.id === "cand:sparse:flags");
  assert.ok(sparse);
  assert.ok(sparse.complianceFlags);
  assert.equal(sparse.complianceFlags.doNotContact, false);
  assert.equal(sparse.complianceFlags.suppressed, false);
  // Mimic CandidateTable / rules reads that previously threw TypeError
  assert.equal(sparse.complianceFlags.doNotContact, false);
  assert.equal(
    normalized.candidates.some((c) => c.id === "cand:no-campaign"),
    false,
  );
});

check("normalizeHermesState fills missing personalizationEvidence so /outreach cannot throw", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    outreach: [
      null,
      {
        id: "msg:sparse:evidence",
        candidateId: "cand:1",
        campaignId: "camp:1",
        channel: "Email",
        subject: "Hi",
        body: "Hello",
        // personalizationEvidence intentionally omitted
        status: "Needs Approval",
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.equal(normalized.outreach.some((m) => !m), false);
  const sparse = normalized.outreach.find((m) => m.id === "msg:sparse:evidence");
  assert.ok(sparse);
  assert.ok(Array.isArray(sparse.personalizationEvidence));
  assert.equal(sparse.personalizationEvidence.length, 0);
  // Mimic WhyThisPersonChip / OutreachMessageCard reads that previously threw
  assert.equal(sparse.personalizationEvidence.find(() => true), undefined);
  assert.equal(sparse.personalizationEvidence.length > 0, false);
});

console.log(`RESULT campaign-repair: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
