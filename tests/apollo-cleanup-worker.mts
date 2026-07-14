import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import {
  cleanupApolloAuthorityOnce,
  createSupabaseServiceClient,
} from "../scripts/apollo-authority-cleanup-worker.mjs";
import {
  verifyCleanupProcessGroups,
  verifyHealthyCleanupEvent,
  verifyHealthyFrameworkHeartbeatEvent,
  verifyReleaseProcessGroups,
} from "../scripts/verify-apollo-cleanup-release.mjs";

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

test("cleanup worker paginates, drains bounded batches, and isolates workspace failures", async () => {
  const workspaces = [{ id: workspaceA }, { id: workspaceB }];
  const calls = new Map<string, number>();
  const client = {
    from(name: string) {
      assert.equal(name, "workspaces");
      return {
        select() { return this; },
        order() { return this; },
        async range(from: number, to: number) {
          return { data: workspaces.slice(from, to + 1), error: null };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const workspaceId = String(args.p_workspace_id);
      const callKey = `${workspaceId}:${name}`;
      const call = (calls.get(callKey) ?? 0) + 1;
      calls.set(callKey, call);
      if (workspaceId === workspaceB && name === "cleanup_apollo_enrichment_authority") {
        return { data: null, error: { code: "08006" } };
      }
      if (name === "cleanup_sourcing_learning_authority") {
        const retired = call === 1 ? 1 : 0;
        return {
          data: {
            status: "cleaned",
            retired,
            lessons_deleted: 0,
            artifacts_deleted: 0,
            runs_deleted: 0,
            quota_deleted: 0,
          },
          error: null,
        };
      }
      if (name === "cleanup_agent_framework_authority") {
        return {
          data: { status: "cleaned", deleted: call === 1 ? 2 : 0 },
          error: null,
        };
      }
      assert.equal(name, "cleanup_apollo_enrichment_authority");
      const processed = call === 1 ? 2 : 0;
      return {
        data: {
          status: "cleaned",
          processed,
          expired_receipts_cleared: processed,
          confirmations_deleted: 0,
          targets_deleted: 0,
          expired_targets_scrubbed: 0,
          quota_rows_deleted: 0,
        },
        error: null,
      };
    },
  };

  const result = await cleanupApolloAuthorityOnce(client, {
    pageSize: 1,
    maxPages: 3,
    perCallLimit: 2,
    maxPassesPerWorkspace: 3,
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.workspacesProcessed, 1);
  assert.equal(result.expired_receipts_cleared, 2);
  assert.equal(result.sourcing_lessons_retired, 1);
  assert.equal(result.framework_authorizations_deleted, 2);
  assert.deepEqual(result.failures, [{ workspaceId: workspaceB, code: "apollo_cleanup_rpc_unavailable" }]);
  assert.equal(calls.get(`${workspaceA}:cleanup_apollo_enrichment_authority`), 2);
  assert.equal(calls.get(`${workspaceA}:cleanup_sourcing_learning_authority`), 2);
  assert.equal(calls.get(`${workspaceA}:cleanup_agent_framework_authority`), 2);
  assert.equal(calls.get(`${workspaceB}:cleanup_apollo_enrichment_authority`), 1);
  assert.equal(calls.get(`${workspaceB}:cleanup_sourcing_learning_authority`), undefined);
  assert.equal(calls.get(`${workspaceB}:cleanup_agent_framework_authority`), undefined);
});

test("Fly image starts one isolated cleanup process with bounded structured evidence", () => {
  const fly = readFileSync("fly.app.toml", "utf8");
  const dockerfile = readFileSync("Dockerfile.prod", "utf8");
  const deploy = readFileSync("deploy-fly.sh", "utf8");
  const worker = readFileSync("scripts/apollo-authority-cleanup-worker.mjs", "utf8");
  assert.match(fly, /\[processes\][\s\S]*web\s*=\s*"node server\.js"[\s\S]*cleanup\s*=\s*"node scripts\/apollo-authority-cleanup-worker\.mjs"/);
  assert.match(fly, /\[http_service\][\s\S]*processes\s*=\s*\["web"\]/);
  assert.match(dockerfile, /apollo-authority-cleanup-worker\.mjs/);
  assert.doesNotMatch(worker, /@supabase\/supabase-js/);
  assert.match(worker, /maxPassesPerWorkspace/);
  assert.match(worker, /JSON\.stringify/);
  assert.doesNotMatch(worker, /console\.(?:log|error)\([^)]*(?:SUPABASE_SERVICE_ROLE_KEY|\bkey\b)/);
  assert.match(deploy, /verify-apollo-cleanup-release\.mjs machines/);
  assert.match(deploy, /verify-apollo-cleanup-release\.mjs logs/);
  assert.match(deploy, /verify-apollo-cleanup-release\.mjs heartbeat-logs/);
});

test("standalone cleanup client uses bounded service-role REST requests without response leakage", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    const url = String(input);
    const body = url.endsWith("cleanup_sourcing_learning_authority")
      ? {
          status: "cleaned",
          retired: 0,
          lessons_deleted: 0,
          artifacts_deleted: 0,
          runs_deleted: 0,
          quota_deleted: 0,
        }
      : url.endsWith("cleanup_agent_framework_authority")
        ? { status: "cleaned", deleted: 0 }
        : {
            status: "cleaned",
            processed: 0,
            expired_receipts_cleared: 0,
            confirmations_deleted: 0,
            targets_deleted: 0,
            expired_targets_scrubbed: 0,
            quota_rows_deleted: 0,
          };
    return new Response(
      requests.length === 1
        ? JSON.stringify([{ id: workspaceA }])
        : JSON.stringify(body),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const serviceKey = "service-key-that-is-long-enough-for-the-runtime";
  const client = createSupabaseServiceClient("https://supabase.example", serviceKey, fakeFetch);
  const workspaces = await client.from("workspaces").select("id").order("id", { ascending: true }).range(0, 9);
  const receipt = await client.rpc("cleanup_apollo_enrichment_authority", {
    p_workspace_id: workspaceA,
    p_limit: 500,
  });
  const learningReceipt = await client.rpc("cleanup_sourcing_learning_authority", {
    p_workspace_id: workspaceA,
    p_limit: 500,
  });
  const frameworkReceipt = await client.rpc("cleanup_agent_framework_authority", {
    p_workspace_id: workspaceA,
    p_limit: 500,
  });

  assert.deepEqual(workspaces.error, null);
  assert.deepEqual(receipt.error, null);
  assert.deepEqual(learningReceipt.error, null);
  assert.deepEqual(frameworkReceipt.error, null);
  assert.equal(requests.length, 4);
  assert.match(requests[0].url, /\/rest\/v1\/workspaces\?select=id&order=id\.asc$/);
  assert.equal(new Headers(requests[0].init?.headers).get("Range"), "0-9");
  assert.equal(new Headers(requests[1].init?.headers).get("Authorization"), `Bearer ${serviceKey}`);
  assert.equal(requests[1].init?.body, JSON.stringify({ p_workspace_id: workspaceA, p_limit: 500 }));
  assert.match(requests[2].url, /\/rpc\/cleanup_sourcing_learning_authority$/);
  assert.match(requests[3].url, /\/rpc\/cleanup_agent_framework_authority$/);
  assert.equal(requests[0].init?.redirect, "error");
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
});

test("standalone cleanup client rejects an oversized JSON response before materializing it", async () => {
  const client = createSupabaseServiceClient(
    "https://supabase.example",
    "service-key-that-is-long-enough-for-the-runtime",
    async () => new Response(
      JSON.stringify({ padding: "x".repeat(70_000) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  const result = await client
    .from("workspaces")
    .select("id")
    .order("id", { ascending: true })
    .range(0, 9);

  assert.deepEqual(result, { data: null, error: { code: "response_too_large" } });
});

test("service-role cleanup requests never follow redirects to another origin", async () => {
  let redirectedApiKey: string | undefined;
  const target = createServer((request, response) => {
    redirectedApiKey = request.headers.apikey as string | undefined;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("[]");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetAddress = target.address();
  assert.ok(targetAddress && typeof targetAddress === "object");
  const redirector = createServer((_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/capture` });
    response.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  const redirectAddress = redirector.address();
  assert.ok(redirectAddress && typeof redirectAddress === "object");

  try {
    const client = createSupabaseServiceClient(
      `http://127.0.0.1:${redirectAddress.port}`,
      "service-key-that-must-never-reach-the-redirect-target",
    );
    const result = await client.from("workspaces").select("id").order("id", { ascending: true }).range(0, 9);
    assert.equal(result.error?.code, "transport_unavailable");
    assert.equal(redirectedApiKey, undefined);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => redirector.close((error) => error ? reject(error) : resolve())),
    ]);
  }
});

test("release acceptance binds one started cleanup process to a healthy cleanup event", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const releaseSha = "b".repeat(40);
  const notBefore = "2026-07-13T00:00:00.000Z";
  const machines = JSON.stringify([
    {
      id: "web-machine",
      state: "started",
      config: { image: `registry.fly.io/aria-mantu-app@${digest}`, metadata: { fly_process_group: "web" } },
    },
    {
      id: "cleanup-machine",
      state: "started",
      config: { image: `registry.fly.io/aria-mantu-app@${digest}`, metadata: { fly_process_group: "cleanup" } },
    },
    {
      id: "cleanup-standby",
      state: "stopped",
      image_ref: `registry.fly.io/aria-mantu-app@${digest}`,
      config: { metadata: { fly_process_group: "cleanup" }, standbys: ["cleanup-machine"] },
    },
    {
      id: "heartbeat-machine",
      state: "started",
      config: { image: `registry.fly.io/aria-mantu-app@${digest}`, metadata: { fly_process_group: "framework_heartbeat" } },
    },
    {
      id: "heartbeat-standby",
      state: "stopped",
      image_ref: `registry.fly.io/aria-mantu-app@${digest}`,
      config: { metadata: { fly_process_group: "framework_heartbeat" }, standbys: ["heartbeat-machine"] },
    },
  ]);
  assert.deepEqual(verifyReleaseProcessGroups(machines, digest), {
    cleanupMachineId: "cleanup-machine",
    frameworkHeartbeatMachineId: "heartbeat-machine",
  });
  assert.equal(verifyCleanupProcessGroups(machines, digest), "cleanup-machine");
  assert.equal(
    verifyHealthyCleanupEvent(
      JSON.stringify({
        timestamp: "2026-07-13T00:00:00Z",
        message: JSON.stringify({
          event: "apollo_authority_cleanup",
          status: "ok",
          releaseSha,
          startedAt: "2026-07-13T00:00:01.000Z",
          workspacesProcessed: 1,
          processed: 0,
          expired_receipts_cleared: 0,
          confirmations_deleted: 0,
          targets_deleted: 0,
          expired_targets_scrubbed: 0,
          quota_rows_deleted: 0,
          sourcing_lessons_retired: 0,
          sourcing_lessons_deleted: 0,
          sourcing_artifacts_deleted: 0,
          sourcing_runs_deleted: 0,
          sourcing_quota_rows_deleted: 0,
          framework_authorizations_deleted: 0,
        }),
      }),
      releaseSha,
      notBefore,
    ),
    true,
  );
  assert.equal(
    verifyHealthyCleanupEvent(
      JSON.stringify({
        event: "apollo_authority_cleanup",
        status: "ok",
        releaseSha,
        startedAt: "2026-07-13T00:00:01.000Z",
        workspacesProcessed: 1,
        processed: 0,
        expired_receipts_cleared: 0,
        confirmations_deleted: 0,
        targets_deleted: 0,
        expired_targets_scrubbed: 0,
        quota_rows_deleted: 0,
      }),
      releaseSha,
      notBefore,
    ),
    false,
    "release acceptance rejects a legacy cleanup event that did not prove sourcing and framework retention",
  );
  assert.equal(
    verifyHealthyFrameworkHeartbeatEvent(
      JSON.stringify({
        timestamp: "2026-07-13T00:00:02.000Z",
        message: JSON.stringify({
          event: "agent_framework_heartbeat",
          status: "ok",
          releaseSha,
          targets: 2,
          ready: 2,
          recorded: 2,
          failureCodes: [],
          durationMs: 5,
        }),
      }),
      releaseSha,
      notBefore,
    ),
    true,
  );
  assert.throws(
    () => verifyCleanupProcessGroups(
      machines.replace('"id":"cleanup-machine","state":"started"', '"id":"cleanup-machine","state":"stopped"'),
      digest,
    ),
    /one active cleanup/,
  );
  assert.equal(
    verifyHealthyCleanupEvent(
      JSON.stringify({
        event: "apollo_authority_cleanup",
        status: "ok",
        releaseSha,
        startedAt: "2025-01-01T00:00:00.000Z",
        workspacesProcessed: 1,
        processed: 0,
        expired_receipts_cleared: 0,
        confirmations_deleted: 0,
        targets_deleted: 0,
        expired_targets_scrubbed: 0,
        quota_rows_deleted: 0,
      }),
      releaseSha,
      notBefore,
    ),
    false,
  );
  assert.equal(
    verifyHealthyFrameworkHeartbeatEvent(
      JSON.stringify({
        event: "agent_framework_heartbeat",
        status: "ok",
        releaseSha,
        targets: 2,
        ready: 2,
        recorded: 2,
        failureCodes: [],
        durationMs: 5,
      }),
      releaseSha,
      notBefore,
    ),
    false,
  );
  const withoutHeartbeatStandby = JSON.stringify(
    JSON.parse(machines).filter((machine: { id: string }) => machine.id !== "heartbeat-standby"),
  );
  assert.throws(
    () => verifyReleaseProcessGroups(withoutHeartbeatStandby, digest),
    /framework_heartbeat process group must have one paired standby machine/,
  );
  const heartbeatDigestMismatch = JSON.parse(machines);
  heartbeatDigestMismatch.find((machine: { id: string }) => machine.id === "heartbeat-machine").config.image += "0";
  assert.throws(
    () => verifyReleaseProcessGroups(JSON.stringify(heartbeatDigestMismatch), digest),
    /framework_heartbeat process image digest mismatch/,
  );
});
