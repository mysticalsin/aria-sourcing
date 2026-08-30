import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

let adminAllowed = true;
let probeCalls = 0;

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => null },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "admin-user-1" } }, error: null }),
      },
    }),
    requireAdmin: async () =>
      adminAllowed
        ? { ok: true, role: "admin" }
        : { ok: false, response: NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 }) },
  },
});
mock.module(moduleUrl("src/lib/ai/llm-env-status.ts"), {
  namedExports: {
    probeLlmEnvStatus: async (opts?: { force?: boolean }) => {
      probeCalls += 1;
      return {
        status: "llm_auth_dead",
        keysPresent: true,
        firstLiveProvider: null,
        providers: [
          { slug: "kimi", env: "KIMI_API_KEY", state: "auth_dead", httpStatus: 401 },
          { slug: "anthropic", env: "ANTHROPIC_API_KEY", state: "absent", httpStatus: null },
          { slug: "openai", env: "OPENAI_API_KEY", state: "absent", httpStatus: null },
          { slug: "deepseek", env: "DEEPSEEK_API_KEY", state: "absent", httpStatus: null },
        ],
        probedAt: "2026-08-29T01:00:00.000Z",
        cached: opts?.force ? false : false,
      };
    },
    clearLlmEnvStatusCache: () => {},
    LLM_ENV_STATUS_SLUGS: ["kimi", "anthropic", "openai", "deepseek"],
  },
});

const route = await import("../src/app/api/admin/llm-env-status/route");
const get = route.GET;

function request(path = "http://localhost/api/admin/llm-env-status") {
  return new NextRequest(path, {
    method: "GET",
    headers: {
      "x-request-id": crypto.randomUUID(),
      "x-real-ip": crypto.randomUUID(),
    },
  });
}

test("llm-env-status rejects non-admin", async () => {
  adminAllowed = false;
  probeCalls = 0;
  const res = await get(request());
  assert.equal(res.status, 403);
  assert.equal(probeCalls, 0);
  adminAllowed = true;
});

test("llm-env-status returns auth_dead honesty payload for admin", async () => {
  adminAllowed = true;
  probeCalls = 0;
  const res = await get(request());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "llm_auth_dead");
  assert.equal(body.keysPresent, true);
  assert.match(body.note, /auth-dead/);
  assert.equal(probeCalls, 1);
  assert.equal(body.providers[0].state, "auth_dead");
  assert.ok(!JSON.stringify(body).includes("sk-"), "must not leak secrets");
});

test("llm-env-status force=1 still admin-gated", async () => {
  adminAllowed = true;
  const res = await get(request("http://localhost/api/admin/llm-env-status?force=1"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "llm_auth_dead");
});
