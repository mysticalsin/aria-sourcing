/* ============================================================================
   tests/heyreach-delivery.mts — HeyReach REST adapter (mocked fetch)
   ========================================================================== */

import {
  checkHeyReachApiKey,
  deliverLinkedInViaHeyReach,
  heyReachConfigFromEnv,
  heyReachConfiguredFromEnv,
  heyReachDeliveryReadyFromEnv,
} from "../src/lib/heyreach-delivery";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.HEYREACH_API_KEY;
const originalCampaign = process.env.HEYREACH_CAMPAIGN_ID;
const originalAccount = process.env.HEYREACH_ACCOUNT_ID;

try {
  delete process.env.HEYREACH_API_KEY;
  delete process.env.HEYREACH_CAMPAIGN_ID;
  delete process.env.HEYREACH_ACCOUNT_ID;

  ok("configuredFromEnv false without key", heyReachConfiguredFromEnv() === false);
  ok("deliveryReady false without key+campaign", heyReachDeliveryReadyFromEnv() === false);
  ok("configFromEnv null without key", heyReachConfigFromEnv() === null);

  process.env.HEYREACH_API_KEY = "test-key";
  ok("configuredFromEnv true with key only", heyReachConfiguredFromEnv() === true);
  ok("deliveryReady false without campaign", heyReachDeliveryReadyFromEnv() === false);

  process.env.HEYREACH_CAMPAIGN_ID = "42";
  ok("deliveryReady true with key+campaign", heyReachDeliveryReadyFromEnv() === true);
  const cfg = heyReachConfigFromEnv();
  ok("config exposes campaignId", cfg?.campaignId === "42" && cfg.apiKey === "test-key");

  const missingProfile = await deliverLinkedInViaHeyReach(
    {
      workspaceId: "ws",
      messageId: "m1",
      candidateId: "c1",
      profileUrl: "",
      subject: "Hi",
      body: "Hello",
      attemptId: "a1",
    },
    { apiKey: "k", campaignId: "1" },
  );
  ok(
    "refuses empty profile",
    missingProfile.status === "error" && missingProfile.deliveryState === "not-sent",
  );

  const missingCampaign = await deliverLinkedInViaHeyReach(
    {
      workspaceId: "ws",
      messageId: "m1",
      candidateId: "c1",
      profileUrl: "https://www.linkedin.com/in/jane",
      subject: "Hi",
      body: "Hello",
      attemptId: "a1",
    },
    { apiKey: "k" },
  );
  ok(
    "refuses missing campaign id",
    missingCampaign.status === "error" && /HEYREACH_CAMPAIGN_ID/i.test(missingCampaign.detail),
  );

  let calledPath = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledPath = String(input);
    if (String(input).includes("CheckApiKey")) {
      return new Response("{}", { status: 200 });
    }
    if (String(input).includes("AddLeadsToCampaignV2")) {
      return new Response(JSON.stringify({ addedLeadsCount: 1, id: "hr-1" }), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  ok("checkApiKey true on 200", (await checkHeyReachApiKey("k")) === true);

  const sent = await deliverLinkedInViaHeyReach(
    {
      workspaceId: "ws",
      messageId: "m1",
      candidateId: "c1",
      profileUrl: "https://www.linkedin.com/in/jane",
      subject: "Hi",
      body: "Hello from Aria",
      attemptId: "a1",
    },
    { apiKey: "k", campaignId: "99" },
  );
  ok("V2 success → sent/accepted", sent.status === "sent" && sent.deliveryState === "accepted");
  ok("V2 hits AddLeadsToCampaignV2", /AddLeadsToCampaignV2/.test(calledPath));
  ok("provider is HeyReach", sent.provider === "HeyReach");

  let v2ThenFallback = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("AddLeadsToCampaignV2")) {
      v2ThenFallback++;
      return new Response("fail", { status: 500 });
    }
    if (url.includes("AddLeadsToCampaign")) {
      v2ThenFallback++;
      return new Response("1", { status: 200 });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  const fallback = await deliverLinkedInViaHeyReach(
    {
      workspaceId: "ws",
      messageId: "m1",
      candidateId: "c1",
      profileUrl: "https://www.linkedin.com/in/jane",
      subject: "Hi",
      body: "Hello",
      attemptId: "a2",
    },
    { apiKey: "k", campaignId: "99" },
  );
  ok("falls back to V1 on V2 failure", fallback.status === "sent" && v2ThenFallback === 2);

  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const bothFail = await deliverLinkedInViaHeyReach(
    {
      workspaceId: "ws",
      messageId: "m1",
      candidateId: "c1",
      profileUrl: "https://www.linkedin.com/in/jane",
      subject: "Hi",
      body: "Hello",
      attemptId: "a3",
    },
    { apiKey: "k", campaignId: "99", accountId: "7" },
  );
  ok(
    "both endpoints fail → error",
    bothFail.status === "error" && /503/.test(bothFail.detail),
  );

  process.env.HEYREACH_ACCOUNT_ID = "7";
  const withAccount = heyReachConfigFromEnv();
  ok("configFromEnv includes accountId", withAccount?.accountId === "7");

  ok("checkApiKey false on throw", (await checkHeyReachApiKey("k")) === false);
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.HEYREACH_API_KEY;
  else process.env.HEYREACH_API_KEY = originalKey;
  if (originalCampaign === undefined) delete process.env.HEYREACH_CAMPAIGN_ID;
  else process.env.HEYREACH_CAMPAIGN_ID = originalCampaign;
  if (originalAccount === undefined) delete process.env.HEYREACH_ACCOUNT_ID;
  else process.env.HEYREACH_ACCOUNT_ID = originalAccount;
}

console.log(`RESULT heyreach-delivery: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
