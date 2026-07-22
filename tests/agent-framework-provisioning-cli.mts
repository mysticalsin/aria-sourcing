import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  applyAuthorityPlan,
  confirmationFor,
  readBoundedRpcJson,
  rpc,
  RPC_FETCH_POLICY,
  RPC_RESPONSE_MAX_BYTES,
} from "../scripts/provision-agent-framework-authority.mjs";

const path = "scripts/provision-agent-framework-authority.mjs";
const source = readFileSync(path, "utf8");
const invalidEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "test" };

const invalid = spawnSync(process.execPath, [path], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: invalidEnvironment,
});
assert.equal(invalid.status, 1, "operator CLI rejects a missing explicit action");
assert.match(invalid.stderr, /usage: prepare/, "operator CLI reports bounded usage without a stack trace");
assert.doesNotMatch(invalid.stderr, /SUPABASE_SERVICE_ROLE_KEY=/, "operator CLI never renders service credentials");

assert.equal(RPC_FETCH_POLICY.redirect, "error", "service-authority requests reject redirects");
await assert.rejects(
  readBoundedRpcJson(new Response("{}", { headers: { "content-type": "text/plain" } })),
  /content type is invalid/,
  "operator rejects non-JSON RPC responses",
);
await assert.rejects(
  readBoundedRpcJson(new Response("x".repeat(RPC_RESPONSE_MAX_BYTES + 1), {
    headers: { "content-type": "application/json" },
  })),
  /too large/,
  "operator bounds RPC response bytes before parsing",
);
await assert.rejects(
  readBoundedRpcJson(new Response("{}", {
    headers: {
      "content-type": "application/json",
      "content-length": "2e0",
    },
  })),
  /too large/,
  "operator rejects a non-decimal content length instead of trusting it",
);
assert.deepEqual(
  await readBoundedRpcJson(new Response('{"status":"ok"}', {
    headers: { "content-type": "application/json; charset=utf-8" },
  })),
  { status: "ok" },
  "operator accepts a bounded JSON receipt",
);

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://authority.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role-key-for-transport-test";
let transportAborted = false;
try {
  await assert.rejects(
    rpc("inspect_agent_framework_control_authority", {}, {
      timeoutMs: 20,
      fetchImpl: async (_input: unknown, init: RequestInit | undefined) => new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"status":'));
            init?.signal?.addEventListener("abort", () => {
              transportAborted = true;
              controller.error(new Error("synthetic stalled body"));
            }, { once: true });
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    }),
    /response read failed/,
    "operator timeout remains armed until the bounded response body is complete",
  );
} finally {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
}
assert.equal(transportAborted, true, "operator aborts a stalled response body");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const identity = Object.freeze({
  configurationSha256: "a".repeat(64),
  deerflowInstanceId: "33333333-3333-4333-8333-333333333333",
  deerflowSourceCommit: "3c0a45ad772cdba388009b8d5ecad5e48cd22429",
  deerflowImageDigest: `registry.internal/deerflow@sha256:${"b".repeat(64)}`,
  flowiseInstanceId: "44444444-4444-4444-8444-444444444444",
  flowiseSourceCommit: "ed9e100fb71643cd3922b005908f9732bc0e07dc",
  flowiseImageDigest: `registry.internal/flowise@sha256:${"c".repeat(64)}`,
  flowiseIsolationMode: "instance-per-workspace",
});
const createdAt = new Date();
const replayPlanMaterial = {
  schema: "aria.agent-framework.authority-plan.v2",
  action: "configure",
  authorityOrigin: "https://authority.test",
  workspaceId,
  actorId,
  changeId: "55555555-5555-4555-8555-555555555555",
  expectedControlVersion: "1",
  identity,
  createdAt: createdAt.toISOString(),
  expiresAt: new Date(createdAt.valueOf() + 15 * 60_000).toISOString(),
};
const replayPlan = {
  ...replayPlanMaterial,
  confirmationSha256: confirmationFor(replayPlanMaterial),
};
let replayRpcCalls = 0;
const replayReceipt = await applyAuthorityPlan(
  replayPlan,
  replayPlan.confirmationSha256,
  {
    resolveAuthorityOrigin: () => "https://authority.test",
    inspectControl: async () => ({
      status: "ok",
      workspace_id: workspaceId,
      control_version: "2",
      execution_enabled: false,
      kill_switch: true,
    }),
    resolveWorkspaceId: () => {
      throw new Error("post-commit replay must not depend on mutable workspace configuration");
    },
    resolveIdentity: () => {
      throw new Error("post-commit replay must not depend on mutable framework configuration");
    },
    invokeRpc: async () => {
      replayRpcCalls += 1;
      return { status: "replay", operation: "configure", control_version: 2 };
    },
    writeReceipt: () => undefined,
  },
);
assert.equal(replayReceipt.status, "replay", "a lost successful response can be recovered with the exact plan");
assert.equal(replayRpcCalls, 1, "post-commit version drift reaches the receipt-first database RPC");

let crossOriginRpcCalls = 0;
await assert.rejects(
  applyAuthorityPlan(
    replayPlan,
    replayPlan.confirmationSha256,
    {
      resolveAuthorityOrigin: () => "https://different-authority.test",
      inspectControl: async () => ({ status: "ok", workspace_id: workspaceId, control_version: "1" }),
      resolveWorkspaceId: () => workspaceId,
      resolveIdentity: () => identity,
      invokeRpc: async () => {
        crossOriginRpcCalls += 1;
        return { status: "configured" };
      },
      writeReceipt: () => undefined,
    },
  ),
  /authority origin differs from the reviewed plan/,
  "a reviewed plan cannot be replayed against another Supabase authority",
);
assert.equal(crossOriginRpcCalls, 0, "cross-origin plans fail before carrying service authority");

assert.match(source, /deriveAgentFrameworkConfigurationFromEnvironment/, "CLI derives the canonical framework identity");
assert.match(source, /randomUUID\(\)/, "CLI generates an opaque change UUID");
assert.match(source, /confirmationSha256/, "CLI binds an explicit confirmation to the reviewed plan");
assert.match(source, /authorityOrigin/, "CLI binds the reviewed plan to one exact Supabase authority origin");
assert.match(source, /redirect: "error"/, "CLI refuses redirects while carrying service authority");
assert.match(source, /mutationCanStillCommit/, "CLI keeps strict environment preflight on requests that can still mutate authority");
assert.match(source, /deerflow_fresh !== true \|\| control\.flowise_fresh !== true/, "activation requires both fresh heartbeat receipts");
assert.match(source, /configure_agent_framework_authority/, "CLI invokes the configure authority RPC");
assert.match(source, /activate_agent_framework_authority/, "CLI invokes the separately confirmed activation RPC");
assert.match(source, /engage_agent_framework_kill_switch/, "CLI exposes the receipt-backed fail-safe kill RPC");

console.log("RESULT agent-framework-provisioning-cli: passed");
