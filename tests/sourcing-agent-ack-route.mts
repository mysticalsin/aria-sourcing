import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const frameworkRunId = "33333333-3333-4333-8333-333333333333";
const capabilityToken = "s".repeat(43);
const resultSha256 = "d".repeat(64);
const sourcingRunId = "44444444-4444-4444-8444-444444444444";

let user: { id: string } | null = { id: userId };
let role: "admin" | "member" | "viewer" = "member";
let currentWorkspaceId: string | null = workspaceId;
let authorityResult = true;
let authorityThrows = false;
let authorityCalls = 0;
let authorityInput: Record<string, unknown> | null = null;
let sequence = 0;

const session = {
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : currentWorkspaceId,
    error: null,
  }),
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    prodFailClosed: () => null,
    supabaseEnabled: true,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: { getServerSupabase: async () => session },
});
mock.module(moduleUrl("src/lib/sourcing/learning-authority.ts"), {
  namedExports: {
    ackAgentFrameworkSourcingEffect: async (input: Record<string, unknown>) => {
      authorityCalls += 1;
      authorityInput = input;
      if (authorityThrows) throw new Error("database detail must not escape");
      return authorityResult;
    },
    ackSourcingRunResult: async (input: Record<string, unknown>) => {
      authorityCalls += 1;
      authorityInput = input;
      if (authorityThrows) throw new Error("database detail must not escape");
      return authorityResult;
    },
  },
});

const route = await import("../src/app/api/sourcing-agent/ack/route");

function reset() {
  user = { id: userId };
  role = "member";
  currentWorkspaceId = workspaceId;
  authorityResult = true;
  authorityThrows = false;
  authorityCalls = 0;
  authorityInput = null;
}

function request(
  body: unknown = { frameworkRunId, capabilityToken, resultSha256 },
  options: { origin?: string; contentType?: string } = {},
) {
  sequence += 1;
  return new NextRequest("http://localhost/api/sourcing-agent/ack", {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      origin: options.origin ?? "http://localhost",
      "x-request-id": `framework-ack-${sequence}`,
      "x-real-ip": `198.51.100.${sequence}`,
    },
    body: JSON.stringify(body),
  });
}

test("persisted framework results are acknowledged with exact actor and workspace authority", async () => {
  reset();
  const response = await route.POST(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    status: "completed",
    requestId: `framework-ack-${sequence}`,
  });
  assert.deepEqual(authorityInput, {
    workspaceId,
    actorId: userId,
    frameworkRunId,
    capabilityToken,
    resultSha256,
  });
});

test("persisted ordinary results are acknowledged with exact actor, workspace, run, and hash", async () => {
  reset();
  const response = await route.POST(request({ sourcingRunId, resultSha256 }));
  assert.equal(response.status, 200);
  assert.deepEqual(authorityInput, {
    workspaceId,
    actorId: userId,
    runId: sourcingRunId,
    resultSha256,
  });
});

test("cross-origin, invalid media, and malformed receipts fail before database authority", async () => {
  reset();
  assert.equal((await route.POST(request(undefined, { origin: "https://attacker.test" }))).status, 403);
  assert.equal((await route.POST(request(undefined, { contentType: "text/plain" }))).status, 415);
  assert.equal((await route.POST(request({ frameworkRunId: "bad", capabilityToken, resultSha256 }))).status, 400);
  assert.equal((await route.POST(request({ frameworkRunId, capabilityToken: "bad", resultSha256 }))).status, 400);
  assert.equal(authorityCalls, 0);
});

test("authentication, source permission, and workspace membership are mandatory", async () => {
  reset();
  user = null;
  assert.equal((await route.POST(request())).status, 401);
  assert.equal(authorityCalls, 0);

  reset();
  role = "viewer";
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(authorityCalls, 0);

  reset();
  currentWorkspaceId = null;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(authorityCalls, 0);
});

test("unverified persistence and dependency exceptions map to bounded fail-closed responses", async () => {
  reset();
  authorityResult = false;
  const unverified = await route.POST(request());
  assert.equal(unverified.status, 409);
  assert.equal((await unverified.json()).code, "SOURCING_AGENT_PERSISTENCE_UNVERIFIED");

  reset();
  authorityThrows = true;
  const unavailable = await route.POST(request());
  const body = await unavailable.json();
  assert.equal(unavailable.status, 503);
  assert.equal(body.code, "SOURCING_AGENT_UNAVAILABLE");
  assert.equal(JSON.stringify(body).includes("database detail"), false);
});
