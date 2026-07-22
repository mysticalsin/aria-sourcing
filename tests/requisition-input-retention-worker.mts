import assert from "node:assert/strict";
import test from "node:test";

import { cleanupApolloAuthorityOnce } from "../scripts/apollo-authority-cleanup-worker.mjs";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function baselineReceipt(name: string) {
  if (name === "cleanup_apollo_enrichment_authority") {
    return {
      status: "cleaned",
      processed: 0,
      expired_receipts_cleared: 0,
      confirmations_deleted: 0,
      targets_deleted: 0,
      expired_targets_scrubbed: 0,
      quota_rows_deleted: 0,
    };
  }
  if (name === "cleanup_sourcing_learning_authority") {
    return {
      status: "cleaned",
      retired: 0,
      lessons_deleted: 0,
      artifacts_deleted: 0,
      runs_deleted: 0,
      quota_deleted: 0,
      ordinary_results_expired: 0,
      ordinary_result_payloads_scrubbed: 0,
    };
  }
  if (name === "cleanup_agent_framework_authority") {
    return { status: "cleaned", deleted: 0 };
  }
  throw new Error(`unexpected baseline RPC: ${name}`);
}

function makeClient(requisitionReceipts: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let requisitionCall = 0;
  return {
    calls,
    from() {
      return {
        select() { return this; },
        order() { return this; },
        async range(from: number) {
          return { data: from === 0 ? [{ id: workspaceId }] : [], error: null };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "cleanup_requisition_input_authority") {
        const data = requisitionReceipts[Math.min(requisitionCall, requisitionReceipts.length - 1)];
        requisitionCall += 1;
        return { data, error: null };
      }
      return { data: baselineReceipt(name), error: null };
    },
  };
}

test("cleanup worker drains exact bounded raw-requisition receipts", async () => {
  const client = makeClient([
    {
      status: "cleaned",
      processed: 2,
      raw_inputs_scrubbed: 2,
      receipts_written: 2,
    },
    {
      status: "cleaned",
      processed: 0,
      raw_inputs_scrubbed: 0,
      receipts_written: 0,
    },
  ]);

  const result = await cleanupApolloAuthorityOnce(client, {
    pageSize: 1,
    maxPages: 2,
    perCallLimit: 2,
    maxPassesPerWorkspace: 3,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.requisition_inputs_processed, 2);
  assert.equal(result.requisition_inputs_scrubbed, 2);
  assert.equal(result.requisition_cleanup_receipts_written, 2);
  assert.deepEqual(
    client.calls.filter((call) => call.name === "cleanup_requisition_input_authority"),
    [
      {
        name: "cleanup_requisition_input_authority",
        args: { p_workspace_id: workspaceId, p_limit: 2 },
      },
      {
        name: "cleanup_requisition_input_authority",
        args: { p_workspace_id: workspaceId, p_limit: 2 },
      },
    ],
  );
});

test("cleanup worker rejects extra, over-limit, or inconsistent requisition counters", async () => {
  const malformed = [
    {
      status: "cleaned",
      processed: 0,
      raw_inputs_scrubbed: 0,
      receipts_written: 0,
      raw_content: "must never be accepted",
    },
    {
      status: "cleaned",
      processed: 3,
      raw_inputs_scrubbed: 3,
      receipts_written: 3,
    },
    {
      status: "cleaned",
      processed: 1,
      raw_inputs_scrubbed: 0,
      receipts_written: 1,
    },
  ];

  for (const receipt of malformed) {
    const client = makeClient([receipt]);
    const result = await cleanupApolloAuthorityOnce(client, {
      pageSize: 1,
      maxPages: 1,
      perCallLimit: 2,
      maxPassesPerWorkspace: 1,
    });
    assert.equal(result.status, "degraded");
    assert.deepEqual(result.failures, [{
      workspaceId,
      code: "requisition_cleanup_rpc_unavailable",
    }]);
  }
});
