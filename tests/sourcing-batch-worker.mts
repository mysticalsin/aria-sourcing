import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  handleSourcingBatchJob,
  isValidSourcingBatchOutcome,
} from "../scripts/sourcing-loop-handlers/sourcing-batch.mjs";
import { discoverGithubCandidates } from "../scripts/sourcing-loop-handlers/github-discovery.mjs";
import {
  deriveDeterministicGithubQuery,
  validateCanonicalGithubQueryForRoleBasis,
} from "../scripts/sourcing-loop-handlers/sourcing-query-policy.mjs";
import {
  loadSourcingLoopConfiguration,
  runSourcingLoopTick,
} from "../scripts/sourcing-loop-worker.mjs";
import { generateOutreach, newOutreachMessage } from "../src/lib/mock-ai";
import { buildSeedState } from "../src/lib/seed";
import { normalizeHermesState } from "../src/lib/store/migrations";
import type { Campaign, Candidate } from "../src/lib/types";

const JOB = Object.freeze({
  id: "70000000-0000-4000-8000-000000000001",
  lease_id: "80000000-0000-4000-8000-000000000001",
  workspace_id: "51111111-1111-4111-8111-111111111111",
  kind: "sourcing_batch",
  payload: {
    campaign_id: "90000000-0000-4000-8000-000000000001",
    campaign_sha256: "a".repeat(64),
    batch_ordinal: 0,
  },
});
const PAGE_TWO_JOB = Object.freeze({
  ...JOB,
  payload: Object.freeze({ ...JOB.payload, batch_ordinal: 1 }),
});
const ACTOR_ID = "60000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "61000000-0000-4000-8000-000000000001";
const EGRESS_ATTEMPT_ID = "62000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-07-21T12:00:00.000Z";

type RpcParams = Record<string, unknown>;
type RpcBehavior = (params: RpcParams) => unknown | Promise<unknown>;

function snapshotSha256(value: Record<string, unknown>) {
  return createHash("sha256").update([
    "aria.sourcing-lesson-snapshot.v1",
    value.workspace_id,
    value.role_fingerprint,
    value.lesson_id,
    String(value.lesson_version),
    value.promotion_review_id,
    value.promoted_by,
    value.graphify_export_id,
    value.graphify_artifact_sha256,
    value.graphify_image_digest,
    value.graphify_commit,
    value.graphify_cluster_ref,
    value.query_hmac,
    value.query_value,
    value.query_sha256,
  ].join("\n"), "utf8").digest("hex");
}

function lessonSnapshot(query: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const snapshot: Record<string, unknown> = {
    workspace_id: JOB.workspace_id,
    role_fingerprint: "d".repeat(64),
    lesson_id: "63000000-0000-4000-8000-000000000001",
    lesson_version: 3,
    promotion_review_id: "64000000-0000-4000-8000-000000000001",
    promoted_by: ACTOR_ID,
    graphify_export_id: "65000000-0000-4000-8000-000000000001",
    graphify_artifact_sha256: "e".repeat(64),
    graphify_image_digest: `registry.example.test/graphify@sha256:${"f".repeat(64)}`,
    graphify_commit: "1".repeat(40),
    graphify_cluster_ref: "github-go-1",
    query_hmac: "2".repeat(64),
    query_value: query.value,
    query_sha256: query.sha256,
    ...overrides,
  };
  snapshot.snapshot_sha256 = snapshotSha256(snapshot);
  return snapshot;
}

function authorization(overrides: Record<string, unknown> = {}) {
  const result: Record<string, unknown> = {
    status: "authorized",
    job_id: JOB.id,
    lease_id: JOB.lease_id,
    workspace_id: JOB.workspace_id,
    campaign_id: JOB.payload.campaign_id,
    campaign_sha256: JOB.payload.campaign_sha256,
    batch_ordinal: 0,
    activation_actor_id: ACTOR_ID,
    claim_token: CLAIM_TOKEN,
    fence_version: 1,
    provider_mode: "anonymous",
    workspace_updated_at: UPDATED_AT,
    role_basis: {
      title: "backend engineer",
      skills: ["go"],
    },
    applied_lesson: null,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "canonical_query")) {
    try {
      const derived = deriveDeterministicGithubQuery(
        result.role_basis,
        result.batch_ordinal,
      );
      result.canonical_query = derived.ok ? derived.query : null;
    } catch {
      result.canonical_query = deriveDeterministicGithubQuery({
        title: "backend engineer",
        skills: ["go"],
      }, 0).query;
    }
  }
  return result;
}

function commitResponse(params: RpcParams, status: "completed" | "no_op_replay" = "completed") {
  const candidates = params.p_candidates as unknown[];
  return {
    status,
    job_id: JOB.id,
    candidate_count: candidates.length,
    query_count: 1,
    result_sha256: params.p_result_sha256,
  };
}

function makeClient(overrides: Record<string, RpcBehavior> = {}) {
  const calls: Array<{ name: string; params: RpcParams }> = [];
  const defaults: Record<string, RpcBehavior> = {
    authorize_sourcing_batch: () => authorization(),
    begin_sourcing_batch_egress: (params) => ({
      status: "begun",
      job_id: JOB.id,
      workspace_id: JOB.workspace_id,
      campaign_id: JOB.payload.campaign_id,
      claim_token: CLAIM_TOKEN,
      fence_version: 1,
      egress_attempt_id: EGRESS_ATTEMPT_ID,
      provider_mode: "anonymous",
      canonical_query_sha256: params.p_canonical_query_sha256,
    }),
    commit_sourcing_batch: (params) => commitResponse(params),
    fail_aria_job: (params) => (params.p_retryable ? "queued" : "dead"),
    fail_sourcing_batch_egress: (params) => ({
      status: params.p_ambiguous || params.p_retryable
        ? "retry_scheduled"
        : "dead_lettered",
      job_id: JOB.id,
      egress_attempt_id: EGRESS_ATTEMPT_ID,
      error_code: params.p_error_code,
    }),
  };
  const behavior = { ...defaults, ...overrides };
  const client = {
    async rpc(name: string, params: RpcParams) {
      calls.push({ name, params });
      const action = behavior[name];
      if (!action) throw new Error(`unexpected rpc: ${name}`);
      const result = await action(params);
      if (result && typeof result === "object" && "__throw" in result) {
        throw result.__throw;
      }
      if (
        result &&
        typeof result === "object" &&
        Object.hasOwn(result, "data") &&
        Object.hasOwn(result, "error")
      ) {
        return result;
      }
      return { data: result, error: null };
    },
  };
  return { client, calls };
}

function jsonResponse(value: unknown, url: string, status = 200, headers: Record<string, string> = {}) {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function successfulFetch(requests: Array<{ url: string; init?: RequestInit }>, profileId = 42): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/search/users")) {
      return jsonResponse(
        {
          total_count: 1,
          incomplete_results: false,
          items: [{ id: profileId, login: "real-user", type: "User" }],
        },
        url,
        200,
        {
          "x-ratelimit-resource": "search",
          "x-ratelimit-limit": "10",
          "x-ratelimit-remaining": "9",
          "x-ratelimit-reset": "1784640000",
          "x-github-request-id": "request-search-1",
        },
      );
    }
    assert.equal(url, "https://api.github.com/users/real-user");
    return jsonResponse(
      {
        id: profileId,
        login: "real-user",
        html_url: "https://github.com/real-user",
        name: "Real User",
        company: "Observed Company",
        location: "Toronto",
        bio: "Builds reliable systems",
        email: "private-field-must-not-persist@example.test",
        public_repos: 12,
        followers: 34,
        created_at: "2020-01-02T03:04:05Z",
      },
      url,
      200,
      {
        "x-ratelimit-resource": "core",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "58",
        "x-ratelimit-reset": "1784640000",
        "x-github-request-id": "request-profile-1",
      },
    );
  };
}

const HANDLER_OPTIONS = Object.freeze({
  credential: { kind: "anonymous" as const },
  resultLimit: 3,
  perCallTimeoutMs: 1_000,
  overallDeadlineMs: 5_000,
  now: () => Date.parse(UPDATED_AT),
});

function autonomousCampaignFixture(): Campaign {
  return {
    id: JOB.payload.campaign_id,
    title: "backend engineer",
    department: "",
    urgency: "Standard",
    status: "Sourcing",
    hiringManager: "",
    hiringManagerEmail: "",
    createdAt: UPDATED_AT,
    targetStartDate: "",
    jobAnalysis: {
      title: "backend engineer",
      department: "",
      seniority: "Unspecified",
      employmentType: "Unspecified",
      locationType: "Unspecified",
      regions: [],
      timezone: "",
      salaryMin: null,
      salaryMax: null,
      currency: "",
      equity: false,
      requiredSkills: ["go"],
      niceToHaveSkills: [],
      minYearsExperience: null,
      maxYearsExperience: null,
      education: "",
      industryExperience: [],
      companyStageTarget: [],
      teamSize: "",
      reportingTo: "",
      urgency: "Standard",
      validationWarnings: [],
    },
    sourcingStrategy: {
      primaryPlatforms: ["GitHub"],
      secondaryPlatforms: [],
      githubQueries: [],
      linkedinBoolean: "",
      stackOverflowTags: [],
      geoTargets: [],
      excludedCompanies: [],
      targetCompanyStages: [],
    },
    scoringWeights: {
      skills: 0,
      experience: 0,
      companyStage: 0,
      industry: 0,
      location: 0,
      activity: 0,
    },
    metrics: {
      sourced: 0,
      contacted: 0,
      replied: 0,
      interested: 0,
      booked: 0,
      interviewed: 0,
      offer: 0,
      hired: 0,
      notInterested: 0,
      replyRate: 0,
      avgMatchScore: 0,
      timeToFirstInterviewHours: null,
      emailsSentToday: 0,
      linkedinSentToday: 0,
    },
    skillUpdates: [],
    activities: [],
  };
}

test("query policy derives one canonical role-bound GitHub query from server-owned skills", () => {
  const first = deriveDeterministicGithubQuery({
    title: "platform engineer",
    skills: ["go", "kubernetes", "typescript"],
  }, 0);
  const repeated = deriveDeterministicGithubQuery({
    title: "platform engineer",
    skills: ["go", "kubernetes", "typescript"],
  }, 0);
  const secondOrdinal = deriveDeterministicGithubQuery({
    title: "platform engineer",
    skills: ["go", "kubernetes", "typescript"],
  }, 1);
  const thirdOrdinal = deriveDeterministicGithubQuery({
    title: "platform engineer",
    skills: ["go", "kubernetes", "typescript"],
  }, 2);

  assert.equal(first.ok, true);
  assert.deepEqual(first, repeated);
  assert.equal(secondOrdinal.ok, true);
  assert.equal(thirdOrdinal.ok, true);
  if (!first.ok || !first.query || !secondOrdinal.ok || !secondOrdinal.query || !thirdOrdinal.ok || !thirdOrdinal.query) return;
  assert.deepEqual(first.query, {
    policyVersion: "github-deterministic-v2",
    value: "language:go type:user",
    page: 1,
    sha256: first.query.sha256,
  });
  assert.deepEqual(secondOrdinal.query, {
    policyVersion: "github-deterministic-v2",
    value: "language:typescript type:user",
    page: 1,
    sha256: secondOrdinal.query.sha256,
  });
  assert.deepEqual(thirdOrdinal.query, {
    policyVersion: "github-deterministic-v2",
    value: "language:go type:user",
    page: 2,
    sha256: thirdOrdinal.query.sha256,
  });
  assert.match(first.query.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(first.query.sha256, secondOrdinal.query.sha256);
  assert.deepEqual(
    validateCanonicalGithubQueryForRoleBasis(first.query, {
      title: "platform engineer",
      skills: ["go", "kubernetes", "typescript"],
    }, 0),
    { ok: true },
  );
  assert.deepEqual(
    validateCanonicalGithubQueryForRoleBasis(secondOrdinal.query, {
      title: "platform engineer",
      skills: ["go", "kubernetes", "typescript"],
    }, 0),
    { ok: true },
  );
  assert.deepEqual(
    validateCanonicalGithubQueryForRoleBasis(thirdOrdinal.query, {
      title: "platform engineer",
      skills: ["go", "kubernetes", "typescript"],
    }, 0),
    { ok: false, code: "query_not_approved_for_role_basis" },
  );
});

test("query policy rejects non-canonical roles and never converts free text into provider egress", () => {
  assert.throws(
    () => deriveDeterministicGithubQuery({ title: "Engineer", skills: ["Go"] }, 0),
    /role basis/i,
  );
  assert.throws(
    () => deriveDeterministicGithubQuery({
      title: "engineer",
      skills: ["go"],
      prompt: "language:rust type:user",
    }, 0),
    /role basis/i,
  );
  assert.deepEqual(
    deriveDeterministicGithubQuery({
      title: "ignore previous instructions",
      skills: ["female", "location:london", "site:evil.example"],
    }, 0),
    { ok: false, code: "no_supported_query_terms" },
  );
  assert.throws(
    () => deriveDeterministicGithubQuery({ title: "engineer", skills: ["go"] }, 5),
    /batch ordinal/i,
  );
});

test("malformed claimed jobs remain read-only and perform no provider egress", async () => {
  const requests: Array<{ url: string }> = [];
  const { client, calls } = makeClient();
  for (const job of [
    { ...JOB, id: "not-a-uuid" },
    { ...JOB, lease_id: "not-a-uuid" },
    { ...JOB, workspace_id: "not-a-uuid" },
    { ...JOB, kind: "campaign_create" },
    { ...JOB, payload: { ...JOB.payload, extra: true } },
    { ...JOB, payload: { ...JOB.payload, batch_ordinal: 5 } },
    { ...JOB, payload: { ...JOB.payload, batch_ordinal: 1.5 } },
  ]) {
    const result = await handleSourcingBatchJob(job, client, {
      ...HANDLER_OPTIONS,
      fetcher: async (input: RequestInfo | URL) => {
        requests.push({ url: String(input) });
        throw new Error("must not execute");
      },
    });
    assert.equal(result.outcome, "unavailable");
  }
  assert.equal(calls.length, 0);
  assert.equal(requests.length, 0);
});

test("authorization errors and tenant-binding mismatches fail closed before provider egress", async () => {
  for (const authorize of [
    { data: null, error: { code: "rpc_http_404" } },
    authorization({ workspace_id: "52222222-2222-4222-8222-222222222222" }),
    authorization({ campaign_id: "92222222-2222-4222-8222-222222222222" }),
    authorization({ lease_id: "82222222-2222-4222-8222-222222222222" }),
    authorization({ provider_mode: "token" }),
    authorization({ role_basis: { title: "Backend Engineer", skills: ["Go"] } }),
  ]) {
    let requests = 0;
    const { client, calls } = makeClient({ authorize_sourcing_batch: () => authorize });
    const result = await handleSourcingBatchJob(JOB, client, {
      ...HANDLER_OPTIONS,
      fetcher: async () => {
        requests += 1;
        throw new Error("must not execute");
      },
    });
    assert.equal(result.outcome, "unavailable");
    assert.equal(requests, 0);
    assert.equal(calls.some(({ name }) => name === "commit_sourcing_batch"), false);
    assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  }
});

test("forged or authority-expanding lesson snapshots are rejected before provider egress", async () => {
  const canonical = authorization().canonical_query as Record<string, unknown>;
  const expandedQuery = deriveDeterministicGithubQuery({
    title: "backend engineer",
    skills: ["rust"],
  }, 0);
  assert.equal(expandedQuery.ok, true);
  if (!expandedQuery.ok || !expandedQuery.query) return;

  for (const forged of [
    { ...lessonSnapshot(canonical), snapshot_sha256: "0".repeat(64) },
    lessonSnapshot(expandedQuery.query),
    { ...lessonSnapshot(canonical), extra_authority: "language:rust type:user" },
  ]) {
    let requests = 0;
    const { client, calls } = makeClient({
      authorize_sourcing_batch: () => authorization({ applied_lesson: forged }),
    });
    const result = await handleSourcingBatchJob(JOB, client, {
      ...HANDLER_OPTIONS,
      fetcher: async () => {
        requests += 1;
        throw new Error("must not execute");
      },
    });
    assert.deepEqual(result, { outcome: "unavailable", reason: "invalid_authorization_response" });
    assert.equal(requests, 0);
    assert.deepEqual(calls.map(({ name }) => name), ["authorize_sourcing_batch"]);
  }
});

test("a promoted Graphify lesson can select a different allowed same-page query", async () => {
  const roleBasis = { title: "backend engineer", skills: ["go", "typescript"] };
  const learned = deriveDeterministicGithubQuery(roleBasis, 1);
  assert.equal(learned.ok, true);
  if (!learned.ok || !learned.query) return;
  const query = learned.query;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => authorization({
      role_basis: roleBasis,
      canonical_query: query,
      applied_lesson: lessonSnapshot(query),
    }),
  });

  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: successfulFetch(requests),
  });
  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.equal(new URL(requests[0]?.url ?? "https://invalid.example").searchParams.get("q"), query.value);
  assert.deepEqual(calls.find(({ name }) => name === "commit_sourcing_batch")?.params.p_query, query);
});

test("a non-sourcing document campaign is terminal before provider authorization", async () => {
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => ({ status: "campaign_not_sourcing" }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "campaign_not_sourcing" });
  assert.equal(requests, 0);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["authorize_sourcing_batch", "fail_aria_job"],
  );
  assert.equal(calls.at(-1)?.params.p_retryable, false);
});

test("a database-confirmed unsupported-role pause is terminal without a second mutation or egress", async () => {
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => ({
      status: "campaign_paused",
      job_id: JOB.id,
      campaign_id: JOB.payload.campaign_id,
      reason: "no_supported_query_terms",
    }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "no_supported_query_terms" });
  assert.equal(requests, 0);
  assert.deepEqual(calls.map(({ name }) => name), ["authorize_sourcing_batch"]);
});

test("an authorized batch commits a real candidate that hydrates and reaches draft preconditions", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const { client, calls } = makeClient();
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: successfulFetch(requests),
  });

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.redirect, "manual");
    assert.equal(new Headers(request.init?.headers).get("authorization"), null);
    assert.ok(request.init?.signal instanceof AbortSignal);
  }

  const authorizeCall = calls.find(({ name }) => name === "authorize_sourcing_batch");
  assert.deepEqual(authorizeCall?.params, {
    p_job_id: JOB.id,
    p_lease_id: JOB.lease_id,
    p_workspace_id: JOB.workspace_id,
    p_campaign_id: JOB.payload.campaign_id,
    p_campaign_sha256: JOB.payload.campaign_sha256,
    p_batch_ordinal: 0,
    p_provider_mode: "anonymous",
  });

  const beginCall = calls.find(({ name }) => name === "begin_sourcing_batch_egress");
  assert.deepEqual(beginCall?.params, {
    p_job_id: JOB.id,
    p_lease_id: JOB.lease_id,
    p_workspace_id: JOB.workspace_id,
    p_campaign_id: JOB.payload.campaign_id,
    p_campaign_sha256: JOB.payload.campaign_sha256,
    p_batch_ordinal: 0,
    p_claim_token: CLAIM_TOKEN,
    p_fence_version: 1,
    p_provider_mode: "anonymous",
    p_canonical_query_sha256: (calls.find(({ name }) => name === "commit_sourcing_batch")
      ?.params.p_query as { sha256: string }).sha256,
  });
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["authorize_sourcing_batch", "begin_sourcing_batch_egress", "commit_sourcing_batch"],
  );

  const commitCall = calls.find(({ name }) => name === "commit_sourcing_batch");
  assert.ok(commitCall);
  assert.equal(calls.some(({ name }) => name === "complete_aria_job"), false);
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  assert.equal(commitCall.params.p_claim_token, CLAIM_TOKEN);
  assert.equal(commitCall.params.p_fence_version, 1);
  assert.equal(commitCall.params.p_egress_attempt_id, EGRESS_ATTEMPT_ID);
  assert.match(String(commitCall.params.p_result_sha256), /^[a-f0-9]{64}$/);
  assert.deepEqual(commitCall.params.p_query, {
    policyVersion: "github-deterministic-v2",
    value: "language:go type:user",
    page: 1,
    sha256: (commitCall.params.p_query as { sha256: string }).sha256,
  });

  const candidates = commitCall.params.p_candidates as Array<Record<string, unknown>>;
  assert.equal(candidates.length, 1);
  assert.deepEqual(Object.keys(candidates[0]).sort(), [
    "avatarInitials",
    "booking",
    "campaignId",
    "companyStageExperience",
    "complianceFlags",
    "createdAt",
    "currentCompany",
    "currentTitle",
    "education",
    "email",
    "experience",
    "externalIds",
    "githubUrl",
    "id",
    "industryExperience",
    "languages",
    "lastContactedAt",
    "linkedinUrl",
    "location",
    "matchBreakdown",
    "matchScore",
    "name",
    "outreachHistory",
    "phone",
    "provenance",
    "recentActivity",
    "replyHistory",
    "sourceEvidence",
    "sourceExternalId",
    "sourcePlatform",
    "sourceQuery",
    "sourceUrl",
    "stage",
    "techStack",
    "timezone",
    "yearsExperience",
  ].sort());
  assert.deepEqual(
    {
      campaignId: candidates[0].campaignId,
      name: candidates[0].name,
      email: candidates[0].email,
      phone: candidates[0].phone,
      avatarInitials: candidates[0].avatarInitials,
      currentTitle: candidates[0].currentTitle,
      currentCompany: candidates[0].currentCompany,
      location: candidates[0].location,
      timezone: candidates[0].timezone,
      linkedinUrl: candidates[0].linkedinUrl,
      sourcePlatform: candidates[0].sourcePlatform,
      matchScore: candidates[0].matchScore,
      matchBreakdown: candidates[0].matchBreakdown,
      techStack: candidates[0].techStack,
      experience: candidates[0].experience,
      education: candidates[0].education,
      languages: candidates[0].languages,
      yearsExperience: candidates[0].yearsExperience,
      companyStageExperience: candidates[0].companyStageExperience,
      industryExperience: candidates[0].industryExperience,
      recentActivity: candidates[0].recentActivity,
      stage: candidates[0].stage,
      lastContactedAt: candidates[0].lastContactedAt,
      outreachHistory: candidates[0].outreachHistory,
      replyHistory: candidates[0].replyHistory,
      booking: candidates[0].booking,
      complianceFlags: candidates[0].complianceFlags,
      createdAt: candidates[0].createdAt,
      provenance: candidates[0].provenance,
    },
    {
      campaignId: JOB.payload.campaign_id,
      name: "Real User",
      email: "",
      phone: "",
      avatarInitials: "RU",
      currentTitle: "",
      currentCompany: "Observed Company",
      location: "Toronto",
      timezone: "",
      linkedinUrl: "",
      sourcePlatform: "GitHub",
      matchScore: 0,
      matchBreakdown: [],
      techStack: [],
      experience: [],
      education: [],
      languages: [],
      yearsExperience: null,
      companyStageExperience: [],
      industryExperience: [],
      recentActivity: "",
      stage: "Sourced",
      lastContactedAt: null,
      outreachHistory: [],
      replyHistory: [],
      booking: null,
      complianceFlags: {
        doNotContact: false,
        suppressed: false,
        unsubscribed: false,
        gdprExportRequested: false,
        anonymized: false,
        suppressedUntil: null,
      },
      createdAt: UPDATED_AT,
      provenance: "live",
    },
  );
  assert.equal(JSON.stringify(candidates).includes("private-field-must-not-persist"), false);
  assert.equal(JSON.stringify(candidates).includes("draft"), false);
  assert.equal(JSON.stringify(candidates).includes("contact"), false);
  const evidence = candidates[0].sourceEvidence as Record<string, unknown>;
  assert.equal(evidence.matchedLanguage, "go");
  assert.equal(evidence.searchResultOrdinal, 0);
  assert.match(String(evidence.searchResponseSha256), /^[a-f0-9]{64}$/);

  const campaign = autonomousCampaignFixture();
  const hydrated = normalizeHermesState({
    ...buildSeedState(),
    campaigns: [campaign],
    candidates: candidates as unknown as Candidate[],
    activeCampaignId: campaign.id,
  });
  const candidate = hydrated.candidates[0];
  assert.ok(`${candidate.name} ${candidate.currentTitle} ${candidate.currentCompany}`.toLowerCase().includes("real user"));
  assert.equal(candidate.complianceFlags.suppressed, false);
  assert.deepEqual(candidate.matchBreakdown.map(({ key }) => key), []);
  assert.deepEqual(candidate.techStack, []);
  const matchedCampaign = hydrated.campaigns.find(({ id }) => id === candidate.campaignId);
  assert.ok(matchedCampaign, "the candidate resolves its projected campaign");
  const generated = generateOutreach(candidate, matchedCampaign, "Casual Professional", "Email", 1);
  assert.deepEqual(generated.personalizationEvidence, [], "unknown profile facts are not fabricated into outreach");
  const draft = newOutreachMessage(
    candidate,
    matchedCampaign,
    generated,
    "Casual Professional",
    hydrated.settings,
  );
  assert.equal(draft.candidateId, candidate.id);
  assert.equal(draft.campaignId, campaign.id);
  assert.equal(draft.status, "Needs Approval");

  const receipts = commitCall.params.p_source_receipts as Array<Record<string, unknown>>;
  assert.equal(receipts.length, 2);
  assert.deepEqual(
    receipts.map(({ endpointTemplate }) => endpointTemplate),
    ["/search/users", "/users/{login}"],
  );
  assert.deepEqual(receipts.map(({ providerPage }) => providerPage), [1, 1]);
  assert.equal(JSON.stringify(receipts).includes("real-user"), false);
  assert.equal(JSON.stringify(receipts).includes("request-profile-1"), false);
  assert.match(String(receipts[1].requestIdSha256), /^[a-f0-9]{64}$/);
});

test("a later batch binds its ordinal to the exact GitHub page, query hash, and receipts", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => authorization({ batch_ordinal: 1 }),
  });

  const result = await handleSourcingBatchJob(PAGE_TWO_JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: successfulFetch(requests, 43),
  });

  assert.deepEqual(result, { outcome: "completed", candidateCount: 1, queryCount: 1 });
  const searchUrl = new URL(requests[0]?.url ?? "https://invalid.example");
  assert.equal(searchUrl.origin, "https://api.github.com");
  assert.equal(searchUrl.pathname, "/search/users");
  assert.equal(searchUrl.searchParams.get("q"), "language:go type:user");
  assert.equal(searchUrl.searchParams.get("page"), "2");

  const commit = calls.find(({ name }) => name === "commit_sourcing_batch");
  const query = commit?.params.p_query as { page?: number; sha256?: string };
  assert.equal(query.page, 2);
  const firstPage = deriveDeterministicGithubQuery(authorization().role_basis, 0);
  assert.equal(firstPage.ok, true);
  const firstPageSha256 = firstPage.query?.sha256;
  assert.equal(typeof firstPageSha256, "string");
  assert.notEqual(query.sha256, firstPageSha256);
  const receipts = commit?.params.p_source_receipts as Array<Record<string, unknown>>;
  assert.ok(receipts.length >= 1);
  assert.equal(receipts.every(({ providerPage }) => providerPage === 2), true);
  assert.equal(
    receipts.every(({ canonicalQuerySha256 }) => canonicalQuerySha256 === query.sha256),
    true,
  );
});

test("the result hash excludes mutable response headers and request identifiers", async () => {
  const hashes: string[] = [];
  for (const suffix of ["first", "second"]) {
    const { client } = makeClient({
      commit_sourcing_batch: (params) => {
        hashes.push(String(params.p_result_sha256));
        return commitResponse(params);
      },
    });
    const fetcher: typeof fetch = async (input, init) => {
      const base = successfulFetch([]);
      const response = await base(input, init);
      response.headers.set("date", suffix === "first" ? "Tue, 21 Jul 2026 12:00:00 GMT" : "Wed, 22 Jul 2026 12:00:00 GMT");
      response.headers.set("x-github-request-id", `request-${suffix}`);
      response.headers.set("x-ratelimit-remaining", suffix === "first" ? "58" : "57");
      return response;
    };
    const result = await handleSourcingBatchJob(JOB, client, { ...HANDLER_OPTIONS, fetcher });
    assert.equal(result.outcome, "completed");
  }
  assert.equal(hashes.length, 2);
  assert.equal(hashes[0], hashes[1]);
});

test("authorization replay completes without GitHub egress", async () => {
  const query = authorization().canonical_query as Record<string, unknown>;
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => ({
      status: "no_op_replay",
      job_id: JOB.id,
      workspace_id: JOB.workspace_id,
      campaign_id: JOB.payload.campaign_id,
      campaign_sha256: JOB.payload.campaign_sha256,
      batch_ordinal: 0,
      candidate_count: 2,
      query_count: 1,
      result_sha256: "b".repeat(64),
      provider_mode: "anonymous",
      canonical_query: query,
      applied_lesson: lessonSnapshot(query),
    }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, { outcome: "no_op_replay", candidateCount: 2, queryCount: 1 });
  assert.equal(requests, 0);
  assert.deepEqual(calls.map(({ name }) => name), ["authorize_sourcing_batch"]);
});

test("a duplicate egress-begin fence performs zero provider requests", async () => {
  const { client, calls } = makeClient({
    begin_sourcing_batch_egress: () => ({ status: "already_begun" }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(result, { outcome: "stale_lease" });
  assert.equal(requests, 0);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["authorize_sourcing_batch", "begin_sourcing_batch_egress"],
  );
});

test("a campaign paused after authorization is terminal before provider egress", async () => {
  const { client, calls } = makeClient({
    begin_sourcing_batch_egress: () => ({ status: "campaign_not_sourcing" }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "campaign_not_sourcing" });
  assert.equal(requests, 0);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["authorize_sourcing_batch", "begin_sourcing_batch_egress", "fail_aria_job"],
  );
  assert.equal(calls.at(-1)?.params.p_retryable, false);
});

test("an uncertain begin response performs no provider request and never uses generic failure", async () => {
  const { client, calls } = makeClient({
    begin_sourcing_batch_egress: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });

  assert.deepEqual(result, { outcome: "unavailable", reason: "rpc_unavailable" });
  assert.equal(requests, 0);
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  assert.equal(calls.some(({ name }) => name === "fail_sourcing_batch_egress"), false);
});

test("unknown transport after read-only egress schedules a bounded fenced retry", async () => {
  const { client, calls } = makeClient();
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      throw new TypeError("socket closed after request write");
    },
  });

  assert.deepEqual(result, { outcome: "retry_scheduled", reason: "search_transport_unknown" });
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  const settlement = calls.find(({ name }) => name === "fail_sourcing_batch_egress");
  assert.equal(settlement?.params.p_ambiguous, true);
  assert.equal(settlement?.params.p_retryable, false);
  assert.equal(settlement?.params.p_error_code, "search_transport_unknown");
  assert.equal((settlement?.params.p_source_receipts as unknown[]).length, 1);
});

test("GitHub rate limiting schedules a bounded retry and persists no candidates", async () => {
  const { client, calls } = makeClient();
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async (input: RequestInfo | URL) => jsonResponse(
      { message: "rate limited response must not escape" },
      String(input),
      429,
      { "retry-after": "60", "x-ratelimit-remaining": "0" },
    ),
  });

  assert.deepEqual(result, { outcome: "retry_scheduled", reason: "search_rate_limited" });
  const failCall = calls.find(({ name }) => name === "fail_sourcing_batch_egress");
  assert.equal(failCall?.params.p_retryable, true);
  assert.equal(failCall?.params.p_ambiguous, false);
  assert.equal(failCall?.params.p_error_code, "search_rate_limited");
  assert.equal(failCall?.params.p_claim_token, CLAIM_TOKEN);
  assert.equal(failCall?.params.p_fence_version, 1);
  assert.equal(failCall?.params.p_egress_attempt_id, EGRESS_ATTEMPT_ID);
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  assert.equal(calls.some(({ name }) => name === "commit_sourcing_batch"), false);
});

test("profile discovery stops before another request whenever the anonymous core bucket reaches zero", async () => {
  const roleBasis = { title: "backend engineer", skills: ["go"] };
  const derived = deriveDeterministicGithubQuery(roleBasis, 0);
  assert.equal(derived.ok, true);
  if (!derived.ok || !derived.query) return;
  const requests: string[] = [];
  const result = await discoverGithubCandidates({
    ...HANDLER_OPTIONS,
    approvedRoleBasis: roleBasis,
    batchOrdinal: 0,
    query: derived.query,
    fetcher: async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/search/users")) {
        return jsonResponse({
          total_count: 2,
          incomplete_results: false,
          items: [
            { id: 1, login: "first-user", type: "User" },
            { id: 2, login: "second-user", type: "User" },
          ],
        }, url);
      }
      return jsonResponse(
        { message: "missing" },
        url,
        404,
        {
          "x-ratelimit-resource": "core",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1784640000",
        },
      );
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "profile_rate_limited");
  assert.equal(requests.length, 2, "the second profile read must not start");
});

test("GitHub discovery rejects redirects, wrong-origin responses, and oversized bodies", async () => {
  const roleBasis = { title: "backend engineer", skills: ["go"] };
  const derived = deriveDeterministicGithubQuery(roleBasis, 0);
  assert.equal(derived.ok, true);
  if (!derived.ok || !derived.query) return;
  const scenarios: Array<{ code: string; fetcher: typeof fetch }> = [
    {
      code: "search_redirect_rejected",
      fetcher: async (input) => {
        const response = new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      },
    },
    {
      code: "search_response_url_mismatch",
      fetcher: async () => jsonResponse({}, "https://evil.example/search/users"),
    },
    {
      code: "search_response_too_large",
      fetcher: async (input) => {
        const response = new Response("{}", {
          headers: { "content-length": "9999999", "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", { value: String(input) });
        return response;
      },
    },
  ];

  for (const scenario of scenarios) {
    const result = await discoverGithubCandidates({
      ...HANDLER_OPTIONS,
      approvedRoleBasis: roleBasis,
      batchOrdinal: 0,
      query: derived.query,
      fetcher: scenario.fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, scenario.code);
    assert.equal(JSON.stringify(result.receipts).includes("evil.example"), false);
  }
});

test("GitHub discovery aborts a hung request at the configured deadline without retrying in-process", async () => {
  const roleBasis = { title: "backend engineer", skills: ["go"] };
  const derived = deriveDeterministicGithubQuery(roleBasis, 0);
  assert.equal(derived.ok, true);
  if (!derived.ok || !derived.query) return;
  let requests = 0;
  const result = await discoverGithubCandidates({
    ...HANDLER_OPTIONS,
    approvedRoleBasis: roleBasis,
    batchOrdinal: 0,
    query: derived.query,
    perCallTimeoutMs: 100,
    overallDeadlineMs: 100,
    fetcher: async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests += 1;
      return await new Promise<Response>((_resolve, reject) => {
        const guard = setTimeout(() => reject(new Error("abort did not fire")), 1_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(guard);
          reject(init.signal?.reason);
        }, { once: true });
      });
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "search_transport_unknown");
  assert.equal(requests, 1);
});

test("an unsupported approved role is dead-lettered without GitHub egress", async () => {
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => ({
      status: "campaign_paused",
      job_id: JOB.id,
      campaign_id: JOB.payload.campaign_id,
      reason: "no_supported_query_terms",
    }),
  });
  let requests = 0;
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: async () => {
      requests += 1;
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, { outcome: "dead_lettered", reason: "no_supported_query_terms" });
  assert.equal(requests, 0);
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  assert.deepEqual(calls.map(({ name }) => name), ["authorize_sourcing_batch"]);
  assert.equal(calls.some(({ name }) => name === "begin_sourcing_batch_egress"), false);
  assert.equal(calls.some(({ name }) => name === "fail_sourcing_batch_egress"), false);
});

test("an unknown commit result reconciles first and otherwise schedules a bounded retry", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const { client, calls } = makeClient({
    commit_sourcing_batch: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: successfulFetch(requests),
  });
  assert.deepEqual(result, { outcome: "retry_scheduled", reason: "commit_rpc_unavailable" });
  assert.equal(requests.length, 2);
  assert.equal(calls.some(({ name }) => name === "fail_aria_job"), false);
  assert.equal(calls.some(({ name }) => name === "complete_aria_job"), false);
  const settlement = calls.find(({ name }) => name === "fail_sourcing_batch_egress");
  assert.equal(settlement?.params.p_ambiguous, true);
  assert.equal(settlement?.params.p_retryable, false);
  assert.equal(settlement?.params.p_error_code, "commit_rpc_unavailable");
  assert.equal(settlement?.params.p_result_sha256, calls.find(({ name }) => name === "commit_sourcing_batch")?.params.p_result_sha256);
});

test("a campaign mutation after egress is settled as a terminal fenced failure", async () => {
  const { client, calls } = makeClient({
    commit_sourcing_batch: () => ({ status: "campaign_changed" }),
  });
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    fetcher: successfulFetch([]),
  });

  assert.deepEqual(result, { outcome: "dead_lettered", reason: "campaign_changed" });
  const settlement = calls.find(({ name }) => name === "fail_sourcing_batch_egress");
  assert.equal(settlement?.params.p_error_code, "campaign_changed");
  assert.equal(settlement?.params.p_retryable, false);
  assert.equal(settlement?.params.p_ambiguous, false);
});

test("commit uncertainty accepts only an exact recovered completion receipt", async () => {
  const run = async (forged: boolean) => {
    const { client } = makeClient({
      commit_sourcing_batch: () => ({ data: null, error: { code: "rpc_unavailable" } }),
      fail_sourcing_batch_egress: (params) => ({
        status: "completed",
        job_id: JOB.id,
        egress_attempt_id: EGRESS_ATTEMPT_ID,
        candidate_count: params.p_candidate_count,
        query_count: params.p_query_count,
        result_sha256: forged ? "f".repeat(64) : params.p_result_sha256,
      }),
    });
    return handleSourcingBatchJob(JOB, client, {
      ...HANDLER_OPTIONS,
      fetcher: successfulFetch([]),
    });
  };

  assert.deepEqual(await run(false), { outcome: "completed", candidateCount: 1, queryCount: 1 });
  assert.deepEqual(
    await run(true),
    { outcome: "unavailable", reason: "invalid_egress_settlement_response" },
  );
});

test("the loop uses the bounded fair sourcing claim with a lease longer than its discovery deadline", async () => {
  const calls: Array<{ name: string; params: RpcParams }> = [];
  const client = {
    async rpc(name: string, params: RpcParams) {
      calls.push({ name, params });
      if (name === "claim_due_sourcing_batch_jobs") return { data: [JOB], error: null };
      return { data: 0, error: null };
    },
  };
  const configuration = loadSourcingLoopConfiguration({
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    ARIA_RELEASE_SHA: "a".repeat(40),
    ARIA_SOURCING_GITHUB_RESULT_LIMIT: "3",
    ARIA_SOURCING_REQUEST_TIMEOUT_MS: "1000",
    ARIA_SOURCING_DEADLINE_MS: "5000",
  });
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    async () => {
      throw new Error("dispatch is unconfigured and handler is injected");
    },
    {
      handleSourcingBatchJob: async () => ({ outcome: "completed", candidateCount: 1, queryCount: 1 }),
    },
  );

  const claim = calls.find(({ name }) => name === "claim_due_sourcing_batch_jobs");
  assert.equal(claim?.params.p_limit, 1);
  assert.ok(Number(claim?.params.p_lease_seconds) * 1_000 > configuration.sourcingDeadlineMs);
  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 1);
});

test("loop configuration defaults anonymous, keeps tokens non-serializable, and enforces hard caps", () => {
  const environment = {
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    ARIA_RELEASE_SHA: "a".repeat(40),
    GITHUB_TOKEN: "must-never-be-read",
  };
  const configuration = loadSourcingLoopConfiguration(environment);
  assert.equal(configuration.sourcingProviderMode, "anonymous");
  assert.equal(configuration.sourcingGithubClaimConcurrency, 1);
  assert.equal(JSON.stringify(configuration).includes("must-never-be-read"), false);
  assert.ok(configuration.sourcingGithubResultLimit <= 3);

  assert.throws(
    () => loadSourcingLoopConfiguration({ ...environment, ARIA_SOURCING_GITHUB_RESULT_LIMIT: "4" }),
    /ARIA_SOURCING_GITHUB_RESULT_LIMIT/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...environment, ARIA_SOURCING_DEADLINE_MS: "90000" }),
    /ARIA_SOURCING_DEADLINE_MS/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...environment, ARIA_SOURCING_CLAIM_CONCURRENCY: "4" }),
    /ARIA_SOURCING_CLAIM_CONCURRENCY/,
  );
});

test("authenticated GitHub mode is explicit, token-safe, and binds every database and provider receipt", async () => {
  const token = `github_pat_${"a".repeat(72)}`;
  const configuration = loadSourcingLoopConfiguration({
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    ARIA_RELEASE_SHA: "a".repeat(40),
    ARIA_SOURCING_GITHUB_PROVIDER_MODE: "authenticated",
    GITHUB_TOKEN: token,
  });
  assert.equal(configuration.sourcingProviderMode, "authenticated");
  assert.equal(JSON.stringify(configuration).includes(token), false);
  assert.equal(JSON.stringify(configuration.sourcingGithubCredential), '{"kind":"authenticated"}');

  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const { client, calls } = makeClient({
    authorize_sourcing_batch: () => authorization({ provider_mode: "authenticated" }),
    begin_sourcing_batch_egress: (params) => ({
      status: "begun",
      job_id: JOB.id,
      workspace_id: JOB.workspace_id,
      campaign_id: JOB.payload.campaign_id,
      claim_token: CLAIM_TOKEN,
      fence_version: 1,
      egress_attempt_id: EGRESS_ATTEMPT_ID,
      provider_mode: "authenticated",
      canonical_query_sha256: params.p_canonical_query_sha256,
    }),
  });
  const result = await handleSourcingBatchJob(JOB, client, {
    ...HANDLER_OPTIONS,
    credential: configuration.sourcingGithubCredential,
    fetcher: successfulFetch(requests),
  });

  assert.equal(result.outcome, "completed");
  assert.equal(calls.find(({ name }) => name === "authorize_sourcing_batch")?.params.p_provider_mode, "authenticated");
  assert.equal(calls.find(({ name }) => name === "begin_sourcing_batch_egress")?.params.p_provider_mode, "authenticated");
  assert.equal(JSON.stringify(calls).includes(token), false);
  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.equal(new Headers(request.init?.headers).get("authorization"), `Bearer ${token}`);
  }
  const receipts = calls.find(({ name }) => name === "commit_sourcing_batch")?.params.p_source_receipts as Array<Record<string, unknown>>;
  assert.ok(receipts.every((receipt) => receipt.providerMode === "authenticated"));
});

test("authenticated GitHub mode fails closed without one valid token", () => {
  const base = {
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    ARIA_RELEASE_SHA: "a".repeat(40),
  };
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...base, ARIA_SOURCING_GITHUB_PROVIDER_MODE: "authenticated" }),
    /invalid GITHUB_TOKEN/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...base, ARIA_SOURCING_GITHUB_PROVIDER_MODE: "authenticated", GITHUB_TOKEN: "short" }),
    /invalid GITHUB_TOKEN/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...base, ARIA_SOURCING_GITHUB_PROVIDER_MODE: "AUTHENTICATED", GITHUB_TOKEN: "x".repeat(40) }),
    /invalid ARIA_SOURCING_GITHUB_PROVIDER_MODE/,
  );
});

test("bounded sourcing concurrency settles every claimed job without exceeding the configured cap", async () => {
  const jobs = Array.from({ length: 3 }, (_, index) => ({
    ...JOB,
    id: `70000000-0000-4000-8000-00000000000${index + 1}`,
    lease_id: `80000000-0000-4000-8000-00000000000${index + 1}`,
    workspace_id: `51111111-1111-4111-8111-11111111111${index + 1}`,
  }));
  const calls: Array<{ name: string; params: RpcParams }> = [];
  const client = {
    async rpc(name: string, params: RpcParams) {
      calls.push({ name, params });
      if (name === "claim_due_sourcing_batch_jobs") return { data: jobs, error: null };
      if (name === "record_sourcing_loop_heartbeat") return { data: true, error: null };
      if (name === "claim_due_aria_jobs") return { data: [], error: null };
      return { data: 0, error: null };
    },
  };
  const configuration = loadSourcingLoopConfiguration({
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    ARIA_RELEASE_SHA: "a".repeat(40),
    ARIA_SOURCING_CLAIM_CONCURRENCY: "3",
  });
  let active = 0;
  let maximumActive = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    async () => { throw new Error("provider egress must use the injected handler"); },
    {
      handleSourcingBatchJob: async (job: typeof JOB) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        if (job.id === jobs[1].id) throw new Error("bounded-handler-failure");
        return job.id === jobs[2].id
          ? { outcome: "no_op_replay", candidateCount: 0, queryCount: 1 }
          : { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );
  const claim = calls.find(({ name }) => name === "claim_due_sourcing_batch_jobs");
  assert.equal(claim?.params.p_limit, 3);
  assert.equal(maximumActive, 3);
  assert.equal(result.claimed, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.replayed, 1);
  assert.deepEqual(result.failureCodes, ["sourcing_batch:unavailable"]);
});

test("production image contains the sourcing handler modules", () => {
  const dockerfile = readFileSync("Dockerfile.prod", "utf8");
  assert.match(dockerfile, /COPY[^\n]+scripts\/sourcing-loop-handlers/);
});

test("outcome validator rejects invented statuses and missing failure reasons", () => {
  assert.equal(isValidSourcingBatchOutcome({ outcome: "completed", candidateCount: 1, queryCount: 1 }), true);
  assert.equal(isValidSourcingBatchOutcome({ outcome: "no_op_replay", candidateCount: 0, queryCount: 1 }), true);
  assert.equal(isValidSourcingBatchOutcome({ outcome: "retry_scheduled", reason: "rate_limited" }), true);
  assert.equal(isValidSourcingBatchOutcome({ outcome: "ambiguous_dead_lettered", reason: "transport_unknown" }), true);
  assert.equal(isValidSourcingBatchOutcome({ outcome: "dead_lettered" }), false);
  assert.equal(isValidSourcingBatchOutcome({ outcome: "invented" }), false);
});
