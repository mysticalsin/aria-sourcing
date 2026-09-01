import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import {
  candidateFromSourcingAgentDto,
  parseSourcingAgentCandidates,
  projectSourcingAgentWorkspace,
  sourcingAgentCampaignFingerprint,
} from "../src/lib/sourcing/sourcing-agent-contract";

const campaignId = "campaign-1";
const seed = buildSeedState();
const campaign = { ...seed.campaigns[0], id: campaignId, status: "Sourcing" as const };

function dto(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-candidate-1",
    campaignId,
    name: "Ada Example",
    currentTitle: "Staff Engineer",
    currentCompany: "Example Labs",
    location: "Toronto, Canada",
    linkedinUrl: "",
    githubUrl: "https://github.com/ada-example",
    sourcePlatform: "GitHub",
    sourceQuery: "language:TypeScript",
    matchScore: 82,
    matchBreakdown: [
      {
        key: "skills",
        label: "Skills match",
        score: 80,
        weight: 0.5,
        contribution: 40,
        rationale: "Verified public skill overlap.",
      },
    ],
    techStack: ["TypeScript"],
    recentActivity: "Maintains public TypeScript projects.",
    createdAt: "2026-07-13T14:00:00.000Z",
    draftSubject: "A role related to your public work",
    draftBody: "Your public TypeScript work stood out. Would you be open to a short conversation?",
    ...overrides,
  };
}

test("workspace projection owns campaign and dedupe context while stripping unrelated state", () => {
  const state = {
    secret: "must-not-project",
    campaigns: [{ ...campaign, unknown: "strip-me" }],
    candidates: [
      {
        ...seed.candidates[0],
        campaignId,
        notes: [{ id: "note-1", text: "private", at: "2026-07-13T14:00:00.000Z" }],
        sourceAuthorityId: "private-authority",
      },
    ],
  };
  const projected = projectSourcingAgentWorkspace(state, campaignId);
  assert.equal(projected.status, "ok");
  if (projected.status !== "ok") return;
  assert.equal(projected.value.campaign.id, campaignId);
  assert.deepEqual(Object.keys(projected.value.existing[0] ?? {}).sort(), [
    "email",
    "githubUrl",
    "lastContactedAt",
    "linkedinUrl",
  ]);
  assert.equal(JSON.stringify(projected.value).includes("private-authority"), false);
  assert.equal(JSON.stringify(projected.value).includes("private"), false);
});

test("campaign fingerprint changes when the persisted need or search strategy changes", () => {
  const initial = sourcingAgentCampaignFingerprint(campaign);
  const changedRole = sourcingAgentCampaignFingerprint({
    ...campaign,
    jobAnalysis: { ...campaign.jobAnalysis, title: "Changed role" },
  });
  const changedQuery = sourcingAgentCampaignFingerprint({
    ...campaign,
    sourcingStrategy: {
      ...campaign.sourcingStrategy,
      githubQueries: [
        ...campaign.sourcingStrategy.githubQueries,
        { label: "new", query: "language:Rust", estimatedResults: 1 },
      ],
    },
  });
  assert.notEqual(initial, changedRole);
  assert.notEqual(initial, changedQuery);
});

test("strict candidate DTO rejects foreign, duplicate, unsafe, or authority-bearing payloads", () => {
  assert.equal(parseSourcingAgentCandidates([dto()], campaignId, 2)?.length, 1);
  assert.equal(parseSourcingAgentCandidates([dto({ campaignId: "foreign" })], campaignId, 2), null);
  assert.equal(parseSourcingAgentCandidates([dto(), dto()], campaignId, 2), null);
  assert.equal(
    parseSourcingAgentCandidates([dto({ githubUrl: "http://127.0.0.1/private" })], campaignId, 2),
    null,
  );
  assert.equal(
    parseSourcingAgentCandidates([dto({ githubUrl: "https://attacker.example/profile" })], campaignId, 2),
    null,
  );
  assert.equal(
    parseSourcingAgentCandidates([dto({ sourceAuthorityId: "forbidden" })], campaignId, 2),
    null,
  );
});

test("client reconstruction creates a minimal sourced candidate with no injected authority or history", () => {
  const parsed = parseSourcingAgentCandidates([dto()], campaignId, 1);
  assert.ok(parsed);
  const candidate = candidateFromSourcingAgentDto(parsed[0]);
  assert.equal(candidate.campaignId, campaignId);
  assert.equal(candidate.email, "");
  assert.equal(candidate.phone, "");
  assert.equal(candidate.sourceAuthorityId, undefined);
  assert.equal(candidate.sourceExternalId, undefined);
  assert.deepEqual(candidate.outreachHistory, []);
  assert.deepEqual(candidate.replyHistory, []);
  assert.equal(candidate.complianceFlags.anonymized, false);
  assert.equal(candidate.provenance, "live");
});

test("store consumer uses strict response parsing, current authority, commit-time dedupe, and persisted truth", () => {
  const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
  const start = store.indexOf("const runSourcingAgent = useCallback");
  const end = store.indexOf("const generateOutreachFor = useCallback", start);
  const action = store.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(action, /requestReviewedSourcing\(\s*workspaceFetch,\s*campaignId,\s*requestedCount,?\s*\)/);
  assert.doesNotMatch(action, /workspaceFetch\("\/api\/sourcing-agent"/);
  assert.doesNotMatch(action, /campaign:\s*\{/);
  assert.doesNotMatch(action, /existing:/);
  assert.doesNotMatch(action, /provider:\s*cloudConfig/);
  assert.doesNotMatch(action, /apiKeyId:/);
  assert.match(action, /campaignAllowsLiveSourcing\(/);
  assert.match(action, /sourcingAgentCampaignFingerprint\(latestCampaign\)/);
  assert.match(action, /workspaceEffectAllowed\(\).*sourcingMutationAllowed\(\)/s);
  assert.match(action, /commitPersisted\(\(prev\)/);
  assert.match(action, /dedupeCandidates\(/);
  assert.match(action, /if \(!persisted \|\| !authorized\)/);
  assert.doesNotMatch(action, /missingPeoplePluginsToast/);
  assert.doesNotMatch(action, /mode: "fixture"/);
  assert.match(action, /remapPeopleFirstSourcingError/);
  assert.match(action, /isGithubOnlyEmptyBatch/);
});

test("campaign UI presents a completed zero-match search as information, not sourcing success", () => {
  const page = readFileSync(
    new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const start = page.indexOf("const handleRunAgent = async () =>");
  const end = page.indexOf("const handleOpenRun", start);
  const action = page.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(action, /res\.added\s*===\s*0/);
  assert.match(action, /No (?:candidates(?: were)? added|new matches)/i);
  assert.match(action, /variant:\s*"info"/);
  assert.match(action, /peoplePluginFailLoudUi/);
  assert.match(page, /Connect LinkedIn/);
  assert.match(action, /emptyPeopleFirstToast/);
});

test("people-first harvest route never statically loads Playwright or the cloud tool-loop", () => {
  const route = readFileSync(new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url), "utf8");
  const toolLoop = readFileSync(new URL("../src/lib/ai/tool-loop.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /from ["']@\/lib\/ai\/tool-loop["']/);
  assert.doesNotMatch(route, /from ["']@\/lib\/ai\/browser-tools["']/);
  assert.doesNotMatch(route, /from ["']playwright-core["']/);
  assert.match(route, /await import\(["']@\/lib\/ai\/tool-loop["']\)/);
  assert.doesNotMatch(toolLoop, /from ["']@\/lib\/ai\/browser-tools["']/);
  assert.doesNotMatch(toolLoop, /from ["']playwright-core["']/);
  assert.match(toolLoop, /import\(["']@\/lib\/ai\/browser-tools["']\)/);
});

test("keyed people-first harvest is recall-capable Full Apify, not 0-or-toast", () => {
  const route = readFileSync(new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url), "utf8");
  const plan = readFileSync(new URL("../src/lib/sourcing/multi-source-plan.ts", import.meta.url), "utf8");
  const tools = readFileSync(new URL("../src/lib/ai/sourcing-tools.ts", import.meta.url), "utf8");
  const apify = readFileSync(new URL("../src/lib/sourcing/apify.ts", import.meta.url), "utf8");
  const helpers = readFileSync(new URL("../src/lib/store/sourcing-helpers.ts", import.meta.url), "utf8");
  const design = readFileSync(new URL("../docs/sourcing-engine/DESIGN.md", import.meta.url), "utf8");
  assert.match(plan, /PEOPLE_FIRST_SEARCH_BUDGET_MS = 90_000/);
  assert.match(plan, /apifyHarvestQueryFromBrief/);
  assert.match(route, /peopleFirst \? PEOPLE_FIRST_SEARCH_BUDGET_MS : 45_000/);
  assert.match(route, /export const maxDuration = 90/);
  assert.match(route, /PEOPLE_FIRST_HARVEST_NOT_STARTED/);
  assert.match(route, /PEOPLE_FIRST_HARVEST_STILL_RUNNING/);
  assert.match(route, /PEOPLE_FIRST_HARVEST_EMPTY/);
  assert.match(route, /request_entry/);
  assert.match(route, /apifyKeyPresent/);
  assert.match(route, /logAriaHarvest\("request_received"/);
  assert.match(route, /!successfulQuery && !\(peopleFirst && !frameworkAuthorization\)/);
  assert.match(route, /multiSourcePlan.filter\(\(step\) => step.platform === "Apify"\)/);
  assert.match(tools, /profileScraperMode: "Full"/);
  assert.doesNotMatch(tools, /profileScraperMode: "Short"/);
  assert.match(tools, /APIFY_HARVEST_WAIT_MS/);
  assert.match(apify, /APIFY_HARVEST_WAIT_CAP_MS = 90_000/);
  assert.match(apify, /still_running/);
  const harvest = readFileSync(new URL("../src/lib/sourcing/harvest-evidence.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/lib/sourcing/sourcing-agent-client.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/lib/store/sourcing-actions.ts", import.meta.url), "utf8");
  assert.match(harvest, /process\.stdout\.write/);
  assert.doesNotMatch(harvest, /console\.info/);
  assert.match(harvest, /PEOPLE_FIRST_CLIENT_WAIT_MS = 90_000/);
  assert.match(harvest, /PEOPLE_FIRST_HARVEST_ABORTED/);
  assert.match(client, /AbortSignal\.timeout\(PEOPLE_FIRST_CLIENT_WAIT_MS\)/);
  assert.match(client, /formatHarvestEvidenceError\("aborted"/);
  assert.doesNotMatch(actions, /if \(missingPlugins\) \{\s*return await sourceFixtureDryRunBatch/);
  assert.match(helpers, /headline \|\| positionTitle/);
  assert.doesNotMatch(helpers, /headline \|\| jd\.title/);
  assert.match(design, /recall-capable Apify harvestapi/);
  assert.match(design, /Calypso Linux Python/);
  assert.match(design, /\[aria-harvest\]/);
  assert.match(design, /15 identical/);
  assert.match(design, /do not toast[\s\S]*\*\*Open Access & Keys\*\*/);
});

test("reviewed sourcing request surfaces MISSING_PLUGIN instead of a generic unconfigured toast", async () => {
  const { requestReviewedSourcing } = await import("../src/lib/sourcing/sourcing-agent-client.ts");
  const {
    MISSING_PEOPLE_PLUGINS_TOAST,
    PEOPLE_FIRST_HARVEST_UNAVAILABLE,
    remapPeopleFirstSourcingError,
    peoplePluginFailLoudUi,
  } = await import("../src/lib/sourcing/people-plugins.ts");
  const missing = MISSING_PEOPLE_PLUGINS_TOAST;
  const mapped = await requestReviewedSourcing(
    async () =>
      new Response(JSON.stringify({ ok: false, code: "MISSING_PLUGIN", error: missing, requestId: "req-1" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    campaignId,
    5,
  );
  assert.equal(mapped.ok, false);
  if (mapped.ok) return;
  assert.match(mapped.error, /MISSING_PLUGIN/);
  assert.match(mapped.error, /Apify/);
  assert.doesNotMatch(mapped.error, /invalid response/i);

  const financeJob = {
    ...campaign.jobAnalysis,
    title: "Calypso Application Support",
    department: "IS&D - Applicative Support",
    requiredSkills: ["Linux", "Python", "Calypso"],
    industryExperience: ["Fintech"],
  };
  const liveUnconfigured = [
    {
      id: "int_github",
      name: "GitHub Sourcing",
      category: "Sourcing" as const,
      description: "",
      status: "not_configured" as const,
      mode: "live" as const,
      lastSync: null,
      errors: [],
      real: true,
    },
    {
      id: "int_apify",
      name: "Apify (LinkedIn profile search)",
      category: "Sourcing" as const,
      description: "",
      status: "not_configured" as const,
      mode: "live" as const,
      lastSync: null,
      errors: [],
      real: true,
    },
  ];
  assert.equal(
    remapPeopleFirstSourcingError(
      "The sourcing agent returned an invalid response.",
      financeJob,
      liveUnconfigured,
    ),
    missing,
  );
  const staleConnected = [
    {
      ...liveUnconfigured[1],
      status: "connected" as const,
    },
  ];
  assert.equal(
    remapPeopleFirstSourcingError(
      "The sourcing agent returned an invalid response.",
      financeJob,
      staleConnected,
    ),
    missing,
  );
  const toast = peoplePluginFailLoudUi(
    "The sourcing agent returned an invalid response.",
    financeJob,
    liveUnconfigured,
  );
  assert.equal(toast?.title, "Connect Apify");
  assert.match(String(toast?.description), /MISSING_PLUGIN/);
  assert.doesNotMatch(String(toast?.description), /invalid response/i);
  assert.equal(toast?.href, "/settings");
  assert.match(String(toast?.actionLabel), /Connect Apify/);
  assert.match(missing, /Apify/);

  const validApify = [{ provider: "Apify" as const, status: "valid" as const }];
  const crashed = await requestReviewedSourcing(
    async () =>
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    campaignId,
    5,
  );
  assert.equal(crashed.ok, false);
  if (crashed.ok) return;
  assert.equal(
    remapPeopleFirstSourcingError(crashed.error, financeJob, liveUnconfigured, validApify),
    PEOPLE_FIRST_HARVEST_UNAVAILABLE,
  );
  assert.doesNotMatch(
    remapPeopleFirstSourcingError(crashed.error, financeJob, liveUnconfigured, validApify),
    /invalid response|invalid result|MISSING_PLUGIN/i,
  );
  const keyedToast = peoplePluginFailLoudUi(
    crashed.error,
    financeJob,
    liveUnconfigured,
    validApify,
  );
  assert.equal(keyedToast?.title, "Sourcing failed");
  assert.equal(keyedToast?.description, PEOPLE_FIRST_HARVEST_UNAVAILABLE);
  assert.doesNotMatch(String(keyedToast?.description), /invalid response/i);
  assert.doesNotMatch(String(keyedToast?.description), /MISSING_PLUGIN/);
  assert.equal(keyedToast?.href, "/settings");
  assert.match(String(keyedToast?.actionLabel), /Access & Keys/);
  const invalidResultToast = peoplePluginFailLoudUi(
    "The sourcing agent returned an invalid result.",
    financeJob,
    liveUnconfigured,
    validApify,
  );
  assert.ok(invalidResultToast?.href);
  assert.doesNotMatch(String(invalidResultToast?.description), /invalid result/i);
  assert.doesNotMatch(String(invalidResultToast?.description), /MISSING_PLUGIN/);

  const harvestEmpty = await requestReviewedSourcing(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          code: "PEOPLE_FIRST_HARVEST_EMPTY",
          error:
            "People-first harvest returned 0 profiles. actor=harvestapi~linkedin-profile-search query=Calypso Linux Python run=run-empty status=SUCCEEDED items=0. Try Source via Apify with a narrower query.",
          requestId: "req-harvest-empty",
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
    campaignId,
    5,
  );
  assert.equal(harvestEmpty.ok, false);
  if (!harvestEmpty.ok) {
    assert.match(harvestEmpty.error, /run=run-empty/);
    assert.match(harvestEmpty.error, /Calypso Linux Python/);
    assert.match(harvestEmpty.error, /Source via Apify/);
    assert.doesNotMatch(harvestEmpty.error, /unavailable/i);
  }
  const abortedWait = await requestReviewedSourcing(async () => {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    throw error;
  }, campaignId, 5);
  assert.equal(abortedWait.ok, false);
  if (!abortedWait.ok) {
    assert.match(abortedWait.error, /aborted after 90s/);
    assert.match(abortedWait.error, /Do not treat this as 0 people/);
    assert.doesNotMatch(abortedWait.error, /unavailable/i);
  }
  const abortToast = peoplePluginFailLoudUi(
    abortedWait.ok ? "" : abortedWait.error,
    financeJob,
    liveUnconfigured,
    validApify,
  );
  assert.ok(abortToast);
  assert.notEqual(abortToast?.title, "Sourcing failed");
  assert.doesNotMatch(String(abortToast?.description), /0 candidates were added/i);

  const harvestToast = peoplePluginFailLoudUi(
    harvestEmpty.ok ? "" : harvestEmpty.error,
    financeJob,
    liveUnconfigured,
    validApify,
  );
  assert.equal(harvestToast?.href, "#source-apify");
  assert.match(String(harvestToast?.actionLabel), /Source via Apify/);
  assert.doesNotMatch(String(harvestToast?.actionLabel), /Access & Keys/);

  const legacyCode = await requestReviewedSourcing(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          code: "SOURCING_AGENT_NOT_CONFIGURED",
          error: missing,
          requestId: "req-2",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    campaignId,
    5,
  );
  assert.equal(legacyCode.ok, false);
  if (legacyCode.ok) return;
  assert.match(legacyCode.error, /MISSING_PLUGIN/);

  const { visiblePeopleFirstLearningReceipts } = await import("../src/lib/sourcing/people-plugins.ts");
  const githubZero = {
    receiptId: "00000000-0000-4000-8000-000000000001",
    platform: "GitHub" as const,
    candidateCount: 0,
  };
  const linkedinHit = {
    receiptId: "00000000-0000-4000-8000-000000000002",
    platform: "LinkedIn" as const,
    candidateCount: 2,
  };
  assert.deepEqual(
    visiblePeopleFirstLearningReceipts([githubZero, linkedinHit], financeJob, liveUnconfigured),
    [linkedinHit],
  );
  assert.deepEqual(
    visiblePeopleFirstLearningReceipts([githubZero], financeJob, liveUnconfigured),
    [],
  );
});

test("campaign UI keeps durable feedback scoped and merges new run receipts", () => {
  const page = readFileSync(
    new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const start = page.indexOf("const handleRunAgent = async () =>");
  const end = page.indexOf("const handleOpenRun", start);
  const action = page.slice(start, end);
  const batchStart = page.indexOf("const handleSource = async () =>");
  const batchAction = page.slice(batchStart, start);

  assert.match(
    page,
    /current\.campaignId === id[\s\S]*?mergeSourcingFeedbackReceipts\(current\.receipts, receipts\)/,
  );
  assert.match(
    action,
    /current\.campaignId === campaignId[\s\S]*?mergeSourcingFeedbackReceipts\([\s\S]*?current\.receipts,[\s\S]*?res\.feedbackReceipts/,
  );
  assert.doesNotMatch(action, /setFeedbackReceipts\(res\.feedbackReceipts/);
  assert.match(
    batchAction,
    /current\.campaignId === c\.id[\s\S]*?mergeSourcingFeedbackReceipts\([\s\S]*?current\.receipts,[\s\S]*?res\.feedbackReceipts/,
  );
  assert.match(page, /ConnectChannels|cc-connect-channels/);
  assert.match(batchAction, /emptyPeopleFirstToast|peoplePluginFailLoudUi/);
  assert.match(batchAction, /href: failLoud|href: emptyPeopleFirst/);
  assert.match(page, /visiblePeopleFirstLearningReceipts/);
  assert.match(page, /visibleFeedbackReceipts/);
});
