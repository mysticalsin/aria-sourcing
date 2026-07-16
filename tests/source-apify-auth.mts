import { mock } from "node:test";
import { NextRequest } from "next/server";
import type { ApifyResult, ApifyProfile, ApifyProfileSearchInput } from "../src/lib/sourcing/apify.ts";

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

/* ---- mutable fixtures the mocked modules read at call time ---------------- */

let prodBlockResponse: Response | null = null;
let currentUser: { id: string; email: string } | null = { id: "user-1", email: "recruiter@example.test" };
let currentRole: "admin" | "member" | "viewer" = "member";

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

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: true,
    prodFailClosed: () => prodBlockResponse,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => makeFakeSupabase(),
  },
});
mock.module(moduleUrl("src/lib/sourcing/apify.ts"), {
  namedExports: {
    startProfileSearchRun: async (_token: string, input: ApifyProfileSearchInput) => {
      startCalls++;
      lastStartInput = input;
      return startResult;
    },
    getRunStatus: async (_token: string, _runId: string) => {
      statusCalls++;
      return statusResult;
    },
    fetchDatasetItems: async (_token: string, _datasetId: string, _limit: number) => {
      itemsCalls++;
      return itemsResult;
    },
    resolveStoredApifyKey: async () => {
      resolveKeyCalls++;
      return storedApifyKey;
    },
  },
});

const startRoute = await import("../src/app/api/source/apify/start/route.ts");
const statusRoute = await import("../src/app/api/source/apify/status/route.ts");

const startReq = () =>
  new NextRequest("http://localhost/api/source/apify/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ searchQuery: "typescript engineer" }),
  });

const statusReq = (query: string) => new NextRequest(`http://localhost/api/source/apify/status${query}`);

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
  const startRes = await startRoute.POST(startReq());
  const startJson = await startRes.json();
  ok(
    "start: happy path returns runId + datasetId from the adapter",
    startRes.status === 200 &&
      startJson.ok === true &&
      startJson.runId === "run_test_1" &&
      startJson.datasetId === "dataset_test_1" &&
      startCalls === 1 &&
      resolveKeyCalls === 1,
  );
  ok("start: never echoes the stored token in the response", JSON.stringify(startJson).includes("TEST_PLACEHOLDER") === false);
  const startInput = lastStartInput as ApifyProfileSearchInput | null;
  ok("start: forwards the validated search criteria to the adapter", startInput !== null && startInput.searchQuery === "typescript engineer");

  statusCalls = 0;
  itemsCalls = 0;
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
  ok("status: never echoes the stored token in the response", JSON.stringify(statusJson).includes("TEST_PLACEHOLDER") === false);
}

console.log(`RESULT source-apify-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
