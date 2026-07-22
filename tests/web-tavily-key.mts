import { buildSeedState } from "../src/lib/seed";
import { encryptSecret, decryptSecret, encryptionRequiredButMissing } from "../src/lib/crypto-secrets";
import { validateApiKeyFormat } from "../src/lib/providers";
import {
  isStoredTavilyCredentialAuthorized,
  resolveStoredTavilyKey,
} from "../src/lib/sourcing/tavily";
import { createProcessEnvScope } from "./helpers/process-env.mts";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const envScope = createProcessEnvScope([
  "DATA_ENCRYPTION_KEY",
  "TAVILY_API_KEY",
  "NODE_ENV",
  "NEXT_PUBLIC_ENABLE_DEMO_LOGIN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]);

interface Row {
  [key: string]: unknown;
}

function makeFakeApiKeysService(row: Row | null) {
  const filters: Row[] = [];
  const calls: string[] = [];
  const query = {
    select: (cols: string) => {
      calls.push(`select:${cols}`);
      return query;
    },
    eq: (col: string, value: unknown) => {
      filters.push({ col, value });
      return query;
    },
    in: (col: string, value: unknown[]) => {
      filters.push({ col, value });
      return query;
    },
    order: (col: string, opts: Row) => {
      calls.push(`order:${col}:${String(opts.ascending)}`);
      return query;
    },
    limit: (n: number) => {
      calls.push(`limit:${n}`);
      return query;
    },
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return {
    client: {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return query;
      },
    },
    calls,
    filters,
  };
}

function makeFakeSession(workspaceId: string) {
  return {
    rpc: (fn: string) => {
      if (fn !== "current_workspace_id") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: workspaceId, error: null });
    },
  };
}

try {
  envScope.set({ DATA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") });
  const secret = "tvly-stored-key-123456";
  const apiKeyId = "77777777-7777-4777-8777-777777777777";
  const encrypted = encryptSecret(secret);
  ok("encryptSecret returns versioned ciphertext when key is configured", encrypted.startsWith("enc:v2:") && encrypted !== secret);
  ok("encryptSecret round-trips with decryptSecret", decryptSecret(encrypted) === secret);

  const fake = makeFakeApiKeysService({
    id: apiKeyId,
    secret: encrypted,
    workspace_id: "ws-1",
    provider: "Tavily",
    status: "valid",
    verification_method: "tavily_usage_v1",
  });
  const resolved = await resolveStoredTavilyKey(makeFakeSession("ws-1") as never, fake.client as never);
  ok("resolveStoredTavilyKey returns decrypted workspace key", resolved === secret);
  ok(
    "resolveStoredTavilyKey queries the workspace-scoped Tavily api_keys row",
    fake.calls.includes("from:api_keys") &&
      fake.calls.includes("select:id, secret, workspace_id, provider, status, verification_method") &&
      fake.filters.some((f) => f.col === "workspace_id" && f.value === "ws-1") &&
      fake.filters.some((f) => f.col === "provider" && f.value === "Tavily") &&
      fake.filters.some((f) => f.col === "status" && f.value === "valid") &&
      fake.filters.some((f) =>
        f.col === "verification_method" &&
        Array.isArray(f.value) &&
        f.value.includes("tavily_usage_v1") &&
        f.value.includes("tavily_key_info_v1")
      ),
  );
  const exactCredentialAuthorized = await isStoredTavilyCredentialAuthorized(
    fake.client as never,
    "ws-1",
    apiKeyId,
  );
  ok(
    "Tavily egress rechecks the exact tenant key identity and valid status",
    exactCredentialAuthorized &&
      fake.filters.some((f) => f.col === "id" && f.value === apiKeyId),
  );

  for (const row of [
    { id: apiKeyId, secret: encrypted, workspace_id: "ws-1", provider: "Tavily", status: "invalid", verification_method: "tavily_usage_v1" },
    { id: apiKeyId, secret: encrypted, workspace_id: "ws-1", provider: "Tavily", status: "untested", verification_method: "tavily_usage_v1" },
    { id: apiKeyId, secret: encrypted, workspace_id: "ws-2", provider: "Tavily", status: "valid", verification_method: "tavily_usage_v1" },
    { id: apiKeyId, secret: encrypted, workspace_id: "ws-1", provider: "OpenAI", status: "valid", verification_method: "tavily_usage_v1" },
    { id: apiKeyId, secret: encrypted, workspace_id: "ws-1", provider: "Tavily", status: "valid", verification_method: null },
  ]) {
    const refused = await resolveStoredTavilyKey(
      makeFakeSession("ws-1") as never,
      makeFakeApiKeysService(row).client as never,
    );
    ok(`resolveStoredTavilyKey refuses ${String(row.status)} or mismatched authority`, refused === null);
  }

  const { runWebTool } = await import("../src/lib/ai/web-tools");
  const { makeSourcingToolRunner } = await import("../src/lib/ai/sourcing-tools");

  const seenKeys: string[] = [];
  const fakeFetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url) !== "https://api.tavily.com/search") {
      throw new Error(`unexpected fetch: ${String(url)}`);
    }
    const payload = JSON.parse(String(init?.body ?? "{}")) as { api_key?: string; query?: string };
    seenKeys.push(payload.api_key ?? "");
    return {
      ok: true,
      json: async () => ({
        results: [
          {
            title: `Ari Candidate ${payload.api_key ?? ""}`,
            url: `https://www.linkedin.com/in/ari-candidate/${payload.api_key ?? ""}`,
            content: `Result for ${payload.query ?? ""} using ${payload.api_key ?? ""}`,
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  envScope.set({ TAVILY_API_KEY: undefined });
  const sourceRouteSearch = await runWebTool(
    "web_search",
    { query: `site:linkedin.com/in ari ${secret}` },
    { tavilyKey: resolved ?? undefined, fetchImpl: fakeFetch },
  );
  ok("source-route web_search path uses stored Tavily key when env is unset", sourceRouteSearch.ok && seenKeys.at(-1) === secret);
  ok("Tavily key is exactly scrubbed from every returned response field", !JSON.stringify(sourceRouteSearch).includes(secret));

  const markerKey = "[REDACTED]";
  const markerSearch = await runWebTool(
    "web_search",
    { query: `marker collision ${markerKey}` },
    { tavilyKey: markerKey, fetchImpl: fakeFetch },
  );
  ok("marker-shaped Tavily key cannot survive response sanitization", markerSearch.ok && !JSON.stringify(markerSearch).includes(markerKey));

  const fallbackCalls: string[] = [];
  const fallbackFetch = (async (url: unknown) => {
    fallbackCalls.push(String(url));
    if (String(url) === "https://api.tavily.com/search") return new Response("upstream failed", { status: 503 });
    return new Response(
      JSON.stringify({
        Heading: `Fallback ${secret}`,
        AbstractText: `Snippet ${secret}`,
        AbstractURL: `https://example.com/${secret}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const fallbackSearch = await runWebTool(
    "web_search",
    { query: `fallback ${secret}` },
    { tavilyKey: secret, fetchImpl: fallbackFetch },
  );
  ok("a Tavily-key-containing query fails closed when Tavily fails", !fallbackSearch.ok);
  ok(
    "a Tavily-key-containing query is never sent to DuckDuckGo fallback",
    fallbackCalls.length === 1 && fallbackCalls[0] === "https://api.tavily.com/search",
  );

  const encodedKey = "tvly-special/key?part=value&more";
  const encodedFallbackCalls: string[] = [];
  const encodedFallbackFetch = (async (url: unknown) => {
    encodedFallbackCalls.push(String(url));
    if (String(url) === "https://api.tavily.com/search") return new Response("upstream failed", { status: 503 });
    return new Response(JSON.stringify({ Heading: "Fallback", AbstractText: "Result", AbstractURL: "https://example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const encodedFallback = await runWebTool(
    "web_search",
    { query: `fallback ${encodeURIComponent(encodedKey)}` },
    { tavilyKey: encodedKey, fetchImpl: encodedFallbackFetch },
  );
  ok("a URL-encoded Tavily key in a query also fails closed", !encodedFallback.ok);
  ok(
    "a URL-encoded Tavily key never reaches DuckDuckGo fallback",
    encodedFallbackCalls.length === 1 && encodedFallbackCalls[0] === "https://api.tavily.com/search",
  );

  const lowercaseEncodedCalls: string[] = [];
  const lowercaseEncodedFetch = (async (url: unknown) => {
    lowercaseEncodedCalls.push(String(url));
    if (String(url) === "https://api.tavily.com/search") return new Response("upstream failed", { status: 503 });
    return new Response(JSON.stringify({ Heading: "Fallback", AbstractText: "Result", AbstractURL: "https://example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const lowercasePercentEncoding = encodeURIComponent(encodedKey).replace(/%[0-9A-F]{2}/g, (match) => match.toLowerCase());
  const lowercaseEncodedFallback = await runWebTool(
    "web_search",
    { query: `fallback ${lowercasePercentEncoding}` },
    { tavilyKey: encodedKey, fetchImpl: lowercaseEncodedFetch },
  );
  ok("lowercase percent-encoding of a Tavily key fails closed", !lowercaseEncodedFallback.ok);
  ok(
    "lowercase percent-encoding of a Tavily key never reaches DuckDuckGo",
    lowercaseEncodedCalls.length === 1 && lowercaseEncodedCalls[0] === "https://api.tavily.com/search",
  );

  async function encodedFallbackAttempt(representation: string) {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      if (String(url) === "https://api.tavily.com/search") {
        return new Response("upstream failed", { status: 503 });
      }
      return new Response(JSON.stringify({ Heading: "Fallback" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const result = await runWebTool(
      "web_search",
      { query: `fallback ${representation}` },
      { tavilyKey: encodedKey, fetchImpl },
    );
    return { calls, result };
  }

  const partialEncoding = await encodedFallbackAttempt(encodedKey.replace(/\//g, "%2F"));
  ok("a partially percent-encoded Tavily key fails closed", !partialEncoding.result.ok);
  ok(
    "a partially percent-encoded Tavily key never reaches DuckDuckGo",
    partialEncoding.calls.length === 1 && partialEncoding.calls[0] === "https://api.tavily.com/search",
  );

  const doubleEncoding = await encodedFallbackAttempt(encodeURIComponent(encodeURIComponent(encodedKey)));
  ok("a repeatedly percent-encoded Tavily key fails closed", !doubleEncoding.result.ok);
  ok(
    "a repeatedly percent-encoded Tavily key never reaches DuckDuckGo",
    doubleEncoding.calls.length === 1 && doubleEncoding.calls[0] === "https://api.tavily.com/search",
  );

  const seed = buildSeedState();
  const campaign = seed.campaigns[0];
  const runner = makeSourcingToolRunner(campaign, [], campaign.scoringWeights, "", resolved ?? undefined, fakeFetch);
  const runnerResult = await runner.run("search_candidates", {
    platform: "LinkedIn",
    query: "site:linkedin.com/in senior react",
    count: 1,
  });
  ok("makeSourcingToolRunner web_search path uses stored Tavily key when env is unset", runnerResult.ok && seenKeys.at(-1) === secret);

  const envKey = "tvly-env-fallback-123456";
  envScope.set({ TAVILY_API_KEY: envKey });
  const envSearch = await runWebTool("web_search", { query: "site:linkedin.com/in env fallback" }, { fetchImpl: fakeFetch });
  ok("env fallback works when no stored key is passed", envSearch.ok && seenKeys.at(-1) === envKey);

  const explicitNoFallbackCalls: string[] = [];
  const explicitNoFallbackFetch = (async (url: unknown) => {
    explicitNoFallbackCalls.push(String(url));
    if (String(url) === "https://api.tavily.com/search") {
      return new Response("workspace key unavailable", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        Heading: "Tenant-safe keyless result",
        AbstractText: "No shared credential used.",
        AbstractURL: "https://example.com/tenant-safe",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  envScope.set({ DATA_ENCRYPTION_KEY: undefined });
  const decryptFailResolved = await resolveStoredTavilyKey(
    makeFakeSession("ws-1") as never,
    makeFakeApiKeysService({
      id: apiKeyId,
      secret: encrypted,
      workspace_id: "ws-1",
      provider: "Tavily",
      status: "valid",
      verification_method: "tavily_usage_v1",
    }).client as never,
  );
  ok("resolveStoredTavilyKey returns null when stored Tavily decrypt fails", decryptFailResolved === null);
  const decryptFailSearch = await runWebTool(
    "web_search",
    { query: "site:linkedin.com/in tenant-safe fallback" },
    { tavilyKey: decryptFailResolved as never, fetchImpl: explicitNoFallbackFetch },
  );
  ok(
    "an explicit missing workspace Tavily authority uses only the keyless provider",
    decryptFailSearch.ok &&
      explicitNoFallbackCalls.length === 1 &&
      explicitNoFallbackCalls[0]?.startsWith("https://api.duckduckgo.com/") === true,
  );

  const invalid = validateApiKeyFormat("Tavily", "not-a-real-key");
  ok("Tavily validator rejects obvious junk", invalid.valid === false);
  const valid = validateApiKeyFormat("Tavily", "tvly-plausible_123456");
  ok("Tavily validator accepts plausible tvly-prefixed key", valid.valid === true);

  envScope.set({
    DATA_ENCRYPTION_KEY: undefined,
    NODE_ENV: "development",
    NEXT_PUBLIC_ENABLE_DEMO_LOGIN: "false",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });
  ok("encryptionRequiredButMissing blocks real-data workspace without DATA_ENCRYPTION_KEY", encryptionRequiredButMissing());
} finally {
  envScope.restore();
}

console.log(`RESULT web-tavily-key: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
