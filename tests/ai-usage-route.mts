import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const url = (path: string) => new URL(`../${path}`, import.meta.url).href;
let role = "admin";
process.env.AI_USAGE_PERSIST = "off";
mock.module(url("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, demoLoginEnabled: false, DEMO_COOKIE_NAME: "demo", prodFailClosed: () => null },
});
mock.module(url("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => ({}),
    requireAdmin: async () =>
      role === "admin"
        ? { ok: true }
        : { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: role === "anonymous" ? 401 : 403 }) },
  },
});
const { recordAiUsage, resetAiUsageForTests } = await import("../src/lib/ai/usage");
const { GET } = await import("../src/app/api/ai/usage/route");
const request = () => new NextRequest("http://localhost/api/ai/usage", { headers: { "x-real-ip": crypto.randomUUID() } });

test("AI usage is refused to anonymous callers and non-admins", async () => {
  for (const denied of ["anonymous", "member"]) {
    role = denied;
    assert.equal((await GET(request())).status, denied === "anonymous" ? 401 : 403);
  }
});

test("admins get month-to-date aggregates without any prompt content", async () => {
  role = "admin";
  resetAiUsageForTests();
  const quiet = console.info;
  console.info = () => {};
  try {
    recordAiUsage({ task: "classify", model: "claude-haiku-5-5", usage: { input_tokens: 2000, output_tokens: 300 } });
  } finally {
    console.info = quiet;
  }
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as Record<string, unknown> & { byTask: Record<string, unknown>[] };
  assert.equal(body.calls, 1);
  assert.equal(body.byTask[0]?.task, "classify");
  assert.equal(typeof body.monthlyLimitUsd, "number");
  assert.deepEqual(
    Object.keys(body.byTask[0] ?? {}).sort(),
    ["cacheReadTokens", "calls", "costUsd", "inputTokens", "model", "outputTokens", "task"],
  );
  resetAiUsageForTests();
});
