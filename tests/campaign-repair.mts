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


check("normalizeHermesState repairs sparse replies so /replies cannot throw", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    replies: [
      null,
      {
        id: "reply:sparse",
        candidateId: "cand:1",
        campaignId: "camp:1",
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.equal(normalized.replies.some((r) => !r), false);
  const sparse = normalized.replies.find((r) => r.id === "reply:sparse");
  assert.ok(sparse);
  assert.equal(typeof sparse.body, "string");
  assert.equal(sparse.intent, "UNCLEAR");
  assert.equal(typeof sparse.confidence, "number");
  assert.equal(sparse.handled, false);
});

check("normalizeHermesState repairs sparse bookings agenda so calendar cannot throw", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    bookings: [
      null,
      {
        id: "book:sparse",
        candidateId: "cand:1",
        campaignId: "camp:1",
        startTime: "2026-09-01T10:00:00.000Z",
        endTime: "2026-09-01T10:30:00.000Z",
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.equal(normalized.bookings.some((b) => !b), false);
  const sparse = normalized.bookings.find((b) => b.id === "book:sparse");
  assert.ok(sparse);
  assert.ok(Array.isArray(sparse.agenda));
  assert.equal(sparse.agenda.slice(0, 3).length, 0);
});

check("normalizeHermesState repairs sparse settings notifications/tools arrays", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    settings: {
      ...base.settings,
      notifications: undefined,
      tools: null,
      mcpServers: null,
      llmProviders: null,
      savedModels: null,
      guardrails: null,
    },
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  assert.ok(normalized.settings.notifications);
  assert.equal(typeof normalized.settings.notifications.slack, "boolean");
  assert.equal(typeof normalized.settings.notifications.email, "boolean");
  assert.ok(Array.isArray(normalized.settings.tools));
  assert.ok(Array.isArray(normalized.settings.mcpServers));
  assert.ok(Array.isArray(normalized.settings.llmProviders));
  assert.ok(Array.isArray(normalized.settings.savedModels));
  assert.ok(normalized.settings.guardrails);
  assert.ok(Array.isArray(normalized.settings.guardrails.rules));
});

check("normalizeHermesState repairs candidate experience/education arrays", () => {
  const base = buildSeedState();
  const polluted = {
    ...base,
    version: STATE_VERSION,
    candidates: [
      {
        id: "cand:sparse:arrays",
        campaignId: "camp:1",
        name: "Sparse Arrays",
      },
    ],
  } as unknown as HermesState;

  const normalized = normalizeHermesState(polluted);
  const sparse = normalized.candidates.find((c) => c.id === "cand:sparse:arrays");
  assert.ok(sparse);
  assert.ok(Array.isArray(sparse.experience));
  assert.ok(Array.isArray(sparse.education));
  assert.ok(Array.isArray(sparse.languages));
  assert.ok(Array.isArray(sparse.outreachHistory));
  assert.ok(Array.isArray(sparse.replyHistory));
  assert.equal(sparse.outreachHistory.length, 0);
});

console.log(`RESULT campaign-repair: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
