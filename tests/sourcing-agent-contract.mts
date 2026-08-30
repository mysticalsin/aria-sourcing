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
});

test("tool-loop must not statically import playwright or browser-tools (Fly crash → HTML → invalid response)", () => {
  const toolLoop = readFileSync(new URL("../src/lib/ai/tool-loop.ts", import.meta.url), "utf8");
  const sourcingRoute = readFileSync(
    new URL("../src/app/api/sourcing-agent/route.ts", import.meta.url),
    "utf8",
  );
  // Static import of browser-tools pulls playwright-core into the sourcing-agent
  // module graph. On Fly standalone images browsers.json is missing → Next returns
  // an HTML error page → client: "The sourcing agent returned an invalid response."
  assert.doesNotMatch(toolLoop, /^import\s+.*from\s+["']@\/lib\/ai\/browser-tools["']/m);
  assert.doesNotMatch(toolLoop, /^import\s+.*playwright-core/m);
  assert.match(toolLoop, /await import\(["']@\/lib\/ai\/browser-tools["']\)/);
  assert.match(toolLoop, /export const BUILTIN_BROWSER_URL = "builtin:browser-research"/);
  assert.match(sourcingRoute, /from ["']@\/lib\/ai\/tool-loop["']/);
  assert.doesNotMatch(sourcingRoute, /from ["']@\/lib\/ai\/browser-tools["']/);
  assert.doesNotMatch(sourcingRoute, /playwright/);
  assert.match(sourcingRoute, /soft-filter to schema-valid DTOs/);
});

test("requestReviewedSourcing maps non-JSON agent responses to the stable invalid-response error", async () => {
  const { requestReviewedSourcing } = await import("../src/lib/sourcing/sourcing-agent-client");
  const htmlFetch: typeof fetch = async () =>
    new Response("<html>Internal Server Error</html>", {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  const result = await requestReviewedSourcing(htmlFetch, campaignId, 3);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "The sourcing agent returned an invalid response.");

  const emptyCandidatesOk: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        mode: "deterministic",
        campaignId,
        campaignFingerprint: "fp",
        candidates: [],
        totalFound: 0,
        requestId: "req-1",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        sourcingRunId: "22222222-2222-4222-8222-222222222222",
        appliedLessonIds: [],
        feedbackReceipts: [
          {
            receiptId: "33333333-3333-4333-8333-333333333333",
            platform: "GitHub",
            candidateCount: 0,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const soft = await requestReviewedSourcing(emptyCandidatesOk, campaignId, 3);
  assert.equal(soft.ok, true);
  if (!soft.ok) return;
  assert.equal(soft.value.candidates.length, 0);
  assert.equal(soft.value.totalFound, 0);
});

test("live Calypso-shaped campaigns still project when JobAnalysis has extras and queries lack label", () => {
  const liveShaped = {
    campaigns: [
      {
        ...campaign,
        jobAnalysis: {
          ...campaign.jobAnalysis,
          linkedinBoolean: "(Calypso)",
          localeContext: "Europe/Paris",
          missionDescription: "BA for BNPP Calypso book",
        },
        sourcingStrategy: {
          ...campaign.sourcingStrategy,
          githubQueries: [
            { id: "gq_1", query: "Calypso", rationale: "product signal", estimatedResults: 8 },
            { label: "Calypso Montreal", query: "Calypso location:Montreal", estimatedResults: 40 },
          ],
        },
      },
    ],
    candidates: [],
    settings: { llmProviders: [], savedModels: [], defaultModels: {} },
  };
  const projected = projectSourcingAgentWorkspace(liveShaped, campaignId);
  assert.equal(projected.status, "ok");
  if (projected.status !== "ok") return;
  assert.equal(projected.value.campaign.jobAnalysis.title, campaign.jobAnalysis.title);
  assert.equal(
    "linkedinBoolean" in projected.value.campaign.jobAnalysis,
    false,
  );
  assert.deepEqual(
    projected.value.campaign.sourcingStrategy.githubQueries.map((q) => q.label),
    ["Calypso", "Calypso Montreal"],
  );
});
