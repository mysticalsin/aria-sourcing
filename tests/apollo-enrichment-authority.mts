import { existsSync, readFileSync } from "node:fs";
import { mock } from "node:test";
import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
const policyCampaign = buildSeedState().campaigns[0];
const workspaceId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const candidateId = "99999999-9999-4999-8999-999999999999";
const nonce = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const attemptId = "55555555-5555-4555-8555-555555555555";

let user: { id: string } | null = { id: "user-1" };
let userSequence = 1;
let role = "member";
let storedKey: string | null = "stored-apollo-key";
let providerCalls = 0;
let providerSearchCalls = 0;
let lastProviderId = "";
let providerResult: { email: string; phone: string } | null = {
  email: "person@example.test",
  phone: "",
};
let providerError = "";
let prepareCalls = 0;
let claimCalls = 0;
let completeCalls = 0;
let ambiguousCalls = 0;
let registerCalls = 0;
let registerError = false;
let completeOk = true;
let productionBlock: Response | null = null;
let authDependencyError = false;
let lastSafeLogMeta: Record<string, unknown> | null = null;
function getLastSafeLogMeta(): Record<string, unknown> | null {
  return lastSafeLogMeta;
}
let prepareResult: Record<string, unknown> = {
  status: "prepared",
  confirmationNonce: nonce,
  expiresAt: "2026-07-13T07:00:00.000Z",
};
let claimResult: Record<string, unknown> = {
  status: "claimed",
  attemptId,
  providerExternalId: "apollo-person-1",
};
const rawSearchPerson = {
  id: "raw-apollo-person-id",
  name: "Ada Lovelace",
  title: "Engineer",
  company: "Analytical Engines",
  linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
  city: "London",
  state: "",
  country: "United Kingdom",
  headline: "Engineer",
  seniority: "senior",
  departments: ["engineering"],
};
let registerResult: Record<string, unknown>[] | null = [
  { ...rawSearchPerson, id: undefined, targetId, candidateId },
];

const session = {
  auth: { getUser: async () => ({ data: { user }, error: null }) },
  rpc: async (name: string) => ({
    data: name === "current_profile_role" ? role : name === "current_workspace_id" ? workspaceId : null,
    error: null,
  }),
};

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: { supabaseEnabled: true, prodFailClosed: () => productionBlock },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      if (authDependencyError) throw new Error("simulated auth dependency exception");
      return session;
    },
    getServiceSupabase: () => ({ from: () => ({}) }),
  },
});
mock.module(moduleUrl("src/lib/sourcing/campaign-context.ts"), {
  namedExports: {
    loadSourcingCampaign: async () => policyCampaign,
  },
});
mock.module(moduleUrl("src/lib/sourcing/apollo.ts"), {
  namedExports: {
    resolveStoredApolloKey: async () => storedKey,
    searchApolloPeople: async () => {
      providerSearchCalls += 1;
      if (providerError) throw new Error(providerError);
      return [rawSearchPerson];
    },
    matchApolloPerson: async (_clearance: unknown, providerId: string) => {
      providerCalls += 1;
      lastProviderId = providerId;
      if (providerError) throw new Error(providerError);
      return providerResult;
    },
  },
});
mock.module(moduleUrl("src/lib/crypto-secrets.ts"), {
  namedExports: {
    encryptionRequiredButMissing: () => false,
    encryptSecret: (value: string) => (value ? `encrypted:${value}` : ""),
    decryptSecret: (value: string) => value.replace(/^encrypted:/, ""),
  },
});
mock.module(moduleUrl("src/lib/log-redact.ts"), {
  namedExports: {
    safeLog: (_message: string, meta: Record<string, unknown>) => {
      lastSafeLogMeta = meta;
    },
  },
});
mock.module(moduleUrl("src/lib/sourcing/source-authority.ts"), {
  namedExports: {
    registerApolloEnrichmentTargets: async () => {
      registerCalls += 1;
      if (registerError) throw new Error("simulated authority dependency exception");
      return registerResult;
    },
    prepareApolloEnrichmentTarget: async () => {
      prepareCalls += 1;
      return prepareResult;
    },
    claimApolloEnrichmentTarget: async () => {
      claimCalls += 1;
      return claimResult;
    },
    completeApolloEnrichmentTarget: async () => {
      completeCalls += 1;
      return completeOk;
    },
    markApolloEnrichmentAmbiguous: async () => {
      ambiguousCalls += 1;
      return true;
    },
  },
});

const routeModule = await import("../src/app/api/source/apollo/enrich/route");
const post = ((routeModule as any).POST ?? (routeModule as any).default?.POST) as (
  request: NextRequest,
) => Promise<Response>;
const searchRouteModule = await import("../src/app/api/source/apollo/search/route");
const searchPost = ((searchRouteModule as any).POST ?? (searchRouteModule as any).default?.POST) as (
  request: NextRequest,
) => Promise<Response>;

function request(
  body: unknown,
  origin = "http://localhost",
  includeRequestId = true,
  contentType = "application/json",
) {
  const headers: Record<string, string> = { "content-type": contentType, origin };
  if (includeRequestId) headers["x-request-id"] = crypto.randomUUID();
  const boundBody = body && typeof body === "object" && !Array.isArray(body) &&
    (body as Record<string, unknown>).action
    ? { campaignId: "campaign-1", candidateId, ...(body as Record<string, unknown>) }
    : body;
  return new NextRequest("http://localhost/api/source/apollo/enrich", {
    method: "POST",
    headers,
    body: JSON.stringify(boundBody),
  });
}

function reset() {
  userSequence += 1;
  user = { id: `user-${userSequence}` };
  role = "member";
  storedKey = "stored-apollo-key";
  providerCalls = 0;
  providerSearchCalls = 0;
  lastProviderId = "";
  providerResult = { email: "person@example.test", phone: "" };
  providerError = "";
  prepareCalls = 0;
  claimCalls = 0;
  completeCalls = 0;
  ambiguousCalls = 0;
  registerCalls = 0;
  registerError = false;
  completeOk = true;
  productionBlock = null;
  authDependencyError = false;
  lastSafeLogMeta = null;
  prepareResult = {
    status: "prepared",
    confirmationNonce: nonce,
    expiresAt: "2026-07-13T07:00:00.000Z",
  };
  claimResult = { status: "claimed", attemptId, providerExternalId: "apollo-person-1" };
  registerResult = [{ ...rawSearchPerson, id: undefined, targetId, candidateId }];
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function searchRequest(origin = "http://localhost", contentType = "application/json") {
  return new NextRequest("http://localhost/api/source/apollo/search", {
    method: "POST",
    headers: { "content-type": contentType, origin, "x-request-id": crypto.randomUUID() },
    body: JSON.stringify({ campaignId: "campaign-1", titles: ["Engineer"], count: 1 }),
  });
}

reset();
const searched = await searchPost(searchRequest());
const searchedBody = await json(searched);
const searchedProfiles = Array.isArray(searchedBody.profiles)
  ? (searchedBody.profiles as Record<string, unknown>[])
  : [];
ok(
  "Apollo search registers every result before returning it",
  searched.status === 200 && providerSearchCalls === 1 && registerCalls === 1,
);
ok(
  "Apollo search returns opaque targets and no raw provider id",
  searchedProfiles[0]?.targetId === targetId &&
    !("id" in (searchedProfiles[0] ?? {})) &&
    !JSON.stringify(searchedBody).includes("raw-apollo-person-id"),
);
ok("Apollo search response is non-cacheable", searched.headers.get("cache-control") === "no-store");

reset();
registerResult = null;
const registrationFailure = await searchPost(searchRequest());
const registrationFailureBody = await json(registrationFailure);
ok(
  "authority registration failure returns no profiles",
  registrationFailure.status === 503 &&
    registrationFailureBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    !JSON.stringify(registrationFailureBody).includes("raw-apollo-person-id"),
);

reset();
registerError = true;
const registrationException = await searchPost(searchRequest());
const registrationExceptionBody = await json(registrationException);
ok(
  "authority registration exceptions keep the authority error contract",
  registrationException.status === 503 &&
    registrationExceptionBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    providerSearchCalls === 1 &&
    registerCalls === 1,
);

reset();
providerError = "Bearer secret-token-value; person@example.test; upstream body";
const searchFailure = await searchPost(searchRequest());
const searchFailureBody = await json(searchFailure);
ok(
  "Apollo search provider errors use a bounded typed response",
  searchFailure.status === 502 &&
    searchFailureBody.code === "APOLLO_PROVIDER_UNAVAILABLE" &&
    !JSON.stringify(searchFailureBody).includes("secret-token-value") &&
    !JSON.stringify(searchFailureBody).includes("person@example.test"),
);

reset();
const safeLinkedInUrl = rawSearchPerson.linkedinUrl;
rawSearchPerson.linkedinUrl = "javascript:alert(document.domain)";
const unsafeProfile = await searchPost(searchRequest());
const unsafeProfileBody = await json(unsafeProfile);
rawSearchPerson.linkedinUrl = safeLinkedInUrl;
ok(
  "provider-controlled profile URLs cannot cross the browser boundary",
  unsafeProfile.status === 502 &&
    unsafeProfileBody.code === "APOLLO_PROVIDER_INVALID_RESPONSE" &&
    registerCalls === 0 &&
    !JSON.stringify(unsafeProfileBody).includes("javascript:"),
);

reset();
const crossOriginSearch = await searchPost(searchRequest("https://attacker.test"));
ok(
  "cross-origin search cannot create authority targets",
  crossOriginSearch.status === 403 && providerSearchCalls === 0 && registerCalls === 0,
);

reset();
const invalidSearchMediaType = await searchPost(searchRequest("http://localhost", "application/jsonp"));
const invalidEnrichmentMediaType = await post(
  request({ action: "prepare", targetId, scope: "email" }, "http://localhost", true, "application/json-evil"),
);
ok(
  "Apollo routes reject media types that only prefix-match JSON",
  invalidSearchMediaType.status === 415 &&
    invalidEnrichmentMediaType.status === 415 &&
    providerSearchCalls === 0 &&
    prepareCalls === 0,
);

reset();
productionBlock = new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
  status: 503,
  headers: { "content-type": "application/json" },
});
const productionBlocked = await post(request({ action: "prepare", targetId, scope: "email" }));
const productionBlockedBody = await json(productionBlocked);
ok(
  "production fail-closed uses the typed non-cacheable route contract",
  productionBlocked.status === 503 &&
    productionBlockedBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    productionBlockedBody.requestId !== undefined &&
    productionBlocked.headers.get("cache-control") === "no-store" &&
    prepareCalls === 0 &&
    providerCalls === 0,
);
const productionBlockedSearch = await searchPost(searchRequest());
const productionBlockedSearchBody = await json(productionBlockedSearch);
ok(
  "production search fail-closed uses the typed non-cacheable route contract",
  productionBlockedSearch.status === 503 &&
    productionBlockedSearchBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    productionBlockedSearchBody.requestId !== undefined &&
    productionBlockedSearch.headers.get("cache-control") === "no-store" &&
    providerSearchCalls === 0 &&
    registerCalls === 0,
);

reset();
authDependencyError = true;
const authFailure = await post(request({ action: "prepare", targetId, scope: "email" }));
const authFailureBody = await json(authFailure);
ok(
  "enrichment dependency exceptions preserve the typed non-cacheable contract",
  authFailure.status === 503 &&
    authFailureBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    authFailureBody.requestId !== undefined &&
    authFailure.headers.get("cache-control") === "no-store",
);
const searchAuthFailure = await searchPost(searchRequest());
const searchAuthFailureBody = await json(searchAuthFailure);
ok(
  "search dependency exceptions preserve the typed non-cacheable contract",
  searchAuthFailure.status === 503 &&
    searchAuthFailureBody.code === "APOLLO_AUTHORITY_UNAVAILABLE" &&
    searchAuthFailureBody.requestId !== undefined &&
    searchAuthFailure.headers.get("cache-control") === "no-store",
);

reset();
const rawId = await post(request({ apolloId: "arbitrary-provider-id" }));
ok("raw Apollo provider ids are rejected before provider I/O", rawId.status === 400 && providerCalls === 0);

reset();
const crossOrigin = await post(request({ action: "prepare", targetId, scope: "email" }, "https://attacker.test"));
ok("cross-origin prepare is rejected before authority or provider work", crossOrigin.status === 403 && prepareCalls === 0 && providerCalls === 0);

reset();
const prepared = await post(request({ action: "prepare", targetId, scope: "email" }));
const preparedBody = await json(prepared);
ok("prepare returns the normalized single-use confirmation contract", prepared.status === 200 && preparedBody.status === "prepared" && preparedBody.confirmationNonce === nonce && preparedBody.maxCostCredits === 1);
ok("prepare performs no key lookup or provider call", prepareCalls === 1 && claimCalls === 0 && providerCalls === 0);
ok("prepare response is non-cacheable", prepared.headers.get("cache-control") === "no-store");

reset();
prepareResult = { status: "not_found" };
const missingPrepare = await post(request({ action: "prepare", targetId, scope: "email" }));
const missingPrepareBody = await json(missingPrepare);
ok("missing or foreign prepare target is indistinguishable and provider-free", missingPrepare.status === 404 && missingPrepareBody.code === "APOLLO_TARGET_NOT_FOUND" && providerCalls === 0);

reset();
const malformedCommit = await post(request({ action: "commit", targetId, scope: "email" }));
ok("commit requires nonce and idempotency key", malformedCommit.status === 400 && claimCalls === 0 && providerCalls === 0);

for (const [status, expectedStatus, expectedCode] of [
  ["not_found", 404, "APOLLO_TARGET_NOT_FOUND"],
  ["in_progress", 409, "APOLLO_ENRICHMENT_IN_PROGRESS"],
  ["ambiguous", 409, "APOLLO_RECONCILIATION_REQUIRED"],
  ["nonce_invalid", 409, "APOLLO_CONFIRMATION_INVALID"],
  ["quota_exceeded", 429, "APOLLO_QUOTA_EXCEEDED"],
  ["idempotency_conflict", 409, "APOLLO_IDEMPOTENCY_CONFLICT"],
  ["cancelled", 409, "APOLLO_RETRY_REQUIRES_NEW_CONFIRMATION"],
  ["dependency_unavailable", 503, "APOLLO_AUTHORITY_UNAVAILABLE"],
] as const) {
  reset();
  claimResult = { status };
  const response = await post(request({ action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey }));
  const body = await json(response);
  ok(`${status} claim fails closed with typed error`, response.status === expectedStatus && body.code === expectedCode && providerCalls === 0);
}

reset();
claimResult = {
  status: "completed",
  found: true,
  emailSecret: "encrypted:cached@example.test",
  phoneSecret: "",
};
const cached = await post(request({ action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey }));
const cachedBody = await json(cached);
ok("terminal replay returns cached receipt without another provider call", cached.status === 200 && cachedBody.cached === true && cachedBody.email === "cached@example.test" && providerCalls === 0);
ok("email-only replay never returns phone data", cachedBody.phone === "");

reset();
const completed = await post(request({ action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey }));
const completedBody = await json(completed);
ok("claimed target calls the exact server-bound provider id once", completed.status === 200 && providerCalls === 1 && lastProviderId === "apollo-person-1");
ok("provider success is persisted before success is returned", completeCalls === 1 && completedBody.revealed === true && completedBody.email === "person@example.test");
ok("email-only completion strips phone data", completedBody.phone === "");

reset();
providerError = "Bearer secret-token-value; person@example.test; upstream body";
const ambiguous = await post(request(
  { action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey },
  "http://localhost",
  false,
));
const ambiguousBody = await json(ambiguous);
const ambiguousLogMeta = getLastSafeLogMeta();
ok("unknown provider outcome becomes non-retryable reconciliation", ambiguous.status === 502 && ambiguousBody.code === "APOLLO_OUTCOME_UNKNOWN" && ambiguousCalls === 1);
ok("provider errors never cross the public boundary", !JSON.stringify(ambiguousBody).includes("secret-token-value") && !JSON.stringify(ambiguousBody).includes("person@example.test"));
ok(
  "generated request ids correlate ambiguous logs and responses",
  typeof ambiguousBody.requestId === "string" && ambiguousLogMeta?.requestId === ambiguousBody.requestId,
);

reset();
completeOk = false;
const reconcile = await post(request({ action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey }));
const reconcileBody = await json(reconcile);
ok("receipt persistence failure cannot report provider success", reconcile.status === 503 && reconcileBody.code === "APOLLO_RECONCILIATION_REQUIRED" && providerCalls === 1);

reset();
storedKey = null;
const noKey = await post(request({ action: "commit", targetId, scope: "email", confirmationNonce: nonce, idempotencyKey }));
const noKeyBody = await json(noKey);
ok("missing key fails before atomic claim or provider work", noKey.status === 503 && noKeyBody.code === "APOLLO_NOT_CONFIGURED" && claimCalls === 0 && providerCalls === 0);

const migrationPath = "supabase/migrations/0026_apollo_enrichment_authority.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
ok("normalized Apollo target and receipt migration exists", migration.length > 0);
ok(
  "migration denies direct authenticated target access",
  /revoke all on public\.apollo_enrichment_targets from anon, authenticated, service_role, public/i.test(migration),
);
ok(
  "migration denies service-role table bypasses and exposes only hardened RPCs",
  /revoke all on public\.apollo_enrichment_targets from anon, authenticated, service_role, public/i.test(migration) &&
    !/grant\s+(?:select|insert|update|delete)[^;]+apollo_enrichment_[^;]+service_role/is.test(migration),
);
ok("migration defines atomic prepare, claim, completion, and ambiguity functions", [
  "prepare_apollo_enrichment",
  "claim_apollo_enrichment",
  "complete_apollo_enrichment",
  "mark_apollo_enrichment_ambiguous",
].every((name) => migration.includes(name)));
ok("claim locks authority and enforces a workspace-principal quota", /for update/i.test(migration) && /quota/i.test(migration));
ok("authority functions are service-only", /grant execute[^;]+to service_role/is.test(migration) && /revoke all on function[^;]+from public, anon, authenticated/is.test(migration));
ok(
  "authority functions resolve pgcrypto and assert the service JWT in-body",
  /set search_path = pg_catalog, public, extensions, pg_temp/i.test(migration) &&
    (migration.match(/auth\.role\(\)[^;]+service_role/gi) ?? []).length >= 5,
);
ok(
  "new-key cached receipt access validates a nonce before returning PII",
  migration.indexOf("from public.apollo_enrichment_confirmations") <
    migration.indexOf("if target_attempt.id is not null") &&
    migration.indexOf("set consumed_at = now()", migration.indexOf("if target_attempt.id is not null")) <
      migration.indexOf("'status', 'completed'", migration.indexOf("if target_attempt.id is not null")),
);

const spec = readFileSync("docs/api/openapi.yaml", "utf8");
ok("OpenAPI contract documents prepare, commit, idempotency, and typed errors", /confirmationNonce/.test(spec) && /idempotencyKey/.test(spec) && /ErrorResponse/.test(spec));

console.log(`RESULT apollo-enrichment-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
