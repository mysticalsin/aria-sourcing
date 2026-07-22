import assert from "node:assert/strict";
import test, { after, mock } from "node:test";

import { NextRequest } from "next/server";

import { createProcessEnvScope } from "./helpers/process-env.mts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const SECRET = "s".repeat(40);
const CRON_SECRET = "c".repeat(40);
const PARSE_SECRET = "p".repeat(40);
const BODY = {
  jobId: "70000000-0000-4000-8000-000000000001",
  leaseId: "80000000-0000-4000-8000-000000000001",
  workspaceId: "51111111-1111-4111-8111-111111111111",
  campaignId: "90000000-0000-4000-8000-000000000001",
  claimToken: "a0000000-0000-4000-8000-000000000001",
  fenceVersion: 1,
};

const serviceClient = { rpc: async () => ({ data: null, error: null }) };
let serviceAvailable = true;
let handledInputs: unknown[] = [];
let handledClients: unknown[] = [];
let dependencyKeys: string[][] = [];
let outcome: Record<string, unknown> = {
  outcome: "completed",
  candidateCount: 1,
  queryCount: 1,
};

mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => (serviceAvailable ? serviceClient : null),
  },
});

mock.module(moduleUrl("src/lib/sourcing/autonomous-web-runtime.ts"), {
  namedExports: {
    handleAutonomousWebSourcingJob: async (
      input: unknown,
      client: unknown,
      dependencies: Record<string, unknown>,
    ) => {
      handledInputs.push(input);
      handledClients.push(client);
      dependencyKeys.push(Object.keys(dependencies).sort());
      return outcome;
    },
    resolveAutonomousWebTavilyCredential: async () => null,
  },
});

mock.module(moduleUrl("scripts/sourcing-loop-handlers/tavily-discovery.mjs"), {
  namedExports: { executeAuthorizedTavilySearch: async () => ({ ok: false }) },
});

const environment = createProcessEnvScope([
  "ARIA_SOURCING_EXECUTION_SECRET",
  "ARIA_REQUISITION_PARSE_SECRET",
  "CRON_SECRET",
]);

after(() => environment.restore());

const route = await import("../src/app/api/internal/sourcing-execute/route");

function reset() {
  environment.set({
    ARIA_SOURCING_EXECUTION_SECRET: SECRET,
    ARIA_REQUISITION_PARSE_SECRET: PARSE_SECRET,
    CRON_SECRET,
  });
  serviceAvailable = true;
  handledInputs = [];
  handledClients = [];
  dependencyKeys = [];
  outcome = { outcome: "completed", candidateCount: 1, queryCount: 1 };
}

function request(
  body: unknown = BODY,
  authorization: string | null = `Bearer ${SECRET}`,
  contentType = "application/json",
) {
  const headers = new Headers({ "content-type": contentType });
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/internal/sourcing-execute", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("the autonomous sourcing route accepts only its distinct purpose-bound bearer", async () => {
  reset();
  assert.equal((await route.POST(request(BODY, null))).status, 401);
  assert.equal((await route.POST(request(BODY, `Bearer ${CRON_SECRET}`))).status, 401);
  assert.equal((await route.POST(request(BODY, `Bearer ${PARSE_SECRET}`))).status, 401);

  environment.set({ ARIA_SOURCING_EXECUTION_SECRET: CRON_SECRET });
  assert.equal((await route.POST(request(BODY, `Bearer ${CRON_SECRET}`))).status, 401);

  reset();
  environment.set({ ARIA_SOURCING_EXECUTION_SECRET: PARSE_SECRET });
  assert.equal((await route.POST(request(BODY, `Bearer ${PARSE_SECRET}`))).status, 401);

  reset();
  environment.set({ ARIA_SOURCING_EXECUTION_SECRET: "too-short" });
  assert.equal((await route.POST(request(BODY, "Bearer too-short"))).status, 401);
  assert.equal(handledInputs.length, 0);
});

test("the endpoint accepts only the exact database-minted locator", async () => {
  reset();
  for (const body of [
    { ...BODY, actorId: "60000000-0000-4000-8000-000000000001" },
    { ...BODY, provider: "tavily" },
    { ...BODY, query: "caller supplied" },
    { ...BODY, apiKey: "caller-secret" },
    { ...BODY, workspaceId: "not-a-uuid" },
    { ...BODY, claimToken: "not-a-uuid" },
    { ...BODY, fenceVersion: 0 },
  ]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 400);
  }
  assert.equal(handledInputs.length, 0);
});

test("the endpoint rejects non-JSON content before reading a locator", async () => {
  reset();
  const response = await route.POST(request(BODY, `Bearer ${SECRET}`, "text/plain"));
  assert.equal(response.status, 415);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(handledInputs.length, 0);
});

test("a valid locator wires only the service authority, credential resolver, and fixed Tavily adapter", async () => {
  reset();
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    ok: true,
    outcome: { outcome: "completed", candidateCount: 1, queryCount: 1 },
  });
  assert.deepEqual(handledInputs, [BODY]);
  assert.deepEqual(handledClients, [serviceClient]);
  assert.deepEqual(dependencyKeys, [["executeSearch", "fetcher", "resolveCredential"]]);
});

test("the route reports service outage, stale lease, and ambiguous outcomes truthfully", async () => {
  reset();
  serviceAvailable = false;
  const unavailable = await route.POST(request());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ok: true,
    outcome: { outcome: "unavailable", reason: "service_client_unavailable" },
  });

  reset();
  outcome = { outcome: "stale_lease" };
  const stale = await route.POST(request());
  assert.equal(stale.status, 409);

  reset();
  outcome = { outcome: "ambiguous_dead_lettered", reason: "search_transport_unknown" };
  const ambiguous = await route.POST(request());
  assert.equal(ambiguous.status, 200);
  assert.deepEqual(await ambiguous.json(), { ok: true, outcome });
});
