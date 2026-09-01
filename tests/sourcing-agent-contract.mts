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
  assert.match(action, /missingPeoplePluginsToast/);
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
  assert.match(action, /emptyPeopleFirstShortlistError/);
});

test("reviewed sourcing request surfaces MISSING_PLUGIN instead of a generic unconfigured toast", async () => {
  const { requestReviewedSourcing } = await import("../src/lib/sourcing/sourcing-agent-client.ts");
  const { MISSING_PEOPLE_PLUGINS_TOAST, remapPeopleFirstSourcingError, peoplePluginFailLoudUi } =
    await import("../src/lib/sourcing/people-plugins.ts");
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
  assert.equal(toast?.title, "Add a valid Apify key");
  assert.match(String(toast?.description), /MISSING_PLUGIN/);
  assert.doesNotMatch(String(toast?.description), /invalid response/i);
  assert.match(missing, /Apify/);

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
  assert.match(batchAction, /missingPeoplePluginsToast/);
  assert.match(batchAction, /peoplePluginFailLoudUi|emptyPeopleFirstShortlistError/);
  assert.match(page, /visiblePeopleFirstLearningReceipts/);
  assert.match(page, /visibleFeedbackReceipts/);
});
