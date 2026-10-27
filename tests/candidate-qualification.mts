import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProvenanceChip } from "../src/components/candidates/consent-passport.tsx";
import { buildSeedState } from "../src/lib/seed.ts";
import { candidateReview, candidateDraftBlocker } from "../src/lib/candidate-review.ts";
import { createCandidateEnrichment } from "../src/lib/store/enrichment-actions.ts";
import { enrichmentOutcome } from "../src/lib/enrichment/result.ts";
import { recordVerifiedEvidence } from "../src/lib/candidate-evidence.ts";
import { recordedCandidateLawfulBasis } from "../src/lib/candidate-lawful-basis.ts";
import type { EnrichmentAttempt, HermesState } from "../src/lib/types.ts";

function fixture() {
  const state = buildSeedState();
  state.campaigns[0].status = "Sourcing";
  Object.assign(state.campaigns[0].jobAnalysis, { requiredSkills: ["Go", "Kubernetes"], title: "Backend Engineer", seniority: "Senior", employmentType: "Full-time", locationType: "Remote", minYearsExperience: 3 });
  state.candidates = [{ ...state.candidates[0], id: "qualification-fixture", campaignId: state.campaigns[0].id, stage: "Sourced", provenance: "live", techStack: ["Go", "Kubernetes"], yearsExperience: 5, email: "", matchScore: 90,
    complianceFlags: { doNotContact: false, suppressed: false, unsubscribed: false, anonymized: false, gdprExportRequested: false, suppressedUntil: null }, vivier: false,
    lawfulBasis: undefined, lawfulBasisSource: undefined, lawfulBasisRecordedAt: undefined }];
  return state;
}

test("next actions follow evidence, contact, permission and human draft review", () => {
  const state = fixture(); const candidate = state.candidates[0]; const campaign = state.campaigns[0];
  const review = () => candidateReview(candidate, campaign, state.settings);
  candidate.techStack = []; candidate.sourceQuery = "Go Kubernetes";
  assert.equal(review().key, "fit"); assert.deepEqual(review().missingSkills, ["Go", "Kubernetes"]);
  candidate.techStack = ["go", " Kubernetes "]; assert.deepEqual(review().missingSkills, []);
  candidate.yearsExperience = null; assert.equal(review().key, "fit");
  candidate.yearsExperience = 5; assert.equal(review().key, "contact");
  candidate.email = "fixture@example.test"; assert.equal(review().key, "permission");
  assert.equal(candidateDraftBlocker(candidate, campaign, "Email"), null, "a draft remains separate from approval");
  candidate.lawfulBasis = "legitimate_interest"; assert.equal(review().key, "permission", "basis without operator receipt is incomplete");
  candidate.lawfulBasisSource = "operator_selection"; candidate.lawfulBasisRecordedAt = "2026-10-27T10:00:00.000Z";
  assert.equal(review().key, "draft"); assert.match(review().detail, /Approval/);
  candidate.complianceFlags.unsubscribed = true; assert.equal(review().key, "blocked");
  assert.ok(candidateDraftBlocker(candidate, campaign, "LinkedIn"));
  candidate.complianceFlags.unsubscribed = false; candidate.stage = "Rejected"; assert.equal(review().key, "blocked");
  candidate.stage = "Sourced"; campaign.status = "Filled"; assert.equal(review().key, "brief");
});

test("no eligible provider and provider refusal do not pretend to be successful empty discovery", () => {
  const attempt = { provider: "Apify", at: new Date().toISOString(), fieldsFilled: [], costUnits: 0 } as const;
  assert.equal(enrichmentOutcome([]).ok, false);
  for (const status of ["not_configured", "budget_exceeded", "error", "deferred", "no_key_field"] as const) {
    assert.equal(enrichmentOutcome([{ ...attempt, fieldsFilled: [], status }]).ok, false);
  }
  assert.equal(enrichmentOutcome([{ ...attempt, fieldsFilled: [], status: "no_data" }]).ok, true);
});

test("provider/public provenance never fabricates a contact basis in the passport", () => {
  const candidate = fixture().candidates[0]; candidate.sourceUrl = "https://github.com/fixture";
  let markup = renderToStaticMarkup(createElement(ProvenanceChip, { candidate }));
  assert.match(markup, /Lawful basis not recorded/); assert.doesNotMatch(markup, /Legitimate interest/);
  Object.assign(candidate, { lawfulBasis: "legitimate_interest", lawfulBasisSource: "operator_selection", lawfulBasisRecordedAt: "2026-10-27T10:00:00.000Z" });
  markup = renderToStaticMarkup(createElement(ProvenanceChip, { candidate }));
  assert.match(markup, /Legitimate interest \(operator recorded\)/);
});

test("verified manual contact records evidence without implying consent or merging identities", () => {
  const state = fixture(); const id = state.candidates[0].id;
  const input = { email: "verified@example.test", linkedinUrl: "https://fr.linkedin.com/in/fixture?trk=public", source: "Verified on public fixture profile", skills: ["Go", "Kubernetes"], yearsExperience: 6 };
  const result = recordVerifiedEvidence(state, id, input, "2026-10-27T10:00:00.000Z", "note");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.candidates[0].email, input.email);
  assert.equal(result.state.candidates[0].linkedinUrl, "https://www.linkedin.com/in/fixture");
  assert.equal(result.state.candidates[0].lawfulBasis, undefined); assert.equal(result.state.candidates[0].stage, "Sourced");
  assert.equal(result.state.candidates[0].yearsExperience, 6);
  const basis = recordVerifiedEvidence(state, id, { ...input, lawfulBasis: "consent" }, "2026-10-27T10:00:00.000Z", "basis-note");
  assert.equal(basis.ok && recordedCandidateLawfulBasis(basis.state.candidates[0]), "consent");
  assert.equal(basis.ok && basis.state.candidates[0].outreachHistory.length, state.candidates[0].outreachHistory.length);
  const unknown = recordVerifiedEvidence(state, id, { ...input, yearsExperience: null }, "now", "note");
  assert.equal(unknown.ok && unknown.state.candidates[0].yearsExperience, null);
  assert.match(result.state.candidates[0].notes![0].text, /Verified on public fixture profile/);
  for (const patch of [{ email: "invalid-address" }, { source: "" }, { yearsExperience: Number.NaN }, { yearsExperience: 99 }, { linkedinUrl: "https://linkedin.com.evil.example/in/fixture" }, { linkedinUrl: "https://linkedin.com/company/fixture" }]) {
    assert.equal(recordVerifiedEvidence(state, id, { ...input, ...patch }, "now", "note").ok, false);
  }
  state.candidates.push({ ...state.candidates[0], id: "other", email: input.email });
  assert.equal(recordVerifiedEvidence(state, id, input, "now", "note").ok, false);
  state.candidates.pop(); state.candidates[0].complianceFlags.anonymized = true;
  assert.equal(recordVerifiedEvidence(state, id, input, "now", "note").ok, false);
});

function harness() {
  let state = fixture();
  let calls = 0; let saves = 0; let failSave = 0; let scope = "workspace-a:1";
  let onFetch: (() => void | Promise<void>) | undefined;
  let onSave: (() => void) | undefined;
  let status: EnrichmentAttempt["status"] = "ok";
  let sent: unknown;
  const enrich = createCandidateEnrichment({
    current: () => state, allowed: () => true, scope: () => scope, defaults: ["skills", "experience"],
    persist: async (fn) => { saves++; onSave?.(); const next = fn(state); if (saves === failSave) return false; state = next; return true; },
    decorate: (s) => s,
    fetch: async (_url, init) => {
      calls++; sent = JSON.parse(String(init?.body)); await onFetch?.();
      return Response.json({ ok: true, patch: { techStack: ["Go", "Kubernetes", "PostgreSQL"], experience: ["Engineer @ Fixture"], education: ["University"], languages: ["French"], matchScore: 95 },
        attempts: [{ provider: "Apify", at: "2026-10-27T10:00:00.000Z", status, fieldsFilled: status === "ok" ? ["experience", "education", "languages"] : [], costUnits: 1 }], spend: 1 });
    },
  });
  return { enrich, get state() { return state; }, get calls() { return calls; }, get saves() { return saves; }, get sent() { return sent; },
    set failSave(value: number) { failSave = value; }, set onFetch(value: (() => void | Promise<void>) | undefined) { onFetch = value; },
    set onSave(value: (() => void) | undefined) { onSave = value; },
    set scope(value: string) { scope = value; }, set status(value: EnrichmentAttempt["status"]) { status = value; }, replaceState(value: HermesState) { state = value; } };
}

test("save-before-egress and durable result save preserve richness and concurrent notes", async () => {
  const h = harness(); const id = h.state.candidates[0].id;
  h.onFetch = () => { h.state.candidates[0].notes = [{ id: "note", text: "Keep this note", at: new Date().toISOString() }]; };
  const result = await h.enrich(id);
  assert.equal(result.ok, true); assert.equal(h.calls, 1); assert.equal(h.saves, 2);
  assert.equal((h.sent as { candidateId: string }).candidateId, id);
  assert.equal((h.sent as { candidate?: unknown }).candidate, undefined, "no client profile/score supplied as authority");
  assert.deepEqual(h.state.candidates[0].experience, ["Engineer @ Fixture"]);
  assert.deepEqual(h.state.candidates[0].languages, ["French"]); assert.equal(h.state.candidates[0].notes?.[0].text, "Keep this note");
  assert.equal(h.state.candidates[0].yearsExperience, 5); assert.equal(h.state.enrichmentLedger?.at(-1)?.units, 1);
});

test("failed preflight makes no provider call; failed completion is never reported as saved", async () => {
  const first = harness(); first.failSave = 1;
  assert.equal((await first.enrich(first.state.candidates[0].id)).ok, false); assert.equal(first.calls, 0);
  const switched = harness(); switched.onSave = () => { switched.scope = "other-workspace:2"; };
  assert.equal((await switched.enrich(switched.state.candidates[0].id)).ok, false); assert.equal(switched.calls, 0);
  const last = harness(); last.failSave = 2;
  const result = await last.enrich(last.state.candidates[0].id);
  assert.equal(result.ok, false); assert.equal(result.spend, 1); assert.match(result.detail, /not saved/);
  assert.notEqual(last.state.candidates[0].matchScore, 95);
});

test("erase/exclude/evidence edit/workspace switch while awaiting provider cannot overwrite newer state", async () => {
  for (const edit of [
    (h: ReturnType<typeof harness>) => { h.state.candidates = []; },
    (h: ReturnType<typeof harness>) => { h.state.candidates[0].complianceFlags.doNotContact = true; },
    (h: ReturnType<typeof harness>) => { h.state.candidates[0].email = "operator-edit@example.test"; },
    (h: ReturnType<typeof harness>) => { h.scope = "workspace-b:2"; },
  ]) {
    const h = harness(); const id = h.state.candidates[0].id; h.onFetch = () => edit(h);
    const result = await h.enrich(id); assert.equal(result.ok, false); assert.equal(h.calls, 1);
    assert.ok(h.state.candidates.every((c) => c.matchScore !== 95));
  }
});

test("double click starts one request and errors retain a saved attempt without success toast", async () => {
  const h = harness(); const id = h.state.candidates[0].id;
  let resume: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { resume = resolve; });
  h.onFetch = () => wait;
  const first = h.enrich(id); const second = await h.enrich(id);
  assert.equal(second.ok, false); assert.match(second.detail, /already in progress/);
  resume!(); await first; assert.equal(h.calls, 1);
  const failed = harness(); failed.status = "error";
  const result = await failed.enrich(failed.state.candidates[0].id);
  assert.equal(result.ok, false); assert.equal(failed.saves, 2); assert.equal(failed.calls, 1);
});

test("batch candidates serialize workspace saves without silently dropping a worker", async () => {
  let state = fixture();
  state.candidates.push({ ...state.candidates[0], id: "second", linkedinUrl: "https://linkedin.com/in/second-fixture" });
  let saving = false; let calls = 0;
  const enrich = createCandidateEnrichment({
    current: () => state, scope: () => "workspace:1", allowed: () => true, defaults: ["email"], decorate: (s) => s,
    persist: async (fn) => {
      if (saving) return false;
      saving = true; await Promise.resolve(); state = fn(state); saving = false; return true;
    },
    fetch: async () => { calls++; return Response.json({ ok: true, patch: {}, attempts: [{ provider: "Apify", at: new Date().toISOString(), status: "no_data", fieldsFilled: [], costUnits: 1 }], spend: 1 }); },
  });
  const results = await Promise.all(state.candidates.map((c) => enrich(c.id)));
  assert.equal(calls, 2); assert.ok(results.every((r) => r.ok)); assert.equal(state.enrichmentLedger?.length, 2);
});
