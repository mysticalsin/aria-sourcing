import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const targetId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const campaignId = "campaign-1";

let role = "member";
let user: { id: string } | null = { id: userId };
let dependencyError = false;
let selectionResult = true;
let selectionCalls = 0;
let lastContext: unknown = null;
let lastBindings: unknown = null;

const session = {
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : name === "current_workspace_id" ? workspaceId : null,
    error: null,
  }),
};

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      if (dependencyError) throw new Error("simulated auth dependency exception");
      return session;
    },
  },
});
mock.module(moduleUrl("src/lib/sourcing/source-authority.ts"), {
  namedExports: {
    selectApolloEnrichmentTargets: async (context: unknown, bindings: unknown) => {
      selectionCalls += 1;
      lastContext = context;
      lastBindings = bindings;
      return selectionResult;
    },
  },
});

const route = await import("../src/app/api/source/apollo/select/route");
const post = ((route as any).POST ?? (route as any).default?.POST) as (
  request: NextRequest,
) => Promise<Response>;

function request(
  body: unknown,
  origin = "http://localhost",
  contentType = "application/json",
) {
  return new NextRequest("http://localhost/api/source/apollo/select", {
    method: "POST",
    headers: {
      "content-type": contentType,
      origin,
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function payload() {
  return { campaignId, candidates: [{ targetId, candidateId }] };
}

function reset() {
  role = "member";
  user = { id: userId };
  dependencyError = false;
  selectionResult = true;
  selectionCalls = 0;
  lastContext = null;
  lastBindings = null;
}

test("selection binds exact server-issued candidate authority", async () => {
  reset();
  const response = await post(request(payload()));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.selected, payload().candidates);
  assert.deepEqual(lastContext, { workspaceId, userId, campaignId });
  assert.deepEqual(lastBindings, payload().candidates);
  assert.equal(selectionCalls, 1);
});

test("selection rejects cross-origin, malformed media, anonymous, and viewer requests", async () => {
  reset();
  assert.equal((await post(request(payload(), "https://attacker.test"))).status, 403);
  assert.equal((await post(request(payload(), "http://localhost", "application/jsonp"))).status, 415);
  user = null;
  assert.equal((await post(request(payload()))).status, 401);
  user = { id: userId };
  role = "viewer";
  assert.equal((await post(request(payload()))).status, 403);
  assert.equal(selectionCalls, 0);
});

test("selection dependency failures preserve typed non-cacheable responses", async () => {
  reset();
  dependencyError = true;
  const dependency = await post(request(payload()));
  assert.equal(dependency.status, 503);
  assert.equal((await dependency.json()).code, "APOLLO_AUTHORITY_UNAVAILABLE");
  assert.equal(dependency.headers.get("cache-control"), "no-store");

  reset();
  selectionResult = false;
  const rejected = await post(request(payload()));
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).code, "APOLLO_AUTHORITY_UNAVAILABLE");
});
