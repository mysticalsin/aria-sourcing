import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import {
  createSourcingActions,
  type SourcingActionDependencies,
} from "../src/lib/store/sourcing-actions";
import { scoreCandidate } from "../src/lib/scoring";
import { buildOutreachPrompt } from "../src/lib/ai/hermes";
import { generateOutreach } from "../src/lib/mock-ai";
import { defaultLiveIntegrations } from "../src/lib/integrations";
import {
  EMPTY_PEOPLE_FIRST_HARVEST,
  PEOPLE_FIRST_HARVEST_UNAVAILABLE,
  peoplePluginFailLoudUi,
} from "../src/lib/sourcing/people-plugins";
import { sourcingAgentCampaignFingerprint } from "../src/lib/sourcing/sourcing-agent-contract";
import type { CampaignStatus, Candidate, HermesState } from "../src/lib/types";

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
const consentPassportSource = readFileSync(
  new URL("../src/components/candidates/consent-passport.tsx", import.meta.url),
  "utf8",
);
const candidateDrawerSource = readFileSync(
  new URL("../src/components/candidates/candidate-drawer.tsx", import.meta.url),
  "utf8",
);
const outreachPageSource = readFileSync(
  new URL("../src/app/outreach/page.tsx", import.meta.url),
  "utf8",
);
const addCandidateDialogSource = readFileSync(
  new URL("../src/components/candidates/add-candidate-dialog.tsx", import.meta.url),
  "utf8",
);
const candidateMappersSource = readFileSync(
  new URL("../src/lib/sourcing/candidate-mappers.ts", import.meta.url),
  "utf8",
);
const sourcingHelpersSource = readFileSync(
  new URL("../src/lib/store/sourcing-helpers.ts", import.meta.url),
  "utf8",
);

test("sourcing action boundary is React-free and wired through one stable factory", () => {
  assert.doesNotMatch(sourcingActionsSource, /["']use client["']/);
  assert.doesNotMatch(sourcingActionsSource, /from ["']react["']/);
  assert.doesNotMatch(
    sourcingActionsSource,
    /sourceEngineFixtureCandidates|jobUsesEngineFixture|@fixture\.example/,
  );
  assert.match(
    storeSource,
    /createSourcingActions\([\s\S]*?\),\n\s*\[[\s\S]*?commit,[\s\S]*?sourcingMutationAllowed,[\s\S]*?syntheticSourcingAllowed,[\s\S]*?workspaceEffectAllowed,[\s\S]*?workspaceFetch,[\s\S]*?\],/,
  );
  assert.equal((storeSource.match(/const sourceNextBatch = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const addCandidateFromGithub = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const addCandidateManual = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const sourceFromApollo = useCallback/g) ?? []).length, 0);
  assert.match(storeSource, /createSourcingActions\([\s\S]*?commitPersisted,/);
  assert.match(sourcingActionsSource, /await commitPersisted\(/);
  assert.match(
    launchSource,
    /platform: supabaseEnabled \? undefined : "Talent Pool"/,
  );
  assert.match(launchSource, /sourcingComplete: sourcedCount > 0/);
  assert.match(
    agentRunSource,
    /executePrimaryAgentSourcing\(\{[\s\S]*?demoAuthorized: !supabaseEnabled && \(!isProduction \|\| demoLoginEnabled\),[\s\S]*?sourceNextBatch: actions\.sourceNextBatch,/,
  );
  assert.match(agentRunSource, /emptyPeopleFirstToast|peoplePluginFailLoudUi/);
  assert.match(agentRunSource, /peoplePluginFailLoudUi/);
  assert.doesNotMatch(
    agentRunSource,
    /\bplatform\s*:/,
    "the UI cannot override the server-reviewed live sourcing platform",
  );
  assert.match(
    storeSource,
    /platform: syntheticSourcingAllowed\(\) \? "Talent Pool" : undefined/,
  );
  assert.doesNotMatch(storeSource, /yearsExperience:\s*0,/);
  assert.doesNotMatch(candidateMappersSource, /yearsExperience:\s*(?:4|jd\.minYearsExperience)/);
  assert.doesNotMatch(sourcingHelpersSource, /yearsExperience:\s*jd\.minYearsExperience/);
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

const apolloProfile = {
  targetId: "11111111-1111-4111-8111-111111111111",
  candidateId: "99999999-9999-4999-8999-999999999999",
  name: "Apollo Candidate",
  title: "Staff Platform Engineer",
  company: "Example",
  linkedinUrl: "https://www.linkedin.com/in/apollo-candidate",
  city: "Toronto",
  state: "Ontario",
  country: "Canada",
  headline: "Staff Platform Engineer",
  seniority: "staff",
  departments: ["Engineering"],
};

function createHarness(options: {
  mutationAllowed?: boolean;
  workspaceAllowed?: boolean;
  syntheticSourcingAllowed?: boolean;
  candidatePersistenceAllowed?: (provenance: NonNullable<Candidate["provenance"]>) => boolean;
  commitAllowed?: boolean;
  persistAllowed?: boolean;
  responseBody?: unknown;
  responseBodies?: unknown[];
  responseStatus?: number;
  responseText?: string;
  responseContentType?: string;
  fetchError?: Error;
  afterFetch?: () => void;
  beforeCommit?: (state: HermesState) => HermesState;
  beforePersist?: (state: HermesState) => HermesState;
  state?: HermesState;
} = {}) {
  let state = structuredClone(options.state ?? buildSeedState());
  if (state.campaigns[0]) {
    state.campaigns[0] = { ...state.campaigns[0], status: "Sourcing" };
  }
  let mutationAllowed = options.mutationAllowed ?? true;
  let workspaceAllowed = options.workspaceAllowed ?? true;
  let commitCalls = 0;
  let persistedCalls = 0;
  let fetchCalls = 0;
  let recomputeCalls = 0;
  const activityDrafts: ActivityDraft[] = [];
  const events: Array<{ kind: "source"; campaignId: string; count: number }> = [];
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  const dependencies: SourcingActionDependencies = {
    commit: (update) => {
      commitCalls += 1;
      if (options.commitAllowed === false) return false;
      if (options.beforeCommit) state = options.beforeCommit(state);
      state = update(state);
      return true;
    },
    commitPersisted: async (update) => {
      persistedCalls += 1;
      if (options.persistAllowed === false) return false;
      if (options.beforePersist) state = options.beforePersist(state);
      state = update(state);
      return true;
    },
    currentState: () => state,
    sourcingMutationAllowed: () => mutationAllowed,
    workspaceEffectAllowed: () => workspaceAllowed,
    syntheticSourcingAllowed: () => options.syntheticSourcingAllowed ?? true,
    candidatePersistenceAllowed: options.candidatePersistenceAllowed ?? (() => true),
    workspaceFetch: async (input, init) => {
      fetchCalls += 1;
      requests.push({ input, init });
      if (options.fetchError) throw options.fetchError;
      if (fetchCalls === 1) options.afterFetch?.();
      const requestUrl = String(input);
      const requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const automaticBody = requestUrl.endsWith("/api/source/apollo/select")
        ? { ok: true, selected: requestBody.candidates }
        : { ok: true, source: "github", users: [githubUser] };
      return new Response(
        options.responseText ??
          JSON.stringify(
            options.responseBodies?.[fetchCalls - 1] ??
              (requestUrl.endsWith("/api/source/apollo/select")
                ? automaticBody
                : options.responseBody ?? automaticBody),
          ),
        {
          status: options.responseStatus ?? 200,
          headers: { "Content-Type": options.responseContentType ?? "application/json" },
        },
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
    get persistedCalls() {
      return persistedCalls;
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

const nonSourcingStatuses = [
  "Intake",
  "Interviewing",
  "Closing",
  "Filled",
  "Paused",
] as const satisfies readonly CampaignStatus[];

const liveSourceActions = ["batch", "github", "apollo"] as const;

test("live batch sourcing uses reviewed campaign authority and returns durable feedback receipts", async () => {
  const seed = buildSeedState();
  const campaign = { ...seed.campaigns[0], status: "Sourcing" as const };
  const receiptId = "33333333-3333-4333-8333-333333333333";
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign] },
    syntheticSourcingAllowed: false,
    responseBody: {
      ok: true,
      campaignId: campaign.id,
      campaignFingerprint: sourcingAgentCampaignFingerprint(campaign),
      mode: "deterministic",
      totalFound: 1,
      requestId: "request-reviewed-1",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      sourcingRunId: "22222222-2222-4222-8222-222222222222",
      appliedLessonIds: [],
      candidates: [
        {
          id: "reviewed-candidate-1",
          campaignId: campaign.id,
          name: "Reviewed Candidate",
          currentTitle: "Staff Platform Engineer",
          currentCompany: "Example",
          location: "Toronto",
          linkedinUrl: "",
          githubUrl: "https://github.com/reviewed-candidate",
          sourceUrl: "https://github.com/reviewed-candidate",
          sourcePlatform: "GitHub",
          sourceQuery: campaign.sourcingStrategy.githubQueries[0]?.query ?? "",
          matchScore: 88,
          matchBreakdown: [],
          techStack: ["TypeScript"],
          recentActivity: "Verified public GitHub work.",
          createdAt: "2026-07-14T12:00:00.000Z",
        },
      ],
      feedbackReceipts: [
        { receiptId, platform: "GitHub", candidateCount: 1 },
      ],
    },
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, {
    platform: "GitHub",
    count: 1,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(String(harness.requests[0]?.input), "/api/sourcing-agent");
  assert.deepEqual(JSON.parse(String(harness.requests[0]?.init?.body)), {
    campaignId: campaign.id,
    count: 1,
  });
  assert.match(String(new Headers(harness.requests[0]?.init?.headers).get("idempotency-key")), /^[0-9a-f-]{36}$/i);
  assert.equal(result.source, "github");
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(result.feedbackReceipts, [
    { receiptId, platform: "GitHub", candidateCount: 1 },
  ]);
  assert.equal(harness.persistedCalls, 1);
  assert.equal(harness.events.length, 1);
});

test("live Source next batch drafts a dry-run first-touch for the shortlist, not below the floor", async () => {
  const seed = buildSeedState();
  const campaign = { ...seed.campaigns[0], status: "Sourcing" as const };
  const skills = campaign.jobAnalysis.requiredSkills;
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], settings: { ...seed.settings, dryRunMode: true } },
    syntheticSourcingAllowed: false,
    responseBody: {
      ok: true,
      campaignId: campaign.id,
      campaignFingerprint: sourcingAgentCampaignFingerprint(campaign),
      mode: "deterministic",
      totalFound: 2,
      requestId: "request-sequence-1",
      idempotencyKey: "77777777-7777-4777-8777-777777777777",
      sourcingRunId: "88888888-8888-4888-8888-888888888888",
      appliedLessonIds: [],
      candidates: [
        {
          id: "shortlist-go-1",
          campaignId: campaign.id,
          name: "Pat Go",
          currentTitle: campaign.jobAnalysis.title,
          currentCompany: "Example",
          location: campaign.jobAnalysis.location ?? "Toronto",
          linkedinUrl: "https://www.linkedin.com/in/pat-go",
          githubUrl: "https://github.com/pat-go",
          sourceUrl: "https://github.com/pat-go",
          sourcePlatform: "GitHub",
          sourceQuery: campaign.sourcingStrategy.githubQueries[0]?.query ?? "",
          matchScore: 88,
          matchBreakdown: [],
          techStack: skills,
          recentActivity: "Shipped Kubernetes and Go work this week.",
          createdAt: "2026-07-14T12:00:00.000Z",
        },
        {
          id: "below-floor-1",
          campaignId: campaign.id,
          name: "Calypso Martinez",
          currentTitle: "Unrelated role",
          currentCompany: "Elsewhere",
          location: "Unknown",
          linkedinUrl: "",
          githubUrl: "https://github.com/calypso-name-only",
          sourceUrl: "https://github.com/calypso-name-only",
          sourcePlatform: "GitHub",
          sourceQuery: campaign.sourcingStrategy.githubQueries[0]?.query ?? "",
          matchScore: 12,
          matchBreakdown: [],
          techStack: [],
          recentActivity: "",
          createdAt: "2026-07-14T12:00:00.000Z",
        },
      ],
      feedbackReceipts: [
        { receiptId: "33333333-3333-4333-8333-333333333333", platform: "GitHub", candidateCount: 2 },
      ],
    },
  });

  const beforeOutreach = harness.state.outreach.length;
  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 2 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const newDrafts = harness.state.outreach.slice(0, harness.state.outreach.length - beforeOutreach);
  assert.ok(newDrafts.length >= 1, "agent must draft first-touch for the shortlist");
  assert.ok(newDrafts.every((message) => message.status === "Needs Approval"));
  assert.ok(newDrafts.every((message) => message.dryRun === true));
  assert.ok(newDrafts.every((message) => message.sentAt === null));
  assert.ok(newDrafts.some((message) => message.candidateId === "shortlist-go-1"));
  assert.ok(!newDrafts.some((message) => message.candidateId === "below-floor-1"));
  assert.match(harness.activityDrafts[0]?.notes ?? "", /dry-run/i);
});

test("a lost framework acknowledgement is typed for reconciliation and the staged replay does not duplicate candidates", async () => {
  const seed = buildSeedState();
  const campaign = { ...seed.campaigns[0], status: "Sourcing" as const };
  const frameworkRunId = "44444444-4444-4444-8444-444444444444";
  const capabilityToken = "s".repeat(43);
  const query = campaign.sourcingStrategy.githubQueries[0]?.query ?? "language:typescript";
  const candidate = {
    id: "reviewed-framework-candidate",
    campaignId: campaign.id,
    name: "Reviewed Framework Candidate",
    currentTitle: "Staff Platform Engineer",
    currentCompany: "Example",
    location: "Toronto",
    linkedinUrl: "",
    githubUrl: "https://github.com/reviewed-framework-candidate",
    sourceUrl: "https://github.com/reviewed-framework-candidate",
    sourcePlatform: "GitHub",
    sourceQuery: query,
    matchScore: 88,
    matchBreakdown: [],
    techStack: ["TypeScript"],
    recentActivity: "Verified public GitHub work.",
    createdAt: "2026-07-14T12:00:00.000Z",
  };
  const stagedResult = {
    ok: true,
    campaignId: campaign.id,
    campaignFingerprint: sourcingAgentCampaignFingerprint(campaign),
    mode: "deterministic",
    totalFound: 1,
    requestId: "request-framework-reconcile",
    idempotencyKey: frameworkRunId,
    sourcingRunId: "55555555-5555-4555-8555-555555555555",
    agentFrameworkRunId: frameworkRunId,
    agentFrameworkResultSha256: "d".repeat(64),
    appliedLessonIds: [],
    candidates: [candidate],
    feedbackReceipts: [{
      receiptId: "66666666-6666-4666-8666-666666666666",
      platform: "GitHub",
      candidateCount: 1,
    }],
  };
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign] },
    syntheticSourcingAllowed: false,
    responseBodies: [
      stagedResult,
      { ok: false, code: "SOURCING_AGENT_UNAVAILABLE" },
      stagedResult,
      { ok: true, status: "completed" },
    ],
  });
  const options = {
    count: 1,
    agentFramework: { runId: frameworkRunId, capabilityToken, query },
  };

  const lostAck = await harness.actions.sourceNextBatch(campaign.id, options);

  assert.deepEqual(lostAck, {
    ok: false,
    error: "Candidates were saved, but the framework persistence receipt could not be confirmed. Retry this run to reconcile it.",
    source: "unavailable",
    retryable: "agent_framework_reconcile",
  });
  assert.equal(harness.state.candidates.filter((item) => item.id === candidate.id).length, 1);
  assert.equal(String(harness.requests[0]?.input), "/api/sourcing-agent");
  assert.equal(String(harness.requests[1]?.input), "/api/sourcing-agent/ack");
  assert.equal(
    new Headers(harness.requests[0]?.init?.headers).get("idempotency-key"),
    frameworkRunId,
  );

  const reconciled = await harness.actions.sourceNextBatch(campaign.id, options);

  assert.equal(reconciled.ok, true);
  if (!reconciled.ok) return;
  assert.equal(reconciled.accepted.length, 0);
  assert.equal(reconciled.skipped.length, 1);
  assert.equal(harness.state.candidates.filter((item) => item.id === candidate.id).length, 1);
  assert.equal(harness.fetchCalls, 4);
  assert.equal(String(harness.requests[2]?.input), "/api/sourcing-agent");
  assert.equal(String(harness.requests[3]?.input), "/api/sourcing-agent/ack");
  assert.equal(
    new Headers(harness.requests[2]?.init?.headers).get("idempotency-key"),
    frameworkRunId,
  );
});

async function runLiveSourceAction(
  harness: ReturnType<typeof createHarness>,
  action: (typeof liveSourceActions)[number],
) {
  const campaignId = harness.state.campaigns[0].id;
  if (action === "batch") {
    return harness.actions.sourceNextBatch(campaignId, { platform: "GitHub", count: 1 });
  }
  if (action === "github") {
    return harness.actions.addCandidateFromGithub(campaignId, "live-user");
  }
  return harness.actions.sourceFromApollo(campaignId, { count: 1 });
}

test("live candidate providers reject every non-sourcing lifecycle before network I/O", async () => {
  for (const status of nonSourcingStatuses) {
    for (const action of liveSourceActions) {
      const harness = createHarness({
        responseBody:
          action === "apollo"
            ? { ok: true, source: "apollo", profiles: [apolloProfile] }
            : undefined,
      });
      const campaignId = harness.state.campaigns[0].id;
      harness.state = {
        ...harness.state,
        campaigns: harness.state.campaigns.map((campaign) =>
          campaign.id === campaignId ? { ...campaign, status } : campaign,
        ),
      };

      const result = await runLiveSourceAction(harness, action);

      if ("ok" in result) assert.equal(result.ok, false, `${action}:${status}`);
      else assert.equal(result.source, "error", `${action}:${status}`);
      assert.equal(harness.fetchCalls, 0, `${action}:${status}`);
      assert.equal(harness.commitCalls, 0, `${action}:${status}`);
      assert.equal(harness.persistedCalls, 0, `${action}:${status}`);
      assert.equal(harness.events.length, 0, `${action}:${status}`);
    }
  }
});

test("live candidate providers recheck lifecycle after I/O and inside the persisted commit", async () => {
  for (const action of liveSourceActions) {
    let afterIo: ReturnType<typeof createHarness>;
    afterIo = createHarness({
      responseBody:
        action === "apollo"
          ? { ok: true, source: "apollo", profiles: [apolloProfile] }
          : undefined,
      afterFetch: () => {
        const campaignId = afterIo.state.campaigns[0].id;
        afterIo.state = {
          ...afterIo.state,
          campaigns: afterIo.state.campaigns.map((campaign) =>
            campaign.id === campaignId ? { ...campaign, status: "Interviewing" } : campaign,
          ),
        };
      },
    });

    const afterIoResult = await runLiveSourceAction(afterIo, action);

    if ("ok" in afterIoResult) assert.equal(afterIoResult.ok, false, `${action}:after-io`);
    else assert.equal(afterIoResult.source, "error", `${action}:after-io`);
    assert.equal(afterIo.fetchCalls, 1, `${action}:after-io`);
    assert.equal(afterIo.persistedCalls, 0, `${action}:after-io`);
    assert.equal(afterIo.events.length, 0, `${action}:after-io`);

    let atCommit: ReturnType<typeof createHarness>;
    atCommit = createHarness({
      responseBody:
        action === "apollo"
          ? { ok: true, source: "apollo", profiles: [apolloProfile] }
          : undefined,
      beforePersist: (state) => ({
        ...state,
        campaigns: state.campaigns.map((campaign) =>
          campaign.id === state.campaigns[0].id
            ? { ...campaign, status: "Closing" }
            : campaign,
        ),
      }),
    });
    const initialCandidates = atCommit.state.candidates.length;

    const atCommitResult = await runLiveSourceAction(atCommit, action);

    if ("ok" in atCommitResult) assert.equal(atCommitResult.ok, false, `${action}:commit`);
    else assert.equal(atCommitResult.source, "error", `${action}:commit`);
    assert.equal(atCommit.fetchCalls, 1, `${action}:commit`);
    assert.equal(atCommit.commitCalls, 0, `${action}:commit`);
    assert.equal(atCommit.persistedCalls, 1, `${action}:commit`);
    assert.equal(atCommit.state.candidates.length, initialCandidates, `${action}:commit`);
    assert.equal(atCommit.events.length, 0, `${action}:commit`);
  }
});

test("manual intake uses its explicit non-terminal lifecycle and persists before success", async () => {
  const allowedStatuses = [
    "Intake",
    "Sourcing",
    "Outreach",
    "Interviewing",
    "Closing",
  ] as const satisfies readonly CampaignStatus[];

  for (const status of [...allowedStatuses, "Filled", "Paused"] as const) {
    const harness = createHarness();
    const campaignId = harness.state.campaigns[0].id;
    harness.state = {
      ...harness.state,
      campaigns: harness.state.campaigns.map((campaign) =>
        campaign.id === campaignId ? { ...campaign, status } : campaign,
      ),
    };

    const result = await harness.actions.addCandidateManual(campaignId, {
      name: `Manual ${status}`,
      lawfulBasis: "consent",
    });

    const expected = status !== "Filled" && status !== "Paused";
    assert.equal(result.ok, expected, status);
    assert.equal(harness.commitCalls, 0, status);
    assert.equal(harness.persistedCalls, expected ? 1 : 0, status);
    assert.equal(harness.events.length, expected ? 1 : 0, status);
  }

  const stale = createHarness({
    beforePersist: (state) => ({
      ...state,
      campaigns: state.campaigns.map((campaign, index) =>
        index === 0 ? { ...campaign, status: "Filled" } : campaign,
      ),
    }),
  });
  const staleCampaignId = stale.state.campaigns[0].id;

  const staleResult = await stale.actions.addCandidateManual(staleCampaignId, {
    name: "Manual Stale",
    lawfulBasis: "consent",
  });

  assert.equal(staleResult.ok, false);
  assert.equal(stale.persistedCalls, 1);
  assert.equal(stale.events.length, 0);
  assert.equal(stale.state.candidates.some((candidate) => candidate.name === "Manual Stale"), false);
});

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

test("specific GitHub and manual intake fail closed for unavailable or unauthorized workspaces", async () => {
  const viewer = createHarness({ mutationAllowed: false });
  const campaignId = viewer.state.campaigns[0].id;

  const githubDenied = await viewer.actions.addCandidateFromGithub(campaignId, "live-user");
  const manualDenied = await viewer.actions.addCandidateManual(campaignId, {
    name: "Manual Person",
    lawfulBasis: "consent",
  });

  assert.equal(githubDenied.ok, false);
  assert.equal(manualDenied.ok, false);
  assert.equal(viewer.fetchCalls, 0);
  assert.equal(viewer.commitCalls, 0);
  assert.equal(viewer.events.length, 0);

  const unavailable = createHarness({ workspaceAllowed: false });
  const unavailableCampaignId = unavailable.state.campaigns[0].id;
  assert.equal(
    (await unavailable.actions.addCandidateFromGithub(unavailableCampaignId, "live-user")).ok,
    false,
  );
  assert.equal(
    (await unavailable.actions.addCandidateManual(unavailableCampaignId, {
      name: "Manual Person",
      lawfulBasis: "consent",
    })).ok,
    false,
  );
  assert.equal(unavailable.fetchCalls, 0);
  assert.equal(unavailable.commitCalls, 0);
});

test("specific GitHub and manual intake reject missing and paused campaigns", async () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;

  assert.equal((await harness.actions.addCandidateFromGithub("missing", "live-user")).ok, false);
  assert.equal((await harness.actions.addCandidateManual("missing", {
    name: "Manual Person",
    lawfulBasis: "consent",
  })).ok, false);

  harness.state = {
    ...harness.state,
    campaigns: harness.state.campaigns.map((campaign) =>
      campaign.id === campaignId ? { ...campaign, status: "Paused" } : campaign,
    ),
  };
  assert.equal((await harness.actions.addCandidateFromGithub(campaignId, "live-user")).ok, false);
  assert.equal((await harness.actions.addCandidateManual(campaignId, {
    name: "Manual Person",
    lawfulBasis: "consent",
  })).ok, false);
  assert.equal(harness.fetchCalls, 0);
  assert.equal(harness.commitCalls, 0);
});

test("specific GitHub intake normalizes login and commits the exact validated profile", async () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;

  const result = await harness.actions.addCandidateFromGithub(campaignId, "  @live-user  ");

  assert.deepEqual(result, { ok: true, added: 1, skipped: 0 });
  assert.equal(harness.fetchCalls, 1);
  assert.equal(harness.persistedCalls, 1);
  assert.equal(harness.recomputeCalls, 1);
  assert.equal(harness.activityDrafts.length, 1);
  assert.deepEqual(harness.activityDrafts[0], {
    type: "sourcing",
    title: "Added @live-user from GitHub",
    notes: "Added a specific, validated GitHub profile.",
    outcome: "1 accepted",
    campaignId,
    linkedEntityType: "campaign",
    linkedEntityId: campaignId,
  });
  assert.deepEqual(harness.events, [{ kind: "source", campaignId, count: 1 }]);
  assert.equal(harness.state.candidates[0].githubUrl, githubUser.htmlUrl);
  const body = JSON.parse(String(harness.requests[0].init?.body)) as {
    username: string;
    count: number;
    platform: string;
  };
  assert.deepEqual(body, { username: "live-user", platform: "GitHub", count: 1 });
});

test("specific GitHub intake rejects invalid identities and unrelated provider results", async () => {
  const invalid = createHarness();
  const campaignId = invalid.state.campaigns[0].id;
  for (const username of [
    "",
    "@",
    "@@live-user",
    "two words",
    "-starts-wrong",
    "ends-wrong-",
    "two--hyphens",
    `${"a".repeat(40)}`,
  ]) {
    const result = await invalid.actions.addCandidateFromGithub(campaignId, username);
    assert.equal(result.ok, false);
  }
  assert.equal(invalid.fetchCalls, 0);

  const mismatch = createHarness({
    responseBody: {
      ok: true,
      source: "github",
      users: [{ ...githubUser, login: "different-user", htmlUrl: "https://github.com/different-user" }],
    },
  });
  const mismatchResult = await mismatch.actions.addCandidateFromGithub(
    mismatch.state.campaigns[0].id,
    "live-user",
  );
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatch.commitCalls, 0);

  const canonicalCase = createHarness({
    responseBody: {
      ok: true,
      source: "github",
      users: [{ ...githubUser, login: "Live-User", htmlUrl: "https://github.com/Live-User" }],
    },
  });
  const canonicalCaseResult = await canonicalCase.actions.addCandidateFromGithub(
    canonicalCase.state.campaigns[0].id,
    "live-user",
  );
  assert.equal(canonicalCaseResult.ok, true);
});

test("specific GitHub intake revalidates authority and latest dedupe state after I/O", async () => {
  let denied: ReturnType<typeof createHarness>;
  denied = createHarness({ afterFetch: () => denied.setMutationAllowed(false) });
  const deniedResult = await denied.actions.addCandidateFromGithub(
    denied.state.campaigns[0].id,
    "live-user",
  );
  assert.equal(deniedResult.ok, false);
  assert.equal(denied.commitCalls, 0);
  assert.equal(denied.events.length, 0);

  let concurrent: ReturnType<typeof createHarness>;
  concurrent = createHarness({
    afterFetch: () => {
      const duplicate: Candidate = {
        ...concurrent.state.candidates[0],
        id: "candidate_concurrent_github",
        campaignId: concurrent.state.campaigns[0].id,
        githubUrl: githubUser.htmlUrl,
        email: "",
      };
      concurrent.state = {
        ...concurrent.state,
        candidates: [duplicate, ...concurrent.state.candidates],
      };
    },
  });
  const duplicateResult = await concurrent.actions.addCandidateFromGithub(
    concurrent.state.campaigns[0].id,
    "live-user",
  );
  assert.deepEqual(duplicateResult, {
    ok: true,
    added: 0,
    skipped: 1,
    skipReason: "Duplicate GitHub",
  });
  assert.equal(concurrent.persistedCalls, 1);
  assert.equal(concurrent.recomputeCalls, 0);
  assert.equal(concurrent.activityDrafts.length, 1);
  assert.deepEqual(concurrent.activityDrafts[0], {
    type: "sourcing",
    title: "@live-user was not added",
    notes: "Skipped by dedupe (Duplicate GitHub).",
    outcome: "0 accepted, 1 skipped",
    campaignId: concurrent.state.campaigns[0].id,
    linkedEntityType: "campaign",
    linkedEntityId: concurrent.state.campaigns[0].id,
  });
  assert.equal(concurrent.events.length, 0);

  const excludedState = buildSeedState();
  excludedState.campaigns[0].sourcingStrategy.excludedCompanies = ["Example"];
  const excluded = createHarness({ state: excludedState });
  const excludedResult = await excluded.actions.addCandidateFromGithub(
    excluded.state.campaigns[0].id,
    "live-user",
  );
  assert.deepEqual(excludedResult, {
    ok: true,
    added: 0,
    skipped: 1,
    skipReason: "Excluded company (Example)",
  });
  assert.equal(excluded.activityDrafts[0]?.title, "@live-user was not added");
  assert.match(excluded.activityDrafts[0]?.notes ?? "", /Excluded company/);
  assert.doesNotMatch(addCandidateDialogSource, /title: "Already in the pipeline"/);

  for (const postFetchMutation of ["workspace", "missing", "paused"] as const) {
    let changed: ReturnType<typeof createHarness>;
    changed = createHarness({
      afterFetch: () => {
        if (postFetchMutation === "workspace") {
          changed.setWorkspaceAllowed(false);
          return;
        }
        const campaignId = changed.state.campaigns[0].id;
        changed.state = {
          ...changed.state,
          campaigns:
            postFetchMutation === "missing"
              ? changed.state.campaigns.filter((campaign) => campaign.id !== campaignId)
              : changed.state.campaigns.map((campaign) =>
                  campaign.id === campaignId ? { ...campaign, status: "Paused" } : campaign,
                ),
        };
      },
    });
    const changedResult = await changed.actions.addCandidateFromGithub(
      changed.state.campaigns[0].id,
      "live-user",
    );
    assert.equal(changedResult.ok, false, postFetchMutation);
    assert.equal(changed.commitCalls, 0, postFetchMutation);
    assert.equal(changed.recomputeCalls, 0, postFetchMutation);
    assert.equal(changed.activityDrafts.length, 0, postFetchMutation);
    assert.equal(changed.events.length, 0, postFetchMutation);
  }
});

test("specific GitHub intake rejects malformed, oversized, unsafe, or failed provider responses", async () => {
  const cases: Array<{ name: string; options: Parameters<typeof createHarness>[0] }> = [
    { name: "non-2xx", options: { responseStatus: 502 } },
    { name: "invalid-json", options: { responseText: "not json" } },
    { name: "source-mismatch", options: { responseBody: { ok: true, source: "web", users: [githubUser] } } },
    { name: "users-missing", options: { responseBody: { ok: true, source: "github" } } },
    { name: "users-not-array", options: { responseBody: { ok: true, source: "github", users: {} } } },
    {
      name: "too-many-users",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [githubUser, { ...githubUser, login: "other", htmlUrl: "https://github.com/other" }],
        },
      },
    },
    {
      name: "unsafe-url",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, htmlUrl: "https://attacker.example/live-user" }],
        },
      },
    },
    {
      name: "wrong-profile-url",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, htmlUrl: "https://github.com/different-user" }],
        },
      },
    },
    {
      name: "github-subdomain",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, htmlUrl: "https://gist.github.com/live-user" }],
        },
      },
    },
    {
      name: "invalid-email",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, email: "not-an-email" }],
        },
      },
    },
    {
      name: "invalid-date",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, createdAt: "not-a-date" }],
        },
      },
    },
    {
      name: "invalid-number",
      options: {
        responseBody: {
          ok: true,
          source: "github",
          users: [{ ...githubUser, followers: Number.NaN }],
        },
      },
    },
  ];

  for (const scenario of cases) {
    const harness = createHarness(scenario.options);
    const result = await harness.actions.addCandidateFromGithub(
      harness.state.campaigns[0].id,
      "live-user",
    );
    assert.equal(result.ok, false, scenario.name);
    assert.equal(harness.commitCalls, 0, scenario.name);
    assert.equal(harness.recomputeCalls, 0, scenario.name);
    assert.equal(harness.activityDrafts.length, 0, scenario.name);
    assert.equal(harness.events.length, 0, scenario.name);
  }

  const upstream = createHarness({
    responseStatus: 502,
    responseBody: {
      ok: false,
      source: "github",
      error: `Bearer secret-token-value-for-test user@example.test ${"x".repeat(500)}`,
    },
  });
  const upstreamResult = await upstream.actions.addCandidateFromGithub(
    upstream.state.campaigns[0].id,
    "live-user",
  );
  assert.equal(upstreamResult.ok, false);
  if (!upstreamResult.ok) {
    assert.doesNotMatch(upstreamResult.error, /secret-token-value-for-test/);
    assert.doesNotMatch(upstreamResult.error, /user@example\.test/);
    assert.ok(upstreamResult.error.length <= 300);
  }
});

test("specific GitHub intake propagates persisted commit rejection without false success", async () => {
  const harness = createHarness({ persistAllowed: false });
  const result = await harness.actions.addCandidateFromGithub(
    harness.state.campaigns[0].id,
    "live-user",
  );
  assert.equal(result.ok, false);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.persistedCalls, 1);
  assert.equal(harness.events.length, 0);
  assert.equal(
    harness.state.candidates.some((candidate) => candidate.githubUrl === githubUser.htmlUrl),
    false,
  );
});

test("manual intake validates bounded operator fields before mutation", async () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;
  const invalidInputs = [
    { name: " " },
    { name: "a".repeat(201) },
    { name: "Manual", email: "not-an-email" },
    { name: "Manual", email: `${"a".repeat(250)}@example.test` },
    { name: "Manual", title: "t".repeat(201) },
    { name: "Manual", location: "l".repeat(201) },
    { name: "Manual", profileUrl: "javascript:alert(1)" },
    { name: "Manual", profileUrl: "http://example.test/profile" },
    { name: "Manual", profileUrl: "https://user:password@example.test/profile" },
    { name: "Manual", profileUrl: "https://127.0.0.2/profile" },
    { name: "Manual", profileUrl: "https://[fd00::1]/profile" },
    { name: "Manual", profileUrl: "https://[::ffff:127.0.0.1]/profile" },
    { name: "Manual", profileUrl: `https://example.test/${"p".repeat(2_100)}` },
    { name: "Manual", skills: Array.from({ length: 31 }, (_, index) => `skill-${index}`) },
    { name: "Manual", skills: ["s".repeat(101)] },
    { name: "Manual", notes: "n".repeat(2_001) },
    { name: "Manual\u0000Person" },
    { name: "Manual", notes: "unsafe\u0000note" },
    null,
    [],
    { name: 42 },
    { name: "Manual", skills: "TypeScript" },
  ];

  for (const input of invalidInputs) {
    const request =
      input && typeof input === "object" && !Array.isArray(input)
        ? { lawfulBasis: "legitimate_interest", ...input }
        : input;
    const result = await harness.actions.addCandidateManual(campaignId, request as never);
    assert.equal(result.ok, false);
  }
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.events.length, 0);
});

test("manual intake preserves unknown facts and canonicalizes supplied evidence", async () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const result = await harness.actions.addCandidateManual(campaign.id, {
    name: "  Manual Person  ",
    email: " PERSON@Example.Test ",
    skills: [" TypeScript ", "typescript", " React "],
    profileUrl: "https://example.test/profiles/manual-person",
    location: " Toronto ",
    notes: " Confirmed by recruiter. ",
    lawfulBasis: "legitimate_interest",
  });

  assert.deepEqual(result, { ok: true, added: 1, skipped: 0 });
  const candidate = harness.state.candidates[0];
  assert.equal(candidate.name, "Manual Person");
  assert.equal(candidate.email, "person@example.test");
  assert.equal(candidate.currentTitle, "");
  assert.equal(candidate.yearsExperience, null);
  assert.equal(candidate.provenance, "manual");
  assert.equal(candidate.sourcePlatform, "Manual");
  assert.equal(candidate.leadSource, "Outbound");
  assert.equal(candidate.lawfulBasis, "legitimate_interest");
  assert.equal(candidate.lawfulBasisSource, "operator_selection");
  assert.ok(Number.isFinite(Date.parse(candidate.lawfulBasisRecordedAt ?? "")));
  assert.deepEqual(candidate.techStack, ["TypeScript", "React"]);
  assert.equal(candidate.location, "Toronto");
  assert.equal(candidate.sourceUrl, "https://example.test/profiles/manual-person");
  assert.equal(candidate.notes?.[0]?.text, "Confirmed by recruiter.");
  assert.match(
    candidate.matchBreakdown.find((item) => item.label === "Experience fit")?.rationale ?? "",
    /unknown|not provided/i,
  );
  assert.equal(harness.recomputeCalls, 1);
  assert.equal(harness.activityDrafts.length, 1);
  assert.deepEqual(harness.activityDrafts[0], {
    type: "sourcing",
    title: "Added Manual Person manually",
    notes: "Operator-entered candidate; no external search involved.",
    outcome: "1 accepted",
    campaignId: campaign.id,
    linkedEntityType: "campaign",
    linkedEntityId: campaign.id,
  });
  assert.deepEqual(harness.events, [{ kind: "source", campaignId: campaign.id, count: 1 }]);
});

test("manual intake projects only the documented fields and cannot override authority-owned state", async () => {
  const harness = createHarness();
  const campaignId = harness.state.campaigns[0].id;
  const result = await harness.actions.addCandidateManual(
    campaignId,
    {
      name: "Manual Person",
      title: "Engineer",
      lawfulBasis: "consent",
      id: "attacker-id",
      campaignId: "attacker-campaign",
      sourcePlatform: "GitHub",
      provenance: "live",
      yearsExperience: 99,
      currentCompany: "Invented Corp",
      stage: "Hired",
      complianceFlags: { suppressed: true },
    } as never,
  );

  assert.deepEqual(result, { ok: true, added: 1, skipped: 0 });
  const candidate = harness.state.candidates[0];
  assert.notEqual(candidate.id, "attacker-id");
  assert.equal(candidate.campaignId, campaignId);
  assert.equal(candidate.sourcePlatform, "Manual");
  assert.equal(candidate.provenance, "manual");
  assert.equal(candidate.yearsExperience, null);
  assert.equal(candidate.currentCompany, "");
  assert.equal(candidate.stage, "Sourced");
  assert.equal(candidate.complianceFlags.suppressed, false);
  assert.equal(candidate.lawfulBasis, "consent");
});

test("unknown experience never becomes a false score, prompt fact, or UI consent claim", () => {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  const candidate: Candidate = {
    ...state.candidates[0],
    yearsExperience: null,
    provenance: "manual",
    sourcePlatform: "Manual",
    leadSource: "Outbound",
    companyStageExperience: [],
    industryExperience: [],
  };
  const scored = scoreCandidate(candidate, campaign.jobAnalysis, campaign.scoringWeights);
  // Signal-aware scoring (bc31d54): a requested-but-unknown dimension anchors
  // at UNKNOWN_ANCHOR (30), is excluded from the weighted composite, and says
  // so — it never silently invents a neutral 50.
  const experience = scored.breakdown.find((item) => item.key === "experience");
  assert.equal(experience?.score, 30);
  assert.match(experience?.rationale ?? "", /unknown/i);
  const companyStage = scored.breakdown.find((item) => item.key === "companyStage");
  const industry = scored.breakdown.find((item) => item.key === "industry");
  assert.equal(companyStage?.score, 30);
  assert.match(companyStage?.rationale ?? "", /unknown/i);
  assert.equal(industry?.score, 30);
  assert.match(industry?.rationale ?? "", /unknown/i);

  const prompt = buildOutreachPrompt({
    candidateName: candidate.name,
    candidateTitle: candidate.currentTitle,
    candidateCompany: candidate.currentCompany,
    techStack: candidate.techStack,
    recentActivity: candidate.recentActivity,
    yearsExperience: candidate.yearsExperience,
    roleTitle: campaign.jobAnalysis.title,
    locationType: campaign.jobAnalysis.locationType,
    regions: campaign.jobAnalysis.regions,
    requiredSkills: campaign.jobAnalysis.requiredSkills,
    tone: "Professional",
    channel: "Email",
    language: "en",
  });
  assert.doesNotMatch(prompt, /Experience:\s*0 years/i);
  assert.match(prompt, /Experience: not provided/i);
  assert.match(consentPassportSource, /candidate\.provenance === "manual"/);
  assert.match(consentPassportSource, /Lawful basis not recorded/i);
  assert.match(candidateDrawerSource, /yearsExperience == null/);
  assert.match(outreachPageSource, /yearsExperience == null/);

  const regional = scoreCandidate(
    { ...candidate, location: campaign.jobAnalysis.regions[0] ?? "Toronto", timezone: "" },
    { ...campaign.jobAnalysis, timezone: "" },
    campaign.scoringWeights,
  ).breakdown.find((item) => item.key === "location");
  assert.doesNotMatch(regional?.rationale ?? "", /timezone .*overlaps/i);

  const falseEuMatch = scoreCandidate(
    { ...candidate, location: "Eugene, Oregon", timezone: "" },
    { ...campaign.jobAnalysis, regions: ["EU"], timezone: "CET" },
    campaign.scoringWeights,
  ).breakdown.find((item) => item.key === "location");
  // "Eugene" must not false-positive as EU; Oregon is Americas → dampen on Europe JD.
  assert.ok((falseEuMatch?.score ?? 100) <= 40);
  assert.doesNotMatch(falseEuMatch?.rationale ?? "", /matches a target region/i);
  assert.match(falseEuMatch?.rationale ?? "", /outside European working hours/i);
});

test("manual intake requires an operator-selected lawful basis and generic drafts stay grammatical", async () => {
  const harness = createHarness();
  const campaign = harness.state.campaigns[0];
  const missingBasis = await harness.actions.addCandidateManual(campaign.id, {
    name: "Manual Person",
  } as never);
  assert.equal(missingBasis.ok, false);
  assert.equal(harness.commitCalls, 0);

  const added = await harness.actions.addCandidateManual(campaign.id, {
    name: "Manual Person",
    lawfulBasis: "consent",
    skills: [campaign.jobAnalysis.requiredSkills[0]],
  });
  assert.equal(added.ok, true);
  const candidate = harness.state.candidates[0];
  for (const language of ["en", "fr", "es", "de", "pt", "it", "nl"]) {
    const draft = generateOutreach(
      candidate,
      campaign,
      "Casual Professional",
      "Email",
      1,
      undefined,
      language,
    );
    assert.doesNotMatch(draft.body, /specifically:\s*\./i, language);
    assert.doesNotMatch(
      draft.body,
      /\b(?:at stood out|chez a retenu|en me llamó|bei ist mir|na chamou|in ha colpito|bij viel op)\b/i,
      language,
    );
  }
});

test("manual duplicate and persisted commit rejection never emit candidate success", async () => {
  const duplicateState = buildSeedState();
  duplicateState.candidates = [
    {
      ...duplicateState.candidates[0],
      id: "candidate_existing_manual",
      campaignId: duplicateState.campaigns[0].id,
      sourceUrl: "https://example.test/profiles/manual-person",
      email: "",
    },
    ...duplicateState.candidates,
  ];
  const duplicate = createHarness({ state: duplicateState });
  const duplicateResult = await duplicate.actions.addCandidateManual(
    duplicate.state.campaigns[0].id,
    {
      name: "Manual Person",
      profileUrl: "https://example.test/profiles/manual-person",
      lawfulBasis: "legitimate_interest",
    },
  );
  assert.deepEqual(duplicateResult, {
    ok: true,
    added: 0,
    skipped: 1,
    skipReason: "Duplicate source profile",
  });
  assert.equal(duplicate.persistedCalls, 1);
  assert.equal(duplicate.recomputeCalls, 0);
  assert.equal(duplicate.activityDrafts.length, 1);
  assert.equal(duplicate.events.length, 0);

  const rejected = createHarness({ persistAllowed: false });
  const rejectedResult = await rejected.actions.addCandidateManual(
    rejected.state.campaigns[0].id,
    { name: "Manual Person", lawfulBasis: "consent" },
  );
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejected.commitCalls, 0);
  assert.equal(rejected.persistedCalls, 1);
  assert.equal(rejected.events.length, 0);
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
  for (const platform of ["Sillage", "Apollo", "Seamless", "Manual"] as const) {
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

test("sourcing rejects an incomplete need or missing reviewed query before network egress", async () => {
  const incompleteState = buildSeedState();
  const campaignId = incompleteState.campaigns[0].id;
  incompleteState.campaigns[0].jobAnalysis = {
    ...incompleteState.campaigns[0].jobAnalysis,
    seniority: "Unspecified",
    employmentType: "Unspecified",
    locationType: "Unspecified",
    requiredSkills: [],
  };
  const incomplete = createHarness({ state: incompleteState });
  const incompleteResult = await incomplete.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });
  assert.equal(incompleteResult.ok, false);
  assert.equal(incomplete.fetchCalls, 0);
  assert.equal(incomplete.commitCalls, 0);

  const noQueryState = buildSeedState();
  noQueryState.campaigns[0].sourcingStrategy.githubQueries = [];
  const noQuery = createHarness({ state: noQueryState });
  const noQueryResult = await noQuery.actions.sourceNextBatch(
    noQuery.state.campaigns[0].id,
    { platform: "GitHub" },
  );
  assert.equal(noQueryResult.ok, false);
  assert.equal(noQuery.fetchCalls, 0);
  assert.equal(noQuery.commitCalls, 0);
});

test("sourcing rejects a need or query mutation after live I/O before commit", async () => {
  let harness: ReturnType<typeof createHarness>;
  harness = createHarness({
    afterFetch: () => {
      const campaignId = harness.state.campaigns[0].id;
      harness.state = {
        ...harness.state,
        campaigns: harness.state.campaigns.map((campaign) =>
          campaign.id === campaignId
            ? {
                ...campaign,
                jobAnalysis: {
                  ...campaign.jobAnalysis,
                  requiredSkills: [],
                },
              }
            : campaign,
        ),
      };
    },
  });

  const result = await harness.actions.sourceNextBatch(harness.state.campaigns[0].id, {
    platform: "GitHub",
  });
  assert.equal(result.ok, false);
  assert.equal(harness.fetchCalls, 1);
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.events.length, 0);
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
  assert.equal(harness.persistedCalls, 1);
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
  assert.equal(harness.persistedCalls, 1);
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
  const demo = createHarness({ syntheticSourcingAllowed: true });
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

test("demo candidate authority is synthetic-only and blocks real or manual intake before I/O", async () => {
  const demo = createHarness({
    syntheticSourcingAllowed: true,
    candidatePersistenceAllowed: (provenance) => provenance === "synthetic",
  });
  const campaignId = demo.state.campaigns[0].id;

  for (const platform of ["GitHub", "Dribbble"] as const) {
    const result = await demo.actions.sourceNextBatch(campaignId, {
      platform,
      count: 1,
    });
    assert.equal(result.ok, false, platform);
    if (!result.ok) assert.match(result.error, /live workspace/i, platform);
  }
  const github = await demo.actions.addCandidateFromGithub(campaignId, "live-user");
  const manual = await demo.actions.addCandidateManual(campaignId, {
    name: "Real Manual Person",
    lawfulBasis: "consent",
  });

  assert.equal(github.ok, false);
  if (!github.ok) assert.match(github.error, /live workspace/i);
  assert.equal(manual.ok, false);
  if (!manual.ok) assert.match(manual.error, /live workspace/i);
  assert.equal(demo.fetchCalls, 0);
  assert.equal(demo.persistedCalls, 0);

  const synthetic = await demo.actions.sourceNextBatch(campaignId, { count: 2 });
  assert.equal(synthetic.ok, true);
  if (!synthetic.ok) return;
  assert.equal(synthetic.source, "mock");
  assert.equal(synthetic.accepted.length, 2);
  assert.equal(
    synthetic.accepted.every((candidate) => candidate.provenance === "synthetic"),
    true,
  );
  assert.equal(demo.fetchCalls, 0);
  assert.equal(demo.persistedCalls, 1);
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

test("a rejected persisted commit never reports or emits sourcing success", async () => {
  const harness = createHarness({ persistAllowed: false });
  const campaignId = harness.state.campaigns[0].id;
  const result = await harness.actions.sourceNextBatch(campaignId, {
    platform: "GitHub",
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Workspace changed before the sourced candidates could be saved. Retry sourcing.",
    source: "unavailable",
  });
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.persistedCalls, 1);
  assert.equal(harness.events.length, 0);
  assert.equal(
    harness.state.candidates.some((candidate) => candidate.githubUrl === githubUser.htmlUrl),
    false,
  );
});

test("people-first Source next batch hits sourcing-agent when Apify looks unkeyed, not a silent fixture", async () => {
  const seed = buildSeedState();
  const campaign = {
    ...seed.campaigns[0],
    status: "Sourcing" as const,
    jobAnalysis: {
      ...seed.campaigns[0].jobAnalysis,
      title: "Calypso Application Support",
      department: "IS&D - Applicative Support",
      requiredSkills: ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server", "Calypso"],
      industryExperience: ["Fintech"],
    },
  };
  const integrations = defaultLiveIntegrations().map((item) =>
    item.id === "int_github" ? { ...item, mode: "live" as const, status: "not_configured" as const } : item,
  );
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], integrations, apiKeys: [] },
    syntheticSourcingAllowed: false,
    responseStatus: 503,
    responseBody: {
      ok: false,
      code: "MISSING_PLUGIN",
      error:
        "MISSING_PLUGIN: Add a valid Apify key in Access & Keys, or connect official LinkedIn. GitHub Sourcing cannot fill this people-first role.",
      requestId: "req-unkeyed",
    },
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 6 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /MISSING_PLUGIN|Add a valid Apify key|Mock mode/);
  }
  assert.equal(harness.fetchCalls, 1);
  assert.match(String(harness.requests[0]?.input), /\/api\/sourcing-agent/);
  assert.doesNotMatch(String(harness.requests[0]?.input), /source\/need/);
  assert.equal(harness.persistedCalls, 0);
  assert.equal(harness.activityDrafts.length, 0);
});

test("Mock Apify card with a valid Access & Keys row still POSTs and fails loud", async () => {
  const seed = buildSeedState();
  const campaign = {
    ...seed.campaigns[0],
    status: "Sourcing" as const,
    jobAnalysis: {
      ...seed.campaigns[0].jobAnalysis,
      title: "Calypso Application Support",
      department: "IS&D - Applicative Support",
      requiredSkills: ["Linux", "Python", "Shell", "Oracle", "Grafana", "Dynatrace", "Linux Server", "Calypso"],
      industryExperience: ["Fintech"],
    },
  };
  const integrations = defaultLiveIntegrations();
  const apiKeys = [
    {
      id: "key_apify",
      name: "Apify",
      provider: "Apify" as const,
      last4: "lRfy",
      status: "valid" as const,
      lastTestedAt: "2026-07-15T00:00:00.000Z",
      createdBy: "tony",
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], integrations, apiKeys },
    syntheticSourcingAllowed: false,
    responseStatus: 503,
    responseBody: {
      ok: false,
      code: "PEOPLE_FIRST_HARVEST_MOCK",
      error:
        "Apify is in Mock mode. actor=harvestapi~linkedin-profile-search query=Calypso Linux Python. Connect a real Apify key and switch the card to Live.",
      requestId: "req-mock-apify",
    },
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 6 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Mock mode/);
    assert.match(result.error, /Calypso Linux Python/);
    assert.doesNotMatch(result.error, /MISSING_PLUGIN/);
  }
  assert.equal(harness.fetchCalls, 1);
  assert.match(String(harness.requests[0]?.input), /\/api\/sourcing-agent/);
  const toast = peoplePluginFailLoudUi(
    result.ok ? "" : result.error,
    campaign.jobAnalysis,
    integrations,
    apiKeys,
  );
  assert.equal(toast?.title, "Connect Apify");
  assert.match(String(toast?.description), /Mock mode/);
  assert.equal(toast?.href, "/settings");
  assert.equal(harness.persistedCalls, 0);
});

test("valid Apify key does not throw MISSING_PLUGIN on people-first Source next batch", async () => {
  const seed = buildSeedState();
  const campaign = {
    ...seed.campaigns[0],
    status: "Sourcing" as const,
    jobAnalysis: {
      ...seed.campaigns[0].jobAnalysis,
      title: "Calypso Application Support",
      department: "IS&D - Applicative Support",
      requiredSkills: ["Linux", "Python", "Calypso"],
      industryExperience: ["Fintech"],
    },
  };
  const integrations = defaultLiveIntegrations().map((item) =>
    item.id === "int_apify" ? { ...item, mode: "live" as const, status: "connected" as const } : item,
  );
  const apiKeys = [
    {
      id: "key_apify",
      name: "Apify",
      provider: "Apify" as const,
      last4: "lRfy",
      status: "valid" as const,
      lastTestedAt: "2026-07-15T00:00:00.000Z",
      createdBy: "tony",
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], integrations, apiKeys },
    syntheticSourcingAllowed: false,
    responseBody: {
      ok: true,
      campaignId: campaign.id,
      campaignFingerprint: sourcingAgentCampaignFingerprint(campaign),
      mode: "deterministic",
      totalFound: 1,
      requestId: "request-keyed-apify",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      sourcingRunId: "22222222-2222-4222-8222-222222222222",
      appliedLessonIds: [],
      candidates: [
        {
          id: "keyed-candidate-1",
          campaignId: campaign.id,
          name: "Elena Varga",
          currentTitle: "Calypso Application Support",
          currentCompany: "BNPP CIB",
          location: "Montreal",
          linkedinUrl: "https://www.linkedin.com/in/elena-varga",
          githubUrl: "",
          sourceUrl: "https://www.linkedin.com/in/elena-varga",
          sourcePlatform: "Apify",
          sourceQuery: "Calypso Linux Python",
          matchScore: 88,
          matchBreakdown: [],
          techStack: ["Linux", "Python", "Calypso"],
          recentActivity: "Production support",
          createdAt: "2026-07-15T00:00:00.000Z",
        },
      ],
      feedbackReceipts: [
        { receiptId: "33333333-3333-4333-8333-333333333333", platform: "Apify", candidateCount: 1 },
      ],
    },
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 6 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.notEqual(result.source, "mock");
    assert.doesNotMatch(JSON.stringify(result), /MISSING_PLUGIN/);
  }
  assert.match(String(harness.requests[0]?.input), /sourcing-agent|source\/need|source"/);
  assert.ok(harness.fetchCalls >= 1);
});

test("keyed people-first Source next batch does not toast invalid-response on a non-JSON sourcing-agent crash", async () => {
  const seed = buildSeedState();
  const campaign = {
    ...seed.campaigns[0],
    status: "Sourcing" as const,
    jobAnalysis: {
      ...seed.campaigns[0].jobAnalysis,
      title: "Calypso Application Support",
      department: "IS&D - Applicative Support",
      requiredSkills: ["Linux", "Python", "Calypso"],
      industryExperience: ["Fintech"],
    },
  };
  const integrations = defaultLiveIntegrations().map((item) =>
    item.id === "int_apify" ? { ...item, mode: "live" as const, status: "connected" as const } : item,
  );
  const apiKeys = [
    {
      id: "key_apify",
      name: "Apify",
      provider: "Apify" as const,
      last4: "lRfy",
      status: "valid" as const,
      lastTestedAt: "2026-07-15T00:00:00.000Z",
      createdBy: "tony",
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], integrations, apiKeys },
    syntheticSourcingAllowed: false,
    responseText: "Internal Server Error",
    responseStatus: 500,
    responseContentType: "text/plain",
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 6 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, PEOPLE_FIRST_HARVEST_UNAVAILABLE);
    assert.doesNotMatch(result.error, /invalid response/i);
    assert.doesNotMatch(result.error, /invalid result/i);
    assert.doesNotMatch(result.error, /MISSING_PLUGIN/);
  }
  const toast = peoplePluginFailLoudUi(
    result.ok ? "" : result.error,
    campaign.jobAnalysis,
    integrations,
    apiKeys,
  );
  assert.equal(toast?.title, "Sourcing failed");
  assert.equal(toast?.href, "/settings");
  assert.match(String(toast?.actionLabel), /Access & Keys/);
  assert.doesNotMatch(String(toast?.description), /invalid response/i);
  assert.doesNotMatch(String(toast?.description), /MISSING_PLUGIN/);
  assert.equal(harness.persistedCalls, 0);
});

test("people-first GitHub-only empty batch is fail-loud, not a successful search", async () => {
  const seed = buildSeedState();
  const campaign = {
    ...seed.campaigns[0],
    status: "Sourcing" as const,
    jobAnalysis: {
      ...seed.campaigns[0].jobAnalysis,
      title: "Calypso Application Support",
      department: "IS&D - Applicative Support",
      requiredSkills: ["Linux", "Python", "Calypso"],
      industryExperience: ["Fintech"],
    },
  };
  const integrations = defaultLiveIntegrations().map((item) =>
    item.id === "int_apify" ? { ...item, mode: "live" as const, status: "connected" as const } : item,
  );
  const apiKeys = [
    {
      id: "key_apify",
      name: "Apify",
      provider: "Apify" as const,
      last4: "lRfy",
      status: "valid" as const,
      lastTestedAt: "2026-07-15T00:00:00.000Z",
      createdBy: "tony",
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];
  const harness = createHarness({
    state: { ...seed, campaigns: [campaign], integrations, apiKeys },
    syntheticSourcingAllowed: false,
    responseBody: {
      ok: true,
      campaignId: campaign.id,
      campaignFingerprint: sourcingAgentCampaignFingerprint(campaign),
      mode: "deterministic",
      totalFound: 0,
      requestId: "request-empty-github",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      sourcingRunId: "22222222-2222-4222-8222-222222222222",
      appliedLessonIds: [],
      candidates: [],
      feedbackReceipts: [
        { receiptId: "33333333-3333-4333-8333-333333333333", platform: "GitHub", candidateCount: 0 },
        { receiptId: "44444444-4444-4444-8444-444444444444", platform: "GitHub", candidateCount: 0 },
        { receiptId: "55555555-5555-4555-8555-555555555555", platform: "GitHub", candidateCount: 0 },
      ],
    },
  });

  const result = await harness.actions.sourceNextBatch(campaign.id, { count: 6 });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, EMPTY_PEOPLE_FIRST_HARVEST);
    assert.doesNotMatch(result.error, /MISSING_PLUGIN/);
    assert.doesNotMatch(result.error, /invalid response/i);
  }
  assert.equal(harness.persistedCalls, 0);
});

test("Apollo search commits only exact validated profiles through the sourcing boundary", async () => {
  const harness = createHarness({
    responseBody: { ok: true, source: "apollo", profiles: [apolloProfile] },
  });
  const campaignId = harness.state.campaigns[0].id;

  const result = await harness.actions.sourceFromApollo(campaignId, {
    titles: [" Staff Platform Engineer "],
    seniorities: ["staff"],
    locations: ["Toronto"],
    organizationDomains: ["example.com"],
    keywords: " platform ",
    count: 1,
  });

  assert.equal(result.source, "apollo");
  assert.equal(result.accepted.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(harness.fetchCalls, 1);
  assert.equal(harness.persistedCalls, 1);
  assert.equal(harness.recomputeCalls, 1);
  assert.deepEqual(harness.events, [{ kind: "source", campaignId, count: 1 }]);
  assert.equal(harness.activityDrafts.length, 1);
  assert.equal(harness.state.candidates[0]?.sourceAuthorityId, apolloProfile.targetId);
  assert.equal(harness.state.candidates[0]?.id, apolloProfile.candidateId);
  assert.equal(harness.state.candidates[0]?.sourceExternalId, undefined);
  assert.deepEqual(JSON.parse(String(harness.requests[0].init?.body)), {
    campaignId,
    titles: ["Staff Platform Engineer"],
    seniorities: ["staff"],
    locations: ["Toronto"],
    organizationDomains: ["example.com"],
    keywords: "platform",
    count: 1,
  });
});

test("Apollo search fails closed before I/O for unavailable, unauthorized, missing, paused, or invalid requests", async () => {
  const unavailable = createHarness({ workspaceAllowed: false });
  const unavailableCampaignId = unavailable.state.campaigns[0].id;
  assert.equal(
    (await unavailable.actions.sourceFromApollo(unavailableCampaignId, {})).source,
    "error",
  );

  const viewer = createHarness({ mutationAllowed: false });
  const viewerCampaignId = viewer.state.campaigns[0].id;
  assert.equal((await viewer.actions.sourceFromApollo(viewerCampaignId, {})).source, "error");

  const missing = createHarness();
  assert.equal((await missing.actions.sourceFromApollo("missing", {})).source, "error");

  const paused = createHarness();
  const pausedCampaignId = paused.state.campaigns[0].id;
  paused.state = {
    ...paused.state,
    campaigns: paused.state.campaigns.map((campaign) =>
      campaign.id === pausedCampaignId ? { ...campaign, status: "Paused" } : campaign,
    ),
  };
  assert.equal((await paused.actions.sourceFromApollo(pausedCampaignId, {})).source, "error");

  const invalid = createHarness();
  const invalidCampaignId = invalid.state.campaigns[0].id;
  for (const filters of [
    { count: 0 },
    { count: 51 },
    { count: 1.5 },
    { titles: Array.from({ length: 21 }, () => "Engineer") },
    { titles: ["\u0000Engineer"] },
    { keywords: "x".repeat(301) },
  ]) {
    const result = await invalid.actions.sourceFromApollo(invalidCampaignId, filters);
    assert.equal(result.source, "error");
  }

  for (const harness of [unavailable, viewer, missing, paused, invalid]) {
    assert.equal(harness.fetchCalls, 0);
    assert.equal(harness.commitCalls, 0);
    assert.equal(harness.events.length, 0);
  }
});

test("Apollo search rejects malformed or overbroad provider profiles before state work", async () => {
  const invalidProfiles = [
    { ...apolloProfile, targetId: "raw-provider-id" },
    { ...apolloProfile, id: "raw-provider-id" },
    { ...apolloProfile, linkedinUrl: "http://www.linkedin.com/in/apollo-candidate" },
    { ...apolloProfile, linkedinUrl: "https://linkedin.com.evil.test/in/apollo-candidate" },
    { ...apolloProfile, name: "Apollo\u0000Candidate" },
    { ...apolloProfile, headline: "x".repeat(501) },
    { ...apolloProfile, departments: Array.from({ length: 21 }, () => "Engineering") },
  ];

  for (const profile of invalidProfiles) {
    const harness = createHarness({
      responseBody: { ok: true, source: "apollo", profiles: [profile] },
    });
    const result = await harness.actions.sourceFromApollo(harness.state.campaigns[0].id, {
      count: 1,
    });
    assert.equal(result.source, "error");
    assert.equal(result.accepted.length, 0);
    assert.equal(harness.commitCalls, 0);
    assert.equal(harness.events.length, 0);
  }

  const tooMany = createHarness({
    responseBody: {
      ok: true,
      source: "apollo",
      profiles: [apolloProfile, { ...apolloProfile, targetId: "22222222-2222-4222-8222-222222222222" }],
    },
  });
  const tooManyResult = await tooMany.actions.sourceFromApollo(
    tooMany.state.campaigns[0].id,
    { count: 1 },
  );
  assert.equal(tooManyResult.source, "error");
  assert.equal(tooMany.commitCalls, 0);
});

test("Apollo search revalidates workspace, role, and campaign after provider I/O", async () => {
  for (const mutation of ["workspace", "role", "missing", "paused"] as const) {
    let harness: ReturnType<typeof createHarness>;
    harness = createHarness({
      responseBody: { ok: true, source: "apollo", profiles: [apolloProfile] },
      afterFetch: () => {
        const campaignId = harness.state.campaigns[0].id;
        if (mutation === "workspace") harness.setWorkspaceAllowed(false);
        if (mutation === "role") harness.setMutationAllowed(false);
        if (mutation === "missing") {
          harness.state = { ...harness.state, campaigns: [] };
        }
        if (mutation === "paused") {
          harness.state = {
            ...harness.state,
            campaigns: harness.state.campaigns.map((campaign) =>
              campaign.id === campaignId ? { ...campaign, status: "Paused" } : campaign,
            ),
          };
        }
      },
    });
    const result = await harness.actions.sourceFromApollo(harness.state.campaigns[0].id, {
      count: 1,
    });
    assert.equal(result.source, "error");
    assert.equal(harness.commitCalls, 0);
    assert.equal(harness.events.length, 0);
  }
});

test("Apollo search dedupes against commit-time state and emits only after an applied write", async () => {
  const state = buildSeedState();
  const campaignId = state.campaigns[0].id;
  const concurrentCandidate: Candidate = {
    ...state.candidates[0],
    id: "candidate_concurrent_apollo",
    campaignId,
    email: "",
    linkedinUrl: apolloProfile.linkedinUrl,
    githubUrl: "",
    sourcePlatform: "Apollo",
    sourceAuthorityId: apolloProfile.targetId,
  };
  const deduped = createHarness({
    state,
    responseBody: { ok: true, source: "apollo", profiles: [apolloProfile] },
    beforePersist: (current) => ({
      ...current,
      candidates: [concurrentCandidate, ...current.candidates],
    }),
  });

  const duplicateResult = await deduped.actions.sourceFromApollo(campaignId, { count: 1 });
  assert.equal(duplicateResult.source, "apollo");
  assert.equal(duplicateResult.accepted.length, 0);
  assert.equal(duplicateResult.skipped.length, 1);
  assert.equal(deduped.activityDrafts.length, 0);
  assert.equal(deduped.events.length, 0);
  assert.equal(
    deduped.state.candidates.filter(
      (candidate) => candidate.sourceAuthorityId === apolloProfile.targetId,
    ).length,
    1,
  );

  const rejected = createHarness({
    state: buildSeedState(),
    responseBody: { ok: true, source: "apollo", profiles: [apolloProfile] },
    persistAllowed: false,
  });
  const rejectedResult = await rejected.actions.sourceFromApollo(
    rejected.state.campaigns[0].id,
    { count: 1 },
  );
  assert.equal(rejectedResult.source, "error");
  assert.equal(rejectedResult.accepted.length, 0);
  assert.equal(rejected.events.length, 0);
});

test("Apollo search saves before paid selection and preparation requires an exact selection receipt", async () => {
  const state = buildSeedState();
  const campaignId = state.campaigns[0].id;
  const sourced = createHarness({
    state: structuredClone(state),
    responseBody: { ok: true, source: "apollo", profiles: [apolloProfile] },
  });
  const sourcedResult = await sourced.actions.sourceFromApollo(campaignId, { count: 1 });
  assert.equal(sourcedResult.source, "apollo");
  assert.equal(sourcedResult.accepted.length, 1);
  assert.equal(sourced.fetchCalls, 1);
  assert.equal(sourced.persistedCalls, 1);

  const candidate = sourced.state.candidates.find((item) => item.id === apolloProfile.candidateId);
  assert.ok(candidate);
  const rejected = createHarness({
    state: structuredClone(sourced.state),
    responseBodies: [
      { ok: false, code: "APOLLO_AUTHORITY_UNAVAILABLE", error: "Selection failed." },
    ],
  });
  const rejectedResult = await rejected.actions.prepareApolloEnrichment(candidate.id);
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejected.fetchCalls, 1);

  const mismatched = createHarness({
    state: structuredClone(sourced.state),
    responseBodies: [{
        ok: true,
        selected: [{
          targetId: apolloProfile.targetId,
          candidateId: "88888888-8888-4888-8888-888888888888",
        }],
      }],
  });
  const mismatchedResult = await mismatched.actions.prepareApolloEnrichment(candidate.id);
  assert.equal(mismatchedResult.ok, false);
  assert.equal(mismatched.fetchCalls, 1);
});

test("Apollo search preserves not-configured truth without state work", async () => {
  const harness = createHarness({
    responseBody: {
      ok: true,
      source: "not_configured",
      profiles: [],
      code: "APOLLO_NOT_CONFIGURED",
      error: "Apollo is not configured.",
    },
  });

  const result = await harness.actions.sourceFromApollo(harness.state.campaigns[0].id, {});

  assert.deepEqual(result, {
    accepted: [],
    skipped: [],
    source: "not_configured",
    error: "Apollo is not configured.",
  });
  assert.equal(harness.commitCalls, 0);
  assert.equal(harness.events.length, 0);
});

test("Apollo paid enrichment prepares before confirmation and commits one bound target", async () => {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  const candidate: Candidate = {
    ...state.candidates[0],
    id: apolloProfile.candidateId,
    campaignId: campaign.id,
    email: "",
    phone: "",
    sourcePlatform: "Apollo",
    sourceExternalId: undefined,
    sourceAuthorityId: "22222222-2222-4222-8222-222222222222",
  };
  state.candidates = [candidate, ...state.candidates];
  const harness = createHarness({
    state,
    responseBodies: [
      {
        ok: true,
        selected: [{
          targetId: candidate.sourceAuthorityId,
          candidateId: candidate.id,
        }],
      },
      {
        ok: true,
        status: "prepared",
        campaignId: candidate.campaignId,
        candidateId: candidate.id,
        targetId: candidate.sourceAuthorityId,
        scope: "email",
        confirmationNonce: "33333333-3333-4333-8333-333333333333",
        expiresAt: "2026-07-13T07:00:00.000Z",
        maxCostCredits: 1,
      },
      {
        ok: true,
        status: "completed",
        campaignId: candidate.campaignId,
        candidateId: candidate.id,
        targetId: candidate.sourceAuthorityId,
        revealed: true,
        cached: false,
        email: "revealed@example.test",
        phone: "",
        detail: "email_revealed",
      },
    ],
  });

  const prepared = await harness.actions.prepareApolloEnrichment(candidate.id);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(harness.commitCalls, 0);
  assert.deepEqual(JSON.parse(String(harness.requests[0].init?.body)), {
    campaignId: candidate.campaignId,
    candidates: [{
      targetId: candidate.sourceAuthorityId,
      candidateId: candidate.id,
    }],
  });
  assert.deepEqual(JSON.parse(String(harness.requests[1].init?.body)), {
    action: "prepare",
    campaignId: candidate.campaignId,
    candidateId: candidate.id,
    targetId: candidate.sourceAuthorityId,
    scope: "email",
  });

  const completed = await harness.actions.enrichApolloCandidate(
    candidate.id,
    prepared.confirmationNonce,
  );
  assert.deepEqual(completed, {
    ok: true,
    revealed: true,
    detail: "Contact email revealed.",
  });
  const commitBody = JSON.parse(String(harness.requests[2].init?.body)) as Record<string, unknown>;
  assert.equal(commitBody.action, "commit");
  assert.equal(commitBody.campaignId, candidate.campaignId);
  assert.equal(commitBody.candidateId, candidate.id);
  assert.equal(commitBody.targetId, candidate.sourceAuthorityId);
  assert.equal(commitBody.scope, "email");
  assert.equal(commitBody.confirmationNonce, prepared.confirmationNonce);
  assert.match(String(commitBody.idempotencyKey), /^[0-9a-f-]{36}$/i);
  assert.equal(harness.state.candidates.find((item) => item.id === candidate.id)?.email, "revealed@example.test");
  assert.equal(harness.persistedCalls, 1);
});

test("Apollo no-contact completion does not invent an unverified credit outcome", async () => {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  const candidate: Candidate = {
    ...state.candidates[0],
    id: apolloProfile.candidateId,
    campaignId: campaign.id,
    email: "",
    phone: "",
    sourcePlatform: "Apollo",
    sourceExternalId: undefined,
    sourceAuthorityId: "22222222-2222-4222-8222-222222222222",
  };
  state.candidates = [candidate, ...state.candidates];
  const harness = createHarness({
    state,
    responseBody: {
      ok: true,
      status: "completed",
      campaignId: candidate.campaignId,
      candidateId: candidate.id,
      targetId: candidate.sourceAuthorityId,
      revealed: false,
      cached: false,
      email: "",
      phone: "",
      detail: "no_contact_found",
    },
  });

  const result = await harness.actions.enrichApolloCandidate(
    candidate.id,
    "33333333-3333-4333-8333-333333333333",
  );

  assert.deepEqual(result, { ok: true, revealed: false, detail: "No contact email found." });
  assert.doesNotMatch(result.detail, /credit|charged/i);
  assert.equal(harness.commitCalls, 0);
});

test("Apollo client preserves bounded server error codes for UI recovery", async () => {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  const candidate: Candidate = {
    ...state.candidates[0],
    id: apolloProfile.candidateId,
    campaignId: campaign.id,
    email: "",
    sourcePlatform: "Apollo",
    sourceAuthorityId: "22222222-2222-4222-8222-222222222222",
  };
  state.candidates = [candidate, ...state.candidates];
  const harness = createHarness({
    state,
    responseStatus: 409,
    responseBody: {
      ok: false,
      code: "APOLLO_RECONCILIATION_REQUIRED",
      error: "Enrichment requires reconciliation.",
      requestId: "request-1",
    },
  });

  const result = await harness.actions.enrichApolloCandidate(
    candidate.id,
    "33333333-3333-4333-8333-333333333333",
  );

  assert.deepEqual(result, {
    ok: false,
    revealed: false,
    detail: "Enrichment requires reconciliation.",
    code: "APOLLO_RECONCILIATION_REQUIRED",
  });
  assert.equal(harness.commitCalls, 0);
});

test("Apollo enrichment rejects unbound, unauthorized, malformed, and unapplied results", async () => {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  const candidate: Candidate = {
    ...state.candidates[0],
    id: apolloProfile.candidateId,
    campaignId: campaign.id,
    email: "",
    sourcePlatform: "Apollo",
    sourceExternalId: undefined,
    sourceAuthorityId: "22222222-2222-4222-8222-222222222222",
  };
  state.candidates = [candidate, ...state.candidates];

  const viewer = createHarness({ state: structuredClone(state), mutationAllowed: false });
  assert.equal((await viewer.actions.prepareApolloEnrichment(candidate.id)).ok, false);
  assert.equal(
    (await viewer.actions.enrichApolloCandidate(candidate.id, "33333333-3333-4333-8333-333333333333")).ok,
    false,
  );
  assert.equal(viewer.fetchCalls, 0);

  const malformed = createHarness({
    state: structuredClone(state),
    responseBody: {
      ok: true,
      status: "completed",
      campaignId: candidate.campaignId,
      candidateId: candidate.id,
      targetId: candidate.sourceAuthorityId,
      revealed: true,
      cached: false,
      email: "revealed@example.test",
      phone: "+14155550100",
      detail: "email_revealed",
    },
  });
  const malformedResult = await malformed.actions.enrichApolloCandidate(
    candidate.id,
    "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(malformedResult.ok, false);
  assert.equal(malformed.commitCalls, 0);

  const rejected = createHarness({
    state: structuredClone(state),
    persistAllowed: false,
    responseBody: {
      ok: true,
      status: "completed",
      campaignId: candidate.campaignId,
      candidateId: candidate.id,
      targetId: candidate.sourceAuthorityId,
      revealed: true,
      cached: false,
      email: "revealed@example.test",
      phone: "",
      detail: "email_revealed",
    },
  });
  const rejectedResult = await rejected.actions.enrichApolloCandidate(
    candidate.id,
    "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejected.state.candidates.find((item) => item.id === candidate.id)?.email, "");

  const authorityChangedDuringCommit = createHarness({
    state: structuredClone(state),
    beforePersist: (current) => ({
      ...current,
      candidates: current.candidates.map((item) =>
        item.id === candidate.id ? { ...item, sourceAuthorityId: undefined } : item,
      ),
    }),
    responseBody: {
      ok: true,
      status: "completed",
      campaignId: candidate.campaignId,
      candidateId: candidate.id,
      targetId: candidate.sourceAuthorityId,
      revealed: true,
      cached: false,
      email: "revealed@example.test",
      phone: "",
      detail: "email_revealed",
    },
  });
  const staleCommit = await authorityChangedDuringCommit.actions.enrichApolloCandidate(
    candidate.id,
    "33333333-3333-4333-8333-333333333333",
  );
  assert.equal(staleCommit.ok, false);
  assert.equal(
    authorityChangedDuringCommit.state.candidates.find((item) => item.id === candidate.id)?.email,
    "",
  );
});

test("Apollo UI obtains the server nonce before asking for human confirmation", () => {
  const prepareIndex = candidateDrawerSource.indexOf("prepareApolloEnrichment(c.id)");
  const confirmIndex = candidateDrawerSource.indexOf("await confirm(", prepareIndex);
  const commitIndex = candidateDrawerSource.indexOf("enrichApolloCandidate(", confirmIndex);
  assert.ok(prepareIndex >= 0 && confirmIndex > prepareIndex && commitIndex > confirmIndex);
  assert.doesNotMatch(candidateDrawerSource.slice(prepareIndex, commitIndex), /phone/i);
  assert.equal((storeSource.match(/const prepareApolloEnrichment = useCallback/g) ?? []).length, 0);
  assert.equal((storeSource.match(/const enrichApolloCandidate = useCallback/g) ?? []).length, 0);
});
