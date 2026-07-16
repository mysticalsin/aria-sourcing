import { mock } from "node:test";
import { NextRequest } from "next/server";

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

let prodBlockResponse: Response | null = null;
let sessionUnavailable = false;
let currentUser: { id: string; email: string } | null = { id: "user-1", email: "viewer@example.test" };
let currentRole: "admin" | "member" | "viewer" | "none" = "viewer";
let rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
let listRows: unknown[] = [
  {
    total: 2,
    payload: {
      id: "cand-1",
      campaignId: "campaign-1",
      name: "Jane Candidate",
      email: "jane@example.test",
      sourcePlatform: "GitHub",
      matchScore: 91,
      complianceFlags: { anonymized: true },
      secret: "SHOULD_NOT_LEAK_AS_SECRET",
    },
  },
  { total: 2, payload: { id: "bad-no-name", campaignId: "campaign-1" } },
];

function makeFakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "current_profile_role") {
        return { data: currentRole === "none" ? null : currentRole, error: null };
      }
      if (fn === "list_workspace_candidates") {
        return { data: listRows, error: null };
      }
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
    getServerSupabase: async () => (sessionUnavailable ? null : makeFakeSupabase()),
  },
});

const route = await import("../src/app/api/candidates/route.ts");

const candidatesReq = (query = "") =>
  new NextRequest(`http://localhost/api/candidates${query}`, { method: "GET" });

function hasSensitiveHeaders(res: Response): boolean {
  return (
    res.headers.get("Cache-Control") === "no-store" &&
    res.headers.get("X-Content-Type-Options") === "nosniff"
  );
}

/* ---- prodFailClosed blocks before auth/RPC work -------------------------- */
{
  prodBlockResponse = new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
    status: 503,
  });
  rpcCalls = [];
  const res = await route.GET(candidatesReq());
  ok("prodFailClosed returns 503 before auth/RPC work", res.status === 503 && rpcCalls.length === 0);
  ok("prodFailClosed response has sensitive headers", hasSensitiveHeaders(res));
  prodBlockResponse = null;
}

/* ---- no live session / demo unavailable idiom ---------------------------- */
{
  sessionUnavailable = true;
  rpcCalls = [];
  const res = await route.GET(candidatesReq());
  const json = await res.json();
  ok("unavailable session returns 503-style unavailable response", res.status === 503 && json.code === "CANDIDATES_UNAVAILABLE");
  ok("unavailable response has sensitive headers", hasSensitiveHeaders(res));
  ok("unavailable path does not call RPC", rpcCalls.length === 0);
  sessionUnavailable = false;
}

/* ---- unauthenticated -> 401 ---------------------------------------------- */
{
  currentUser = null;
  rpcCalls = [];
  const res = await route.GET(candidatesReq());
  ok("unauthenticated is rejected", res.status === 401 && rpcCalls.length === 0);
  ok("unauthenticated response has sensitive headers", hasSensitiveHeaders(res));
  currentUser = { id: "user-1", email: "viewer@example.test" };
}

/* ---- role without view -> 403 -------------------------------------------- */
{
  currentRole = "none";
  rpcCalls = [];
  const res = await route.GET(candidatesReq());
  ok(
    "role without view permission gets 403",
    res.status === 403 &&
      rpcCalls.length === 1 &&
      rpcCalls[0]?.fn === "current_profile_role",
  );
  ok("forbidden response has sensitive headers", hasSensitiveHeaders(res));
  currentRole = "viewer";
}

/* ---- invalid query -> 400 ------------------------------------------------- */
{
  rpcCalls = [];
  const res = await route.GET(candidatesReq("?limit=0"));
  ok(
    "invalid query is rejected with 400 before list RPC",
    res.status === 400 &&
      rpcCalls.length === 1 &&
      rpcCalls[0]?.fn === "current_profile_role",
  );
  ok("invalid query response has sensitive headers", hasSensitiveHeaders(res));
}

/* ---- happy path ----------------------------------------------------------- */
{
  rpcCalls = [];
  const res = await route.GET(
    candidatesReq("?campaignId=campaign-1&stage=Sourced&source=GitHub&search=Jane&sort=recent&limit=25&offset=50"),
  );
  const json = await res.json();
  const listCall = rpcCalls.find((call) => call.fn === "list_workspace_candidates");

  ok("happy path returns 200 ok:true", res.status === 200 && json.ok === true);
  ok("happy path has sensitive headers", hasSensitiveHeaders(res));
  ok(
    "happy path calls list_workspace_candidates once with validated params",
    rpcCalls.filter((call) => call.fn === "list_workspace_candidates").length === 1 &&
      listCall?.args?.p_campaign_id === "campaign-1" &&
      listCall.args.p_stage === "Sourced" &&
      listCall.args.p_source === "GitHub" &&
      listCall.args.p_search === "Jane" &&
      listCall.args.p_sort === "recent" &&
      listCall.args.p_limit === 25 &&
      listCall.args.p_offset === 50,
  );
  ok(
    "happy path normalizes valid payload and drops malformed payload",
    json.total === 2 &&
      Array.isArray(json.candidates) &&
      json.candidates.length === 1 &&
      json.candidates[0].id === "cand-1" &&
      json.candidates[0].yearsExperience === null &&
      json.candidates[0].complianceFlags.anonymized === true &&
      json.candidates[0].complianceFlags.doNotContact === false,
  );
  ok("happy path does not leak secret-looking payload keys", JSON.stringify(json).includes("SHOULD_NOT_LEAK") === false);
}

console.log(`RESULT candidates-route-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
