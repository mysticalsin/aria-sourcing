import { mock } from "node:test";
import { NextRequest } from "next/server";
import type { ApifyResult, ApifyProfile, ApifyProfileSearchInput } from "../src/lib/sourcing/apify.ts";
import { buildSeedState } from "../src/lib/seed";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const policyCampaign = buildSeedState().campaigns[0];

/* ---- mutable fixtures the mocked modules read at call time ---------------- */

let prodBlockResponse: Response | null = null;
let currentUser: { id: string; email: string } | null = { id: "user-1", email: "recruiter@example.test" };
let currentRole: "admin" | "member" | "viewer" = "member";
let serviceRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let providerRunAllowed = true;

// Never a real token — a synthetic placeholder matching the provider's shape only.
let storedApifyKey: string | null = "apify_api_TEST_PLACEHOLDER_0000000000";
let resolveKeyCalls = 0;

let startResult: ApifyResult<{ runId: string; datasetId: string; status: string }> = {
  ok: true,
  status: 201,
  data: { runId: "run_test_1", datasetId: "dataset_test_1", status: "READY" },
};
let startCalls = 0;
let lastStartInput: ApifyProfileSearchInput | null = null;

let statusResult: ApifyResult<{ status: string }> = { ok: true, status: 200, data: { status: "SUCCEEDED" } };
let statusCalls = 0;

const sampleProfile: ApifyProfile = {
  id: "urn:li:fsd_profile:sample",
  publicIdentifier: "jane-doe-sample",
  linkedinUrl: "https://www.linkedin.com/in/jane-doe-sample",
  firstName: "Jane",
  lastName: "Doe",
  headline: "Senior Engineer",
  about: "",
  location: { text: "Paris, France", countryCode: "FR" },
  connectionsCount: 500,
  followerCount: 500,
  currentPosition: [{ title: "Senior Engineer", companyName: "Example Corp", dateRange: "2022 - Present" }],
  experience: [],
  education: [],
  topSkills: ["TypeScript"],
  skills: ["TypeScript"],
  languages: ["English"],
  openToWork: false,
  hiring: false,
  premium: false,
  email: null,
  phone: null,
};

let itemsResult: ApifyResult<ApifyProfile[]> = { ok: true, status: 200, data: [sampleProfile] };
let itemsCalls = 0;

function makeFakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) },
    rpc: async (fn: string) => {
      if (fn === "current_profile_role") return { data: currentRole, error: null };
      if (fn === "current_workspace_id") return { data: "workspace-1", error: null };
      return { data: null, error: null };
    },
  };
}

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: true,
    prodFailClosed: () => prodBlockResponse,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => makeFakeSupabase(),
    getServiceSupabase: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        serviceRpcCalls.push({ name, args });
        if (name === "begin_provider_run") {
          return providerRunAllowed
            ? { data: { ok: true, run_id: "81111111-1111-4111-8111-111111111111" }, error: null }
            : { data: { ok: false, reason: "sourcing_run_quota_exceeded" }, error: null };
        }
        if (name === "attach_provider_run") return { data: { ok: true }, error: null };
        if (name === "enqueue_aria_job") return { data: { status: "enqueued", id: "job-1" }, error: null };
        if (name === "settle_provider_run") return { data: { ok: true }, error: null };
        if (name === "settle_provider_run_by_external") return { data: { ok: true }, error: null };
        if (name === "read_provider_run_for_loop") {
          return {
            data: {
              status: "ok",
              provider: "Apify",
              external_run_id: "run_test_1",
              dataset_id: "dataset_test_1",
              campaign_id: policyCampaign.id,
              run_status: "running",
            },
            error: null,
          };
        }
        if (name === "read_workspace_state_for_loop") {
          return { data: { status: "ok", state: { campaigns: [policyCampaign], candidates: [] } }, error: null };
        }
        return { data: null, error: null };
      },
    }),
  },
});
mock.module(moduleUrl("src/lib/sourcing/campaign-context.ts"), {
  namedExports: {
    loadSourcingCampaign: async () => policyCampaign,
  },
});
mock.module(moduleUrl("src/lib/sourcing/apify.ts"), {
  namedExports: {
    startProfileSearchRun: async (_clearance: unknown, _token: string, input: ApifyProfileSearchInput) => {
      startCalls++;
      lastStartInput = input;
      return startResult;
    },
    getRunStatus: async () => {
      statusCalls++;
      return statusResult;
    },
    fetchDatasetItems: async () => {
      itemsCalls++;
      return itemsResult;
    },
    resolveStoredApifyKey: async () => {
      resolveKeyCalls++;
      return storedApifyKey;
    },
    resolveStoredApifyKeyForWorkspace: async () => storedApifyKey,
  },
});

const startRoute = await import("../src/app/api/source/apify/start/route.ts");
const statusRoute = await import("../src/app/api/source/apify/status/route.ts");
const pollRoute = await import("../src/app/api/cron/poll-provider-run/route.ts");

const startReq = (body: Record<string, unknown> = { campaignId: policyCampaign.id, searchQuery: "language:Go" }) =>
  new NextRequest("http://localhost/api/source/apify/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const CRON_FIXTURE = ["cron", "secret", "TEST", "12345678901234567890"].join("_");
const statusReq = (query: string) => new NextRequest(`http://localhost/api/source/apify/status${query}`);
const pollReq = () =>
  new NextRequest("http://localhost/api/cron/poll-provider-run", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CRON_FIXTURE}` },
    body: JSON.stringify({ workspaceId: "51111111-1111-4111-8111-111111111111", providerRunId: "81111111-1111-4111-8111-111111111111" }),
  });

process.env.CRON_SECRET = CRON_FIXTURE;

/* ---- prodFailClosed blocks in prod ----------------------------------------- */
{
  prodBlockResponse = new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
  startCalls = 0;
  resolveKeyCalls = 0;
  const res = await startRoute.POST(startReq());
  ok("start: prodFailClosed blocks before any auth/adapter work", res.status === 503 && startCalls === 0 && resolveKeyCalls === 0);

  statusCalls = 0;
  const res2 = await statusRoute.GET(statusReq("?runId=run_test_1"));
  ok("status: prodFailClosed blocks before any auth/adapter work", res2.status === 503 && statusCalls === 0);

  prodBlockResponse = null;
}

/* ---- unauthenticated -> 401 ------------------------------------------------ */
{
  currentUser = null;
  startCalls = 0;
  resolveKeyCalls = 0;
  const res = await startRoute.POST(startReq());
  ok("start: unauthenticated is rejected", res.status === 401 && startCalls === 0 && resolveKeyCalls === 0);

  const res2 = await statusRoute.GET(statusReq("?runId=run_test_1"));
  ok("status: unauthenticated is rejected", res2.status === 401);

  currentUser = { id: "user-1", email: "recruiter@example.test" };
}

/* ---- role lacking "source" -> 403 ------------------------------------------ */
{
  currentRole = "viewer";
  startCalls = 0;
  resolveKeyCalls = 0;
  const res = await startRoute.POST(startReq());
  ok("start: role without source permission gets 403", res.status === 403 && startCalls === 0 && resolveKeyCalls === 0);

  const res2 = await statusRoute.GET(statusReq("?runId=run_test_1"));
  ok("status: role without source permission gets 403", res2.status === 403);

  currentRole = "member";
}

/* ---- missing key -> not-configured response -------------------------------- */
{
  storedApifyKey = null;
  startCalls = 0;
  const res = await startRoute.POST(startReq());
  const json = await res.json();
  ok(
    "start: missing key returns ok:false not-configured without calling adapter",
    res.status === 200 && json.ok === false && startCalls === 0,
  );

  const res2 = await statusRoute.GET(statusReq("?runId=run_test_1"));
  const json2 = await res2.json();
  ok("status: missing key returns ok:false not-configured without polling", res2.status === 200 && json2.ok === false && statusCalls === 0);

  storedApifyKey = "apify_api_TEST_PLACEHOLDER_0000000000";
}

/* ---- missing runId on status -> 400 ---------------------------------------- */
{
  statusCalls = 0;
  const res = await statusRoute.GET(statusReq(""));
  ok("status: missing runId is rejected with 400", res.status === 400 && statusCalls === 0);
}

/* ---- happy path: start + poll SUCCEEDED + sample profiles ------------------ */
{
  startCalls = 0;
  resolveKeyCalls = 0;
  serviceRpcCalls = [];
  const startRes = await startRoute.POST(startReq());
  const startJson = await startRes.json();
  ok(
    "start: happy path returns runId + datasetId from the adapter",
    startRes.status === 200 &&
      startJson.ok === true &&
      startJson.runId === "run_test_1" &&
      startJson.datasetId === "dataset_test_1" &&
      startJson.providerRunId === "81111111-1111-4111-8111-111111111111" &&
      startCalls === 1 &&
      resolveKeyCalls === 1,
  );
  ok("start: persists and enqueues the provider run server-side", serviceRpcCalls.some((call) => call.name === "begin_provider_run") && serviceRpcCalls.some((call) => call.name === "attach_provider_run") && serviceRpcCalls.some((call) => call.name === "enqueue_aria_job"));
  ok("start: never echoes the stored token in the response", JSON.stringify(startJson).includes("TEST_PLACEHOLDER") === false);
  const startInput = lastStartInput as ApifyProfileSearchInput | null;
  ok("start: forwards the validated search criteria to the adapter", startInput !== null && startInput.searchQuery === "language:Go");

  statusCalls = 0;
  itemsCalls = 0;
  serviceRpcCalls = [];
  statusResult = { ok: true, status: 200, data: { status: "SUCCEEDED" } };
  itemsResult = { ok: true, status: 200, data: [sampleProfile] };
  const statusRes = await statusRoute.GET(statusReq(`?runId=${startJson.runId}&datasetId=${startJson.datasetId}`));
  const statusJson = await statusRes.json();
  ok(
    "status: happy path returns completed with mapped-source profiles",
    statusRes.status === 200 &&
      statusJson.ok === true &&
      statusJson.status === "completed" &&
      Array.isArray(statusJson.profiles) &&
      statusJson.profiles.length === 1 &&
      statusJson.profiles[0].linkedinUrl === sampleProfile.linkedinUrl &&
      statusCalls === 1 &&
      itemsCalls === 1,
  );
  ok("status: settles the durable provider run after completion", serviceRpcCalls.some((call) => call.name === "settle_provider_run_by_external"));
  ok("status: never echoes the stored token in the response", JSON.stringify(statusJson).includes("TEST_PLACEHOLDER") === false);
}

/* ---- browser-gone recovery: cron poll settles a persisted run ------------- */
{
  statusCalls = 0;
  itemsCalls = 0;
  serviceRpcCalls = [];
  statusResult = { ok: true, status: 200, data: { status: "SUCCEEDED" } };
  itemsResult = { ok: true, status: 200, data: [sampleProfile] };

  const res = await pollRoute.POST(pollReq());
  const json = await res.json();
  ok(
    "cron provider poll recovers and settles a persisted Apify run without browser session",
    res.status === 200 &&
      json.ok === true &&
      json.status === "completed" &&
      Array.isArray(json.candidates) &&
      json.candidates.length === 1 &&
      statusCalls === 1 &&
      itemsCalls === 1 &&
      serviceRpcCalls.some((call) => call.name === "read_provider_run_for_loop") &&
      serviceRpcCalls.some((call) => call.name === "settle_provider_run"),
  );
}

/* ---- provider run cap blocks before Apify is reached ---------------------- */
{
  providerRunAllowed = false;
  startCalls = 0;
  serviceRpcCalls = [];
  const res = await startRoute.POST(startReq());
  const json = await res.json();
  ok(
    "start: provider run authority refusal blocks before adapter invocation",
    res.status === 429 && json.ok === false && startCalls === 0 && serviceRpcCalls.some((call) => call.name === "begin_provider_run"),
  );
  providerRunAllowed = true;
}

/* ---- criteria policy: name fields differ from discovery fields ------------- */
{
  startCalls = 0;
  const allowedRes = await startRoute.POST(startReq({
    campaignId: policyCampaign.id,
    searchQuery: "language:Go",
    lastNames: ["Young"],
  }));
  const allowedJson = await allowedRes.json();
  ok(
    "start: ordinary surnames matching protected-proxy words are allowed in lastNames",
    allowedRes.status === 200 && allowedJson.ok === true && startCalls === 1,
  );

  startCalls = 0;
  const refusedRes = await startRoute.POST(startReq({
    campaignId: policyCampaign.id,
    searchQuery: "language:Go",
    schools: ["Stanford University"],
  }));
  const refusedJson = await refusedRes.json();
  ok(
    "start: prohibited terms in discovery fields are refused before provider invocation",
    refusedRes.status === 422 &&
      refusedJson.ok === false &&
      refusedJson.error === "Search query requires policy review." &&
      startCalls === 0,
  );
}

console.log(`RESULT source-apify-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
