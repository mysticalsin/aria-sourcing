import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

test("intake route: demo heuristic vs production llm_required fail-closed", async () => {
  let supabaseEnabledFlag = false;
  let modelUsed = true;

  mock.module(moduleUrl("src/lib/supabase/config.ts"), {
    namedExports: {
      get supabaseEnabled() {
        return supabaseEnabledFlag;
      },
      prodFailClosed: () => null,
    },
  });
  mock.module(moduleUrl("src/lib/supabase/server.ts"), {
    namedExports: {
      getServerSupabase: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1", email: "op@example.com" } } }) },
      }),
    },
  });
  mock.module(moduleUrl("src/lib/rate-limit.ts"), {
    namedExports: {
      checkRateLimit: () => ({ ok: true, retryAfterSec: 0 }),
      rateLimitKey: () => "intake",
      tooManyRequests: () => new Response(null, { status: 429 }),
    },
  });
  mock.module(moduleUrl("src/lib/requisition-intake-live.ts"), {
    namedExports: {
      parseInboundNeedLive: async () => ({
        parsed: {
          sender: { name: "Pat", email: "pat@example.com" },
          jobAnalysis: { title: "Engineer", requiredSkills: ["TypeScript"] },
        },
        modelUsed,
        modelProvider: modelUsed ? "openai" : undefined,
        modelReason: modelUsed ? undefined : "no_provider",
      }),
    },
  });
  mock.module(moduleUrl("src/lib/mock-ai.ts"), {
    namedExports: {
      parseEmailAndJD: () => ({
        sender: { name: "Demo", email: "demo@example.com" },
        jobAnalysis: { title: "Heuristic Engineer", requiredSkills: ["TypeScript"] },
      }),
      isMantuNeedEmail: () => false,
    },
  });

  const { POST } = await import("../src/app/api/intake/route.ts");

  supabaseEnabledFlag = false;
  const demo = await POST(
    new NextRequest("http://localhost/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(demo.status, 200);
  const demoBody = (await demo.json()) as { ok?: boolean; parsed?: { jobAnalysis?: { title?: string } } };
  assert.equal(demoBody.ok, true);
  assert.equal(demoBody.parsed?.jobAnalysis?.title, "Heuristic Engineer");

  supabaseEnabledFlag = true;
  modelUsed = false;
  const refused = await POST(
    new NextRequest("http://localhost/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(refused.status, 503);
  const refusedBody = (await refused.json()) as { ok?: boolean; status?: string; modelUsed?: boolean };
  assert.equal(refusedBody.ok, false);
  assert.equal(refusedBody.status, "llm_required");
  assert.equal(refusedBody.modelUsed, false);

  modelUsed = true;
  const live = await POST(
    new NextRequest("http://localhost/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(live.status, 200);
  const liveBody = (await live.json()) as {
    ok?: boolean;
    modelUsed?: boolean;
    parsed?: { jobAnalysis?: { title?: string } };
  };
  assert.equal(liveBody.ok, true);
  assert.equal(liveBody.modelUsed, true);
  assert.equal(liveBody.parsed?.jobAnalysis?.title, "Engineer");
});
