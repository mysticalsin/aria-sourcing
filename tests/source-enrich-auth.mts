import { mock } from "node:test";
import { NextRequest } from "next/server";
import type { OrchestrateEnrichmentResult } from "../src/lib/enrichment/orchestrator.ts";
import type { Candidate } from "../src/lib/types.ts";

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

let orchestrateCalls = 0;
let lastOrchestrateInput: { candidate: unknown; want: unknown; budgetRemaining: unknown } | null = null;

// Never a real key/credit — a synthetic placeholder + fixed patch the mocked
// orchestrator "hands back", standing in for a real waterfall run.
let orchestrateResult: OrchestrateEnrichmentResult = {
  candidate: {
    id: "cand-1",
    name: "Jane Doe",
    email: "jane.doe@example.test",
    phone: "+33000000000",
    currentTitle: "Senior Engineer",
    currentCompany: "Example Corp",
    location: "Paris, France",
    linkedinUrl: "https://www.linkedin.com/in/jane-doe-sample",
    techStack: ["TypeScript"],
    externalIds: { Apollo: "apollo_person_id_test_1" },
    matchScore: 0,
    matchBreakdown: [],
    enrichment: {
      status: "partial",
      lastEnrichedAt: "2026-07-15T00:00:00.000Z",
      fieldProvenance: {
        email: { provider: "Apollo", at: "2026-07-15T00:00:00.000Z", confidence: 0.9 },
      },
      attempts: [{ provider: "Apollo", at: "2026-07-15T00:00:00.000Z", status: "ok", fieldsFilled: ["email"], costUnits: 2 }],
      coverage: ["email"],
    },
    // Deliberately partial fixture — only the fields this test asserts on.
    // `unknown` (not `any`) is the honest cast: it still requires an explicit
    // opt-out but doesn't silently disable checking on every later use.
  } as unknown as Candidate,
  attempts: [{ provider: "Apollo", at: "2026-07-15T00:00:00.000Z", status: "ok", fieldsFilled: ["email"], costUnits: 2 }],
  spend: 2,
};

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
mock.module(moduleUrl("src/lib/enrichment/orchestrator.ts"), {
  namedExports: {
    orchestrateEnrichment: async (input: { candidate: unknown; want: unknown; budgetRemaining: unknown }) => {
      orchestrateCalls++;
      lastOrchestrateInput = input;
      return orchestrateResult;
    },
  },
});

const enrichRoute = await import("../src/app/api/source/enrich/route.ts");

const validCandidate = {
  id: "cand-1",
  name: "Jane Doe",
  sourcePlatform: "Apify",
  currentCompany: "Example Corp",
  linkedinUrl: "https://www.linkedin.com/in/jane-doe-sample",
};

const enrichReq = (body: unknown) =>
  new NextRequest("http://localhost/api/source/enrich", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = { candidate: validCandidate, want: ["email", "phone"] };

/* ---- prodFailClosed blocks in prod ----------------------------------------- */
{
  prodBlockResponse = new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
  orchestrateCalls = 0;
  const res = await enrichRoute.POST(enrichReq(validBody));
  ok("prodFailClosed blocks before any auth/orchestrator work", res.status === 503 && orchestrateCalls === 0);

  prodBlockResponse = null;
}

/* ---- unauthenticated -> 401 ------------------------------------------------ */
{
  currentUser = null;
  orchestrateCalls = 0;
  const res = await enrichRoute.POST(enrichReq(validBody));
  ok("unauthenticated is rejected", res.status === 401 && orchestrateCalls === 0);

  currentUser = { id: "user-1", email: "recruiter@example.test" };
}

/* ---- role lacking "source" -> 403 ------------------------------------------ */
{
  currentRole = "viewer";
  orchestrateCalls = 0;
  const res = await enrichRoute.POST(enrichReq(validBody));
  ok("role without source permission gets 403", res.status === 403 && orchestrateCalls === 0);

  currentRole = "member";
}

/* ---- invalid body -> 400 ---------------------------------------------------- */
{
  orchestrateCalls = 0;
  const emptyWantRes = await enrichRoute.POST(enrichReq({ candidate: validCandidate, want: [] }));
  ok("empty `want` array is rejected with 400", emptyWantRes.status === 400 && orchestrateCalls === 0);

  const badPlatformRes = await enrichRoute.POST(
    enrichReq({ candidate: { ...validCandidate, sourcePlatform: "NotARealPlatform" }, want: ["email"] }),
  );
  ok("unknown sourcePlatform is rejected with 400", badPlatformRes.status === 400 && orchestrateCalls === 0);

  const missingNameRes = await enrichRoute.POST(
    enrichReq({ candidate: { id: "cand-2", sourcePlatform: "Apify" }, want: ["email"] }),
  );
  ok("candidate missing required `name` is rejected with 400", missingNameRes.status === 400 && orchestrateCalls === 0);
}

/* ---- happy path: orchestrator mocked, returns a merged patch --------------- */
{
  orchestrateCalls = 0;
  lastOrchestrateInput = null;
  const res = await enrichRoute.POST(enrichReq(validBody));
  const json = await res.json();

  ok("happy path returns 200 ok:true and invokes the orchestrator once", res.status === 200 && json.ok === true && orchestrateCalls === 1);
  const forwarded = lastOrchestrateInput as { candidate: unknown; want: unknown; budgetRemaining: unknown } | null;
  ok(
    "happy path forwards the validated candidate + want to the orchestrator",
    forwarded !== null &&
      (forwarded.candidate as { id?: string } | undefined)?.id === "cand-1" &&
      Array.isArray(forwarded.want) &&
      (forwarded.want as string[]).includes("email"),
  );
  ok(
    "happy path echoes the orchestrator's patch fields",
    json.patch?.email === "jane.doe@example.test" &&
      json.patch?.phone === "+33000000000" &&
      json.patch?.enrichment?.status === "partial" &&
      Array.isArray(json.attempts) &&
      json.attempts.length === 1 &&
      json.attempts[0].provider === "Apollo" &&
      json.spend === 2,
  );
  ok("happy path never echoes a raw provider key/token", JSON.stringify(json).includes("TEST_PLACEHOLDER") === false);
}

/* ---- budgetRemaining is clamped to the server ceiling, never client-trusted */
{
  // budgetRemaining is client-supplied and only ever a hint — the route
  // clamps it to MAX_ENRICH_UNITS_PER_REQUEST (10) server-side so a request
  // can never authorize more spend than the server allows, regardless of
  // what the client sends (or omits).
  type OrchestrateInput = { candidate: unknown; want: unknown; budgetRemaining: unknown } | null;
  orchestrateCalls = 0;
  lastOrchestrateInput = null;
  await enrichRoute.POST(enrichReq(validBody));
  ok("omitted budgetRemaining defaults to the server ceiling, not Infinity", (lastOrchestrateInput as OrchestrateInput)?.budgetRemaining === 10);

  await enrichRoute.POST(enrichReq({ ...validBody, budgetRemaining: 5 }));
  ok("a supplied budgetRemaining under the ceiling is forwarded as-is", (lastOrchestrateInput as OrchestrateInput)?.budgetRemaining === 5);

  await enrichRoute.POST(enrichReq({ ...validBody, budgetRemaining: 999 }));
  ok("a supplied budgetRemaining above the ceiling is clamped down to it", (lastOrchestrateInput as OrchestrateInput)?.budgetRemaining === 10);
}

console.log(`RESULT source-enrich-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
