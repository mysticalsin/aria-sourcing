import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const specId = "33333333-3333-4333-8333-333333333333";
const workflowVersionId = "44444444-4444-4444-8444-444444444444";
const idempotencyKey = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const seed = buildSeedState();
const campaign = { ...seed.campaigns[0], id: "campaign-framework-learning", status: "Sourcing" as const };
const baselineQuery = campaign.sourcingStrategy.githubQueries[0]?.query ?? "language:Go";
const promotedReviewedQuery = campaign.sourcingStrategy.githubQueries[1]?.query ?? baselineQuery;
const unreviewedQuery = "language:python location:ottawa";
let capturedQueries: string[] = [];
let capturedRoleBasis: Record<string, unknown> | null = null;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    prodFailClosed: () => null,
    supabaseEnabled: true,
  },
});

function queryFor(table: string) {
  const query: Record<string, unknown> = {};
  Object.assign(query, {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: table === "workspace_state"
        ? {
            state: {
              campaigns: [campaign],
              candidates: [],
              settings: { llmProviders: [], savedModels: [], defaultModels: {} },
            },
          }
        : {
            id: specId,
            owner_id: userId,
            role_brief: { title: campaign.jobAnalysis.title },
            channels: ["Email"],
            guardrails: { autopilot: false, canary_remaining: 5, topics_allow: [] },
            status: "active",
          },
      error: null,
    }),
  });
  return query;
}

const session = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? "admin" : workspaceId,
    error: null,
  }),
  from: (table: string) => queryFor(table),
};
const service = { rpc: async () => ({ data: null, error: null }) };

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => session,
    getServiceSupabase: () => service,
  },
});
mock.module(moduleUrl("src/lib/agents/framework/runtime-config.ts"), {
  namedExports: {
    agentFrameworkRuntimeFromEnvironment: () => ({
      config: {
        deerflowUrl: "https://deerflow.internal",
        deerflowSourceCommit: "3c0a45ad772cdba388009b8d5ecad5e48cd22429",
        deerflowImageDigest: `registry.internal/deerflow@sha256:${"a".repeat(64)}`,
        flowiseUrl: "https://flowise.internal",
        flowiseSourceCommit: "ed9e100fb71643cd3922b005908f9732bc0e07dc",
        flowiseImageDigest: `registry.internal/flowise@sha256:${"b".repeat(64)}`,
        flowiseIsolation: "instance-per-workspace",
        configurationSha256: "c".repeat(64),
        configurationIntegrity: true,
        executionEnabled: true,
        killSwitch: false,
      },
      tokens: { deerflowToken: "d".repeat(32), flowiseToken: "f".repeat(32) },
    }),
  },
});
mock.module(moduleUrl("src/lib/sourcing/learning-authority.ts"), {
  namedExports: {
    listPromotedSourcingLessons: async (input: { roleBasis: Record<string, unknown> }) => {
      capturedRoleBasis = input.roleBasis;
      return {
        status: "ready",
        roleFingerprint: "d".repeat(64),
        lessons: [
          {
            lessonId: "77777777-7777-4777-8777-777777777777",
            platform: "GitHub",
            query: promotedReviewedQuery,
            graphifyClusterRef: "community:0",
            graphifyClusterRank: 1,
            evidenceRunCount: 2,
            evidenceCampaignCount: 2,
            usefulFeedbackCount: 2,
            expiresAt: "2026-10-01T00:00:00.000Z",
            rank: 1,
          },
          {
            lessonId: "88888888-8888-4888-8888-888888888888",
            platform: "GitHub",
            query: unreviewedQuery,
            graphifyClusterRef: "community:1",
            graphifyClusterRank: 1,
            evidenceRunCount: 2,
            evidenceCampaignCount: 2,
            usefulFeedbackCount: 2,
            expiresAt: "2026-10-01T00:00:00.000Z",
            rank: 2,
          },
        ],
      };
    },
  },
});
mock.module(moduleUrl("src/lib/agents/framework/execution.ts"), {
  namedExports: {
    executeAgentFrameworkRun: async (input: {
      reviewedGithubQueries: string[];
      revalidateAuthority: () => Promise<boolean>;
    }) => {
      capturedQueries = input.reviewedGithubQueries;
      assert.equal(await input.revalidateAuthority(), true);
      return {
        ok: true,
        runId,
        reports: ["Selected the highest-ranked reviewed query."],
        sourceReviewedCampaign: true,
        sourceQuery: input.reviewedGithubQueries[0],
        sourcingCapabilityToken: "s".repeat(43),
      };
    },
  },
});

const route = await import("../src/app/api/agents/run/route");

test("a promoted exact-role lesson selects only reviewed authority for the next framework run", async () => {
  const response = await route.POST(new NextRequest("http://localhost/api/agents/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      campaignId: campaign.id,
      specId,
      workflowVersionId,
      count: 5,
    }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.command.query, promotedReviewedQuery);
  assert.equal(capturedQueries[0], promotedReviewedQuery);
  assert.equal(capturedQueries.includes(baselineQuery), false);
  assert.equal(capturedQueries.includes(unreviewedQuery), false);
  assert.deepEqual(capturedQueries, [promotedReviewedQuery]);
  assert.equal(capturedRoleBasis?.title, campaign.jobAnalysis.title);
  assert.deepEqual(capturedRoleBasis?.skills, [
    ...campaign.jobAnalysis.requiredSkills,
    ...campaign.jobAnalysis.niceToHaveSkills,
  ]);
});
