import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextResponse } from "next/server";
import { defaultSettings } from "../src/lib/seed";

const url = (path: string) => new URL(`../${path}`, import.meta.url).href;
let role = "admin";
let calls = 0;
let healthy = true;
let failedQuery = false;
const session = {
  rpc: async () => ({ data: "workspace-1", error: null }),
  from: (table: string) => {
    calls++;
    const result = { data: table === "workspace_state" ? { state: { settings: defaultSettings() } } : [], error: failedQuery ? new Error("internal secret detail") : null };
    const query = { select: () => query, eq: () => query, limit: () => query, abortSignal: () => query, maybeSingle: () => Promise.resolve(result), then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  },
};
mock.module(url("src/lib/supabase/config.ts"), { namedExports: { supabaseEnabled: true, prodFailClosed: () => null } });
mock.module(url("src/lib/supabase/server.ts"), { namedExports: {
  getServerSupabase: async () => session,
  requireAdmin: async () => role === "admin" ? { ok: true } : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: role === "anonymous" ? 401 : 403 }) },
} });
mock.module(url("src/lib/crypto-secrets.ts"), { namedExports: { secretEncryptionEnabled: () => true } });
mock.module(url("src/lib/server/readiness.ts"), { namedExports: { readCurrentReadiness: async () => ({ ok: healthy }) } });
const { GET } = await import("../src/app/api/setup/status/route");
const request = () => new Request("http://localhost/api/setup/status", { headers: { "x-real-ip": crypto.randomUUID() } });

test("setup checks refuse unauthenticated callers and non-admins before workspace queries", async () => {
  for (const denied of ["anonymous", "member"]) {
    role = denied; calls = 0;
    assert.equal((await GET(request())).status, denied === "anonymous" ? 401 : 403);
    assert.equal(calls, 0);
  }
});

test("missing paid providers do not block a ready core workspace or pretend to be verified", async () => {
  role = "admin"; healthy = true;
  const response = await GET(request());
  const body = await response.json();
  assert.equal(body.ready, true);
  assert.equal(body.checks.find((check: { id: string }) => check.id === "linkedin").status, "missing");
  assert.equal(body.checks.find((check: { id: string }) => check.id === "ai").status, "missing");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(body), /workspace-1|public-test-key|secret detail/);
});

test("failed backend and configuration reads surface honest blocked states without raw errors", async () => {
  healthy = false;
  assert.equal((await (await GET(request())).json()).ready, false);
  failedQuery = true;
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret detail/);
});
