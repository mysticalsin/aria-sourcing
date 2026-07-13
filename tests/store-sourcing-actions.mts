import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import {
  createSourcingActions,
  type SourcingActionDependencies,
} from "../src/lib/store/sourcing-actions";
import type { Candidate, HermesState } from "../src/lib/types";

type ActivityDraft = Parameters<SourcingActionDependencies["makeActivity"]>[0];

const sourcingActionsSource = readFileSync(
  new URL("../src/lib/store/sourcing-actions.ts", import.meta.url),
  "utf8",
);
const storeSource = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const launchSource = readFileSync(
  new URL("../src/app/launch/page.tsx", import.meta.url),
  "utf8",
);
const agentRunSource = readFileSync(
  new URL("../src/components/run/agent-run-stream.tsx", import.meta.url),
  "utf8",
);

test("sourcing action boundary is React-free and wired through one stable factory", () => {
  assert.doesNotMatch(sourcingActionsSource, /["']use client["']/);
  assert.doesNotMatch(sourcingActionsSource, /from ["']react["']/);
  assert.match(
    storeSource,
    /createSourcingActions\([\s\S]*?\),\n\s*\[[\s\S]*?commit,[\s\S]*?sourcingMutationAllowed,[\s\S]*?syntheticSourcingAllowed,[\s\S]*?workspaceEffectAllowed,[\s\S]*?workspaceFetch,[\s\S]*?\],/,
  );
  assert.equal((storeSource.match(/const sourceNextBatch = useCallback/g) ?? []).length, 0);
  assert.match(
    launchSource,
    /platform: supabaseEnabled \? undefined : "Talent Pool"/,
  );
  assert.match(launchSource, /sourcingComplete: sourcedCount > 0/);
  assert.match(
    agentRunSource,
    /platform: supabaseEnabled \? undefined : "Talent Pool"/,
  );
  assert.match(
    storeSource,
    /platform: syntheticSourcingAllowed\(\) \? "Talent Pool" : undefined/,
  );
});

const githubUser = {
  login: "live-user",
  name: "Live User",
  email: null,
  company: "Example",
  location: "Toronto",
  bio: "TypeScript engineer",
  blog: null,
  htmlUrl: "https://github.com/live-user",
  publicRepos: 12,
  followers: 34,
  createdAt: "2020-01-01T00:00:00.000Z",
  topLanguage: "TypeScript",
};

function createHarness(options: {
  mutationAllowed?: boolean;
  workspaceAllowed?: boolean;
  syntheticSourcingAllowed?: boolean;
  commitAllowed?: boolean;
  responseBody?: unknown;
  fetchError?: Error;
  afterFetch?: () => void;
  state?: HermesState;
} = {}) {
  let state = structuredClone(options.state ?? buildSeedState());
  let mutationAllowed = options.mutationAllowed ?? true;
  let workspaceAllowed = options.workspaceAllowed ?? true;
  let commitCalls = 0;
  let fetchCalls = 0;
  let recomputeCalls = 0;
  const activityDrafts: ActivityDraft[] = [];
  const events: Array<{ kind: "source"; campaignId: string; count: number }> = [];
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  const dependencies: SourcingActionDependencies = {
    commit: (update) => {
      commitCalls += 1;
      if (options.commitAllowed === false) return false;
      state = update(state);
      return true;
    },
    currentState: () => state,
    sourcingMutationAllowed: () => mutationAllowed,
    workspaceEffectAllowed: () => workspaceAllowed,
    syntheticSourcingAllowed: () => options.syntheticSourcingAllowed ?? true,
    workspaceFetch: async (input, init) => {
      fetchCalls += 1;
      requests.push({ input, init });
      if (options.fetchError) throw options.fetchError;
      options.afterFetch?.();
      return new Response(
        JSON.stringify(
          options.responseBody ?? { ok: true, source: "github", users: [githubUser] },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    makeActivity: (draft) => {
      activityDrafts.push(draft);
      return {
        ...draft,
        id: `activity_${activityDrafts.length}`,
        createdAt: draft.createdAt ?? "2026-07-13T01:00:00.000Z",
      };
    },
    withActivity: (current, activity, campaignId) => ({
      ...current,
      campaigns: campaignId
        ? current.campaigns.map((campaign) =>
            campaign.id === campaignId
              ? { ...campaign, activities: [activity, ...campaign.activities] }
              : campaign,
          )
        : current.campaigns,
      activities: [activity, ...current.activities],
    }),
    recomputeMetrics: (current) => {
      recomputeCalls += 1;
      return current;
    },
    effectiveWeights: (weights) => weights,
    emitSource: (event) => events.push(event),
  };

  const actions = createSourcingActions(dependencies);
  return {
    actions,
    events,
    activityDrafts,
    requests,
    get state() {
      return state;
    },
    set state(next: HermesState) {
      state = next;
    },
    get commitCalls() {
      return commitCalls;
    },
    get fetchCalls() {
      return fetchCalls;
    },
    get recomputeCalls() {
      return recomputeCalls;
    },
    setMutationAllowed(next: boolean) {
      mutationAllowed = next;
    },
    setWorkspaceAllowed(next: boolean) {
      workspaceAllowed = next;
    },
  };
}

test("sourcing fails closed before network or state work when the operator cannot source", async () => {
  const harness = createHarness({ mutationAllowed: false });
  const campaignId = harness.state.campaigns[0].id;
  const result = await harness.actions.sourceNextBatch(campaignId);

  assert.deepEqual(result, {
    ok: false,
    error: "You do not have permission to source candidates in this workspace.",
    source: "forbidden",
  });
  assert.equal(harness.fetchCalls, 0);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.events.length, 0);
});

test("sourcing rejects missing, paused, invalid, and dedicated-provider requests honestly", async () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];

  const missing = await harness.actions.sourceNextBatch("missing");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.source, "not_found");

  harness.state = {
    ...harness.state,
    campaigns: harness.state.campaigns.map((item) =>
      item.id === campaign.id ? { ...item, status: "Paused" } : item,
    ),
  };
  const paused = await harness.actions.sourceNextBatch(campaign.id);
  assert.equal(paused.ok, false);
  if (!paused.ok) assert.equal(paused.source, "paused");

  harness.state = {
    ...harness.state,
    campaigns: harness.state.campaigns.map((item) =>
      item.id === campaign.id ? { ...item, status: "Sourcing" } : item,
    ),
  };
  for (const count of [0, -1, 1.5, 21, 51, Number.NaN]) {
    const invalid = await harness.actions.sourceNextBatch(campaign.id, { count });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.source, "invalid");
  }
  for (const platform of ["Sillage", "Apollo", "Seamless"] as const) {
    const dedicated = await harness.actions.sourceNextBatch(campaign.id, { platform, count: 1 });
    assert.equal(dedicated.ok, false);
    if (!dedicated.ok) {
      assert.equal(dedicated.source, "invalid");
      assert.match(dedicated.error, /dedicated/i);
    }
  }
  const unsupported = await harness.actions.sourceNextBatch(campaign.id, {
    platform: "Unknown" as never,
    count: 1,
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.source, "invalid");

  assert.equal(harness.fetchCalls, 0);
  assert.equal(harness.commitCalls, 0);
});

test("GitHub sourcing commits the exact live batch, activity, metrics, and event", async () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  harness.state = {
    ...harness.state,
    campaigns: harness.state.campaigns.map((item) =>
      item.id === campaign.id
        ? {
            ...item,
            jobAnalysis: { ...item.jobAnalysis, location: "Toronto, Canada" },
            sourcingStrategy: {
              ...item.sourcingStrategy,
              githubQueries: [
                { label: "Primary", query: "language:typescript", estimatedResults: 10 },
              ],
            },
          }
        : item,
    ),
  };

  const result = await harness.actions.sourceNextBatch(campaign.id, {
    platform: "GitHub",
    count: 2,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "github");
  assert.equal(result.accepted.length, 1);
  assert.equal(harness.state.candidates[0].githubUrl, githubUser.htmlUrl);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.recomputeCalls, 1);
  assert.equal(harness.activityDrafts.length, 1);
  assert.match(harness.activityDrafts[0].notes ?? "", /Live GitHub batch/);
  assert.deepEqual(harness.events, [
    { kind: "source", campaignId: campaign.id, count: 1 },
  ]);
  const requestBody = JSON.parse(String(harness.requests[0].init?.body)) as {
    query: string;
    count: number;
    platform: string;
  };
  assert.equal(requestBody.count, 2);
  assert.equal(requestBody.platform, "GitHub");
  assert.match(requestBody.query, /location:"Toronto"/);
});

test("web sourcing scopes the query and never falls back to synthetic profiles", async () => {
  const harness = createHarness({
    responseBody: {
      ok: true,
      source: "web",
      leads: [
        {
          name: "Web Person",
          title: "Product Designer",
          company: "Example",
          url: "https://dribbble.com/web-person",
          snippet: "Figma designer",
        },
      ],
    },
  });
  const campaignId = harness.state.campaigns[0].id;
  const result = await harness.actions.sourceNextBatch(campaignId, {
    platform: "Dribbble",
    count: 1,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "web");
  assert.equal(result.accepted[0]?.provenance, "live");
  const requestBody = JSON.parse(String(harness.requests[0].init?.body)) as { query: string };
  assert.match(requestBody.query, /^site:dribbble\.com /);
});

test("a zero-hit live batch records completion without a source event or metric rewrite", async () => {
  const harness = createHarness({
    responseBody: { ok: true, source: "github", users: [] },
  });
  const campaignId = harness.state.campaigns[0].id;
  const initialCandidateCount = harness.state.candidates.length;

  const result = await harness.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.accepted.length, 0);
    assert.equal(result.skipped.length, 0);
  }
  assert.equal(harness.state.candidates.length, initialCandidateCount);
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.activityDrafts.length, 1);
  assert.equal(harness.recomputeCalls, 0);
  assert.equal(harness.events.length, 0);
});

test("malformed or failed live responses do not mutate state or emit success", async () => {
  const malformed = createHarness({
    responseBody: { ok: true, source: "github", users: [{ login: 42 }] },
  });
  const campaignId = malformed.state.campaigns[0].id;
  const malformedResult = await malformed.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformed.commitCalls, 0);
  assert.equal(malformed.events.length, 0);

  const invalidDate = createHarness({
    responseBody: {
      ok: true,
      source: "github",
      users: [{ ...githubUser, createdAt: "not-a-date" }],
    },
  });
  const invalidDateResult = await invalidDate.actions.sourceNextBatch(
    invalidDate.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(invalidDateResult.ok, false);
  assert.equal(invalidDate.commitCalls, 0);

  const oversized = createHarness({
    responseBody: {
      ok: true,
      source: "github",
      users: [githubUser, { ...githubUser, login: "second-user", htmlUrl: "https://github.com/second-user" }],
    },
  });
  const oversizedResult = await oversized.actions.sourceNextBatch(
    oversized.state.campaigns[0].id,
    { platform: "GitHub", count: 1 },
  );
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversized.commitCalls, 0);

  const blankGithubIdentity = createHarness({
    responseBody: {
      ok: true,
      source: "github",
      users: [{ ...githubUser, login: "   " }],
    },
  });
  const blankGithubResult = await blankGithubIdentity.actions.sourceNextBatch(
    blankGithubIdentity.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(blankGithubResult.ok, false);
  assert.equal(blankGithubIdentity.commitCalls, 0);

  const maliciousWeb = createHarness({
    responseBody: {
      ok: true,
      source: "web",
      leads: [
        {
          name: "Wrong Host",
          title: "Designer",
          company: "Example",
          url: "https://attacker.example/profile",
          snippet: "Figma",
        },
      ],
    },
  });
  const maliciousResult = await maliciousWeb.actions.sourceNextBatch(
    maliciousWeb.state.campaigns[0].id,
    { platform: "Dribbble" },
  );
  assert.equal(maliciousResult.ok, false);
  assert.equal(maliciousWeb.commitCalls, 0);

  const blankWebIdentity = createHarness({
    responseBody: {
      ok: true,
      source: "web",
      leads: [
        {
          name: "   ",
          title: "Designer",
          company: "Example",
          url: "https://dribbble.com/blank-name",
          snippet: "Figma",
        },
      ],
    },
  });
  const blankWebResult = await blankWebIdentity.actions.sourceNextBatch(
    blankWebIdentity.state.campaigns[0].id,
    { platform: "Dribbble" },
  );
  assert.equal(blankWebResult.ok, false);
  assert.equal(blankWebIdentity.commitCalls, 0);

  const failed = createHarness({ fetchError: new Error("provider offline") });
  const failedResult = await failed.actions.sourceNextBatch(failed.state.campaigns[0].id, {
    platform: "GitHub",
  });
  assert.deepEqual(failedResult, {
    ok: false,
    error: "provider offline",
    source: "github",
  });
  assert.equal(failed.commitCalls, 0);
  assert.equal(failed.events.length, 0);

  const upstreamError = createHarness({
    responseBody: {
      ok: false,
      source: "github",
      error: "Bearer secret-token-value-for-test user@example.test",
    },
  });
  const redacted = await upstreamError.actions.sourceNextBatch(
    upstreamError.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(redacted.ok, false);
  if (!redacted.ok) {
    assert.doesNotMatch(redacted.error, /secret-token-value-for-test/);
    assert.doesNotMatch(redacted.error, /user@example\.test/);
  }
});

test("synthetic sourcing requires a demo capability independent of outbound send mode", async () => {
  const demo = createHarness();
  const campaignId = demo.state.campaigns[0].id;
  demo.state.settings.dryRunMode = false;
  const simulated = await demo.actions.sourceNextBatch(campaignId, {
    platform: "Talent Pool",
    count: 2,
  });
  assert.equal(simulated.ok, true);
  if (simulated.ok) {
    assert.equal(simulated.source, "mock");
    assert.equal(
      simulated.accepted.every((candidate) => candidate.provenance === "synthetic"),
      true,
    );
  }

  const live = createHarness({
    state: structuredClone(demo.state),
    syntheticSourcingAllowed: false,
  });
  const blocked = await live.actions.sourceNextBatch(campaignId, {
    platform: "Talent Pool",
    count: 2,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.source, "invalid");
    assert.match(blocked.error, /demo/i);
  }
});

test("sourcing revalidates authority and current dedupe state after live I/O", async () => {
  let authorityHarness: ReturnType<typeof createHarness>;
  authorityHarness = createHarness({
    afterFetch: () => authorityHarness.setMutationAllowed(false),
  });
  const campaignId = authorityHarness.state.campaigns[0].id;
  const denied = await authorityHarness.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.source, "forbidden");
  assert.equal(authorityHarness.commitCalls, 0);
  assert.equal(authorityHarness.events.length, 0);

  let workspaceHarness: ReturnType<typeof createHarness>;
  workspaceHarness = createHarness({
    afterFetch: () => workspaceHarness.setWorkspaceAllowed(false),
  });
  const unavailable = await workspaceHarness.actions.sourceNextBatch(
    workspaceHarness.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.source, "unavailable");
  assert.equal(workspaceHarness.commitCalls, 0);
  assert.equal(workspaceHarness.events.length, 0);

  let dedupeHarness: ReturnType<typeof createHarness>;
  dedupeHarness = createHarness({
    afterFetch: () => {
      const campaign = dedupeHarness.state.campaigns[0];
      const duplicate: Candidate = {
        ...dedupeHarness.state.candidates[0],
        id: "candidate_concurrent",
        campaignId: campaign.id,
        githubUrl: githubUser.htmlUrl,
        email: "",
      };
      dedupeHarness.state = {
        ...dedupeHarness.state,
        candidates: [duplicate, ...dedupeHarness.state.candidates],
      };
    },
  });
  const deduped = await dedupeHarness.actions.sourceNextBatch(
    dedupeHarness.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(deduped.ok, true);
  if (deduped.ok) {
    assert.equal(deduped.accepted.length, 0);
    assert.equal(deduped.skipped.length, 1);
  }
});

test("a rejected commit never reports or emits sourcing success", async () => {
  const harness = createHarness({ commitAllowed: false });
  const campaignId = harness.state.campaigns[0].id;
  const result = await harness.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Workspace changed before the sourced candidates could be saved. Retry sourcing.",
    source: "unavailable",
  });
  assert.equal(harness.commitCalls, 1);
  assert.equal(harness.events.length, 0);
  assert.equal(
    harness.state.candidates.some((candidate) => candidate.githubUrl === githubUser.htmlUrl),
    false,
  );
});
