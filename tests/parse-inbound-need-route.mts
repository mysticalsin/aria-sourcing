import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { NextRequest } from "next/server";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const CRON_SECRET = "cron-secret-material-with-enough-length-0001";

process.env.CRON_SECRET = CRON_SECRET;

test("parse-inbound-need auth, live success, and llm_required fail-closed", async () => {
  let modelUsed = true;
  mock.module(moduleUrl("src/lib/requisition-intake.ts"), {
    namedExports: {
      buildInboundEmailText: ({ body }: { body: string }) => body,
      parseInboundNeed: () => ({
        ready: true,
        confidence: 0.9,
        warnings: [],
        jobAnalysis: { title: "Engineer", requiredSkills: ["TypeScript"] },
        sender: { name: "Pat", email: "pat@example.com" },
        parsed: {},
        modelUsed: false,
      }),
      deterministicCampaignId: () => "camp-req-deadbeef",
      buildCampaignFromNeed: () => ({ id: "camp-req-deadbeef", title: "Engineer", status: "Sourcing" }),
    },
  });
  mock.module(moduleUrl("src/lib/requisition-intake-live.ts"), {
    namedExports: {
      parseInboundNeedLive: async () => ({
        ready: true,
        confidence: 0.9,
        warnings: modelUsed ? [] : ["heuristic_only"],
        jobAnalysis: { title: "Engineer", requiredSkills: ["TypeScript"] },
        sender: { name: "Pat", email: "pat@example.com" },
        parsed: {},
        modelUsed,
        modelReason: modelUsed ? undefined : "no_provider",
      }),
    },
  });

  const { POST } = await import("../src/app/api/cron/parse-inbound-need/route.ts");

  const unauth = await POST(
    new NextRequest("http://localhost/api/cron/parse-inbound-need", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(unauth.status, 401);

  const withOrigin = await POST(
    new NextRequest("http://localhost/api/cron/parse-inbound-need", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(withOrigin.status, 401);

  modelUsed = true;
  const ok = await POST(
    new NextRequest("http://localhost/api/cron/parse-inbound-need", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        body: "Role: Senior TypeScript Engineer\nLocation: London\nSkills: TypeScript",
        requisitionId: "81111111-1111-4111-8111-111111111111",
      }),
    }),
  );
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { ok?: boolean; ready?: boolean; campaign?: { id?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.campaign?.id, "camp-req-deadbeef");

  modelUsed = false;
  const refused = await POST(
    new NextRequest("http://localhost/api/cron/parse-inbound-need", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "Role: Engineer\nSkills: TypeScript" }),
    }),
  );
  assert.equal(refused.status, 503);
  const refusedBody = (await refused.json()) as { ok?: boolean; status?: string; modelUsed?: boolean };
  assert.equal(refusedBody.ok, false);
  assert.equal(refusedBody.status, "llm_required");
  assert.equal(refusedBody.modelUsed, false);
});
