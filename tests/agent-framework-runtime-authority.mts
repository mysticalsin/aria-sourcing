import assert from "node:assert/strict";

import {
  claimAgentFrameworkRun,
  completeAgentFrameworkRun,
  failAgentFrameworkRun,
  recordAgentFrameworkStep,
  type FrameworkRpcClient,
} from "../src/lib/agents/framework/authority";
import { DEERFLOW_SOURCE_COMMIT, FLOWISE_SOURCE_COMMIT } from "../src/lib/agents/framework/contracts";

let pass = 0;
function test(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    pass += 1;
    console.log(`PASS: ${name}`);
  });
}

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const claimReceipt = {
  status: "claimed",
  run_id: "10000000-0000-4000-8000-000000000001",
  lease_id: "20000000-0000-4000-8000-000000000002",
  lease_expires_at: "2026-07-14T15:00:00.000Z",
  configuration_sha256: "1".repeat(64),
  workflow_version_id: "30000000-0000-4000-8000-000000000003",
  workflow_sha256: "2".repeat(64),
  workflow: {
    version: 1,
    name: "Reviewed sourcing",
    nodes: [
      { id: "plan", kind: "plan" },
      { id: "source", kind: "source_reviewed_campaign" },
      { id: "report", kind: "report" },
    ],
    edges: [
      { from: "plan", to: "source" },
      { from: "source", to: "report" },
    ],
  },
  deerflow_instance_id: "40000000-0000-4000-8000-000000000004",
  deerflow_source_commit: DEERFLOW_SOURCE_COMMIT,
  deerflow_image_digest: `registry.internal/deerflow@sha256:${"3".repeat(64)}`,
  deerflow_readiness_sha256: "4".repeat(64),
  flowise_instance_id: "50000000-0000-4000-8000-000000000005",
  flowise_source_commit: FLOWISE_SOURCE_COMMIT,
  flowise_image_digest: `registry.internal/flowise@sha256:${"5".repeat(64)}`,
  flowise_isolation_mode: "instance-per-workspace",
  flowise_readiness_sha256: "6".repeat(64),
};

const client: FrameworkRpcClient = {
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_agent_framework_run") return { data: claimReceipt, error: null };
    if (name === "record_agent_framework_step_receipt") return { data: { status: "recorded" }, error: null };
    if (name === "complete_agent_framework_run") return { data: { status: "proposed" }, error: null };
    if (name === "fail_agent_framework_run") return { data: { status: "failed" }, error: null };
    return { data: null, error: { message: "unexpected" } };
  },
};

await test("claim maps only server-owned authority and exact framework provenance", async () => {
  const result = await claimAgentFrameworkRun(client, {
    workspaceId: "60000000-0000-4000-8000-000000000006",
    ownerId: "70000000-0000-4000-8000-000000000007",
    actorId: "70000000-0000-4000-8000-000000000007",
    specId: "80000000-0000-4000-8000-000000000008",
    campaignId: "campaign-a",
    campaignFingerprint: "7".repeat(64),
    workflowVersionId: claimReceipt.workflow_version_id,
    idempotencyKey: "90000000-0000-4000-8000-000000000009",
    capabilitySha256: "8".repeat(64),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  if (!("claim" in result)) assert.fail("Expected an active claim receipt");
  assert.equal(result.claim.flowiseImageDigest, claimReceipt.flowise_image_digest);
  assert.equal(result.claim.deerflowReadinessSha256, claimReceipt.deerflow_readiness_sha256);
  assert.deepEqual(calls.at(-1), {
    name: "claim_agent_framework_run",
    args: {
      p_workspace_id: "60000000-0000-4000-8000-000000000006",
      p_owner_id: "70000000-0000-4000-8000-000000000007",
      p_actor_id: "70000000-0000-4000-8000-000000000007",
      p_spec_id: "80000000-0000-4000-8000-000000000008",
      p_campaign_id: "campaign-a",
      p_campaign_fingerprint: "7".repeat(64),
      p_workflow_version_id: claimReceipt.workflow_version_id,
      p_idempotency_key: "90000000-0000-4000-8000-000000000009",
      p_capability_sha256: "8".repeat(64),
    },
  });
});

await test("malformed or failed database receipts never invent run authority", async () => {
  const malformed: FrameworkRpcClient = { async rpc() { return { data: { status: "claimed", run_id: "bad" }, error: null }; } };
  const failed: FrameworkRpcClient = { async rpc() { return { data: null, error: { message: "secret db error" } }; } };
  const input = {
    workspaceId: "60000000-0000-4000-8000-000000000006",
    ownerId: "70000000-0000-4000-8000-000000000007",
    actorId: "70000000-0000-4000-8000-000000000007",
    specId: "80000000-0000-4000-8000-000000000008",
    campaignId: "campaign-a",
    campaignFingerprint: "7".repeat(64),
    workflowVersionId: claimReceipt.workflow_version_id,
    idempotencyKey: "90000000-0000-4000-8000-000000000009",
    capabilitySha256: "8".repeat(64),
  };
  assert.deepEqual(await claimAgentFrameworkRun(malformed, input), { ok: false, status: "authority_unavailable" });
  assert.deepEqual(await claimAgentFrameworkRun(failed, input), { ok: false, status: "authority_unavailable" });
});

await test("step, completion, and failure mutations carry only bounded public receipts", async () => {
  assert.equal(await recordAgentFrameworkStep(client, {
    runId: claimReceipt.run_id,
    leaseId: claimReceipt.lease_id,
    ordinal: 0,
    nodeKind: "source_reviewed_campaign",
    idempotencyKey: "90000000-0000-4000-8000-000000000009.0",
    requestSha256: "9".repeat(64),
    responseSha256: "a".repeat(64),
  }), "recorded");
  assert.equal(await completeAgentFrameworkRun(
    client,
    claimReceipt.run_id,
    claimReceipt.lease_id,
    "b".repeat(64),
    "c".repeat(64),
    5,
    "language:typescript location:montreal",
    ["Run the exact reviewed campaign query."],
  ), "proposed");
  assert.deepEqual(calls.at(-1)?.args.p_reports, ["Run the exact reviewed campaign query."]);
  assert.equal(await failAgentFrameworkRun(client, claimReceipt.run_id, claimReceipt.lease_id, "ADAPTER_FAILED"), "failed");
  assert.equal(JSON.stringify(calls.slice(-3)).includes("candidate"), false);
});

console.log(`RESULT agent-framework-runtime-authority: ${pass} passed, 0 failed`);
