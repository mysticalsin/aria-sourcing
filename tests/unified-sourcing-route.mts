import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed";
import { campaignSourcingBasis, orderedSteps, type CampaignSourcingJob } from "../src/lib/sourcing/unified-contract";
const url = (p: string) => new URL(`../${p}`, import.meta.url).href;
const state = buildSeedState();
state.campaigns[0].status = "Sourcing";
const campaign = state.campaigns[0];
const actorId = crypto.randomUUID(); const workspaceId = crypto.randomUUID();
const job: CampaignSourcingJob = { id: crypto.randomUUID(), actor_id: actorId, workspace_id: workspaceId,
  campaign_id: campaign.id, campaign_snapshot: campaignSourcingBasis(campaign), status: "active", revision: 0,
  claim_token: null, claim_until: null, created_at: new Date().toISOString(),
  steps: orderedSteps([{ source: "LinkedIn", query: campaign.jobAnalysis.requiredSkills[0], limit: 3 }]) };
let signedIn = true, role = "member", apifyKey: string | null = "fixture", visible = true, advanceCalls = 0, startCalls = 0, readCalls = 0;
const session = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: actorId } : null } }) },
  rpc: async (name: string) => ({ data: name === "current_profile_role" ? role : workspaceId, error: null }) };
mock.module("server-only", { namedExports: {} });
mock.module(url("src/lib/supabase/config.ts"), { namedExports: { supabaseEnabled: true, prodFailClosed: () => null } });
mock.module(url("src/lib/supabase/server.ts"), { namedExports: { getServerSupabase: async () => session, getServiceSupabase: () => ({}) } });
mock.module(url("src/lib/sourcing/unified-repository.ts"), { namedExports: {
  unifiedRepository: () => ({ readWorkspace: async () => { readCalls++; return { state, updatedAt: "v1" }; } }),
  loadUnifiedJob: async (workspace: string) => { assert.equal(workspace, workspaceId); return visible ? job : null; },
  startUnifiedJob: async (input: { actorId: string; workspaceId: string; campaignId: string }) => { startCalls++; assert.equal(input.actorId, actorId); assert.equal(input.workspaceId, workspaceId); assert.equal(input.campaignId, campaign.id); return job; },
} });
mock.module(url("src/lib/sourcing/unified-run.ts"), { namedExports: {
  reviewedCampaign: () => campaign, advanceUnifiedRun: async () => { advanceCalls++; },
} });
mock.module(url("src/lib/sourcing/apify.ts"), { namedExports: {
  resolveStoredApifyKey: async () => apifyKey, startProfileSearchRun: () => {}, getRunStatus: () => {}, fetchDatasetItems: () => {},
} });
mock.module(url("src/lib/sourcing/github.ts"), { namedExports: { searchGithubUsers: () => {} } });
const { POST } = await import("../src/app/api/source/campaign/route");
const request = (body: object, origin = "http://localhost") => new NextRequest("http://localhost/api/source/campaign", {
  method: "POST", headers: { "content-type": "application/json", origin, "x-real-ip": crypto.randomUUID() }, body: JSON.stringify(body),
});
const start = () => ({ action: "start", campaignId: campaign.id, requestKey: crypto.randomUUID(), sources: [{ source: "LinkedIn", query: campaign.jobAnalysis.requiredSkills[0], limit: 3 }] });

test("anonymous and viewers cannot read campaign authority or launch providers", async () => {
  for (const denied of ["anonymous", "viewer"]) {
    signedIn = denied !== "anonymous"; role = "viewer"; readCalls = 0;
    assert.equal((await POST(request(start()))).status, 403); assert.equal(readCalls, 0);
  }
  signedIn = true; role = "member";
});
test("mutations require exact same origin and reject client-owned run bindings", async () => {
  assert.equal((await POST(request(start(), "https://attacker.example"))).status, 403);
  const response = await POST(request({ action: "advance", runId: job.id, datasetId: "other-dataset", workspaceId: "other" }));
  assert.equal(response.status, 400); assert.equal(advanceCalls, 0);
});
test("missing LinkedIn config cannot silently fall back or create a paid run", async () => {
  apifyKey = null;
  assert.equal((await POST(request(start()))).status, 409); assert.equal(startCalls, 0);
  apifyKey = "fixture";
});
test("start uses server campaign and workspace; progress DTO excludes private bindings", async () => {
  const response = await POST(request(start()));
  assert.equal(response.status, 200); assert.equal(startCalls, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /campaign_snapshot|workspace_id|actor_id|fixture/);
});
test("cross-workspace or unknown run IDs never reach provider advancement", async () => {
  visible = false;
  assert.equal((await POST(request({ action: "advance", runId: job.id }))).status, 404); assert.equal(advanceCalls, 0);
  visible = true;
  const original = job.actor_id; job.actor_id = crypto.randomUUID();
  assert.equal((await POST(request({ action: "advance", runId: job.id }))).status, 403); assert.equal(advanceCalls, 0);
  job.actor_id = original;
  assert.equal((await POST(request({ action: "advance", runId: job.id }))).status, 200); assert.equal(advanceCalls, 1);
});
test("closing a completed run is idempotent and cannot turn success into failure", async () => {
  job.status = "completed";
  const response = await POST(request({ action: "close", runId: job.id }));
  assert.equal(response.status, 200); assert.equal((await response.json()).run.status, "completed");
  job.status = "active";
});
