import { createRequire } from "module";
import { buildSeedState } from "../src/lib/seed";
import { encryptSecret, decryptSecret, encryptionRequiredButMissing } from "../src/lib/crypto-secrets";
import { validateApiKeyFormat } from "../src/lib/providers";
import { resolveStoredTavilyKey } from "../src/lib/sourcing/tavily";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const dnsPromises = require("dns/promises") as { lookup: unknown };
const originalLookup = dnsPromises.lookup;

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
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  const secret = "tvly-stored-key-123456";
  const encrypted = encryptSecret(secret);
  ok("encryptSecret returns ciphertext when key is configured", encrypted.startsWith("enc:v1:") && encrypted !== secret);
  ok("encryptSecret round-trips with decryptSecret", decryptSecret(encrypted) === secret);

  const fake = makeFakeApiKeysService({ secret: encrypted });
  const resolved = await resolveStoredTavilyKey(makeFakeSession("ws-1") as never, fake.client as never);
  ok("resolveStoredTavilyKey returns decrypted workspace key", resolved === secret);
  ok(
    "resolveStoredTavilyKey queries the workspace-scoped Tavily api_keys row",
    fake.calls.includes("from:api_keys") &&
      fake.calls.includes("select:secret") &&
      fake.filters.some((f) => f.col === "workspace_id" && f.value === "ws-1") &&
      fake.filters.some((f) => f.col === "provider" && f.value === "Tavily"),
  );

  dnsPromises.lookup = async () => [{ address: "1.1.1.1", family: 4 }];
  const { runWebTool } = await import("../src/lib/ai/web-tools");
  const { makeSourcingToolRunner } = await import("../src/lib/ai/sourcing-tools");

  const seenKeys: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
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
            title: "Ari Candidate",
            url: "https://www.linkedin.com/in/ari-candidate",
            content: `Result for ${payload.query ?? ""}`,
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  delete process.env.TAVILY_API_KEY;
  const sourceRouteSearch = await runWebTool("web_search", { query: "site:linkedin.com/in ari" }, { tavilyKey: resolved ?? undefined });
  ok("source-route web_search path uses stored Tavily key when env is unset", sourceRouteSearch.ok && seenKeys.at(-1) === secret);

  const seed = buildSeedState();
  const campaign = seed.campaigns[0];
  const runner = makeSourcingToolRunner(campaign, [], campaign.scoringWeights, "", resolved ?? undefined);
  const runnerResult = await runner.run("search_candidates", {
    platform: "LinkedIn",
    query: "site:linkedin.com/in senior react",
    count: 1,
  });
  ok("makeSourcingToolRunner web_search path uses stored Tavily key when env is unset", runnerResult.ok && seenKeys.at(-1) === secret);

  const envKey = "tvly-env-fallback-123456";
  process.env.TAVILY_API_KEY = envKey;
  const envSearch = await runWebTool("web_search", { query: "site:linkedin.com/in env fallback" });
  ok("env fallback works when no stored key is passed", envSearch.ok && seenKeys.at(-1) === envKey);

  delete process.env.DATA_ENCRYPTION_KEY;
  const decryptFailResolved = await resolveStoredTavilyKey(makeFakeSession("ws-1") as never, makeFakeApiKeysService({ secret: encrypted }).client as never);
  ok("resolveStoredTavilyKey returns null when stored Tavily decrypt fails", decryptFailResolved === null);
  const decryptFailSearch = await runWebTool("web_search", { query: "site:linkedin.com/in decrypt fallback" }, { tavilyKey: decryptFailResolved ?? undefined });
  ok("env fallback works when stored Tavily decrypt fails", decryptFailSearch.ok && seenKeys.at(-1) === envKey);

  const invalid = validateApiKeyFormat("Tavily", "not-a-real-key");
  ok("Tavily validator rejects obvious junk", invalid.valid === false);
  const valid = validateApiKeyFormat("Tavily", "tvly-plausible_123456");
  ok("Tavily validator accepts plausible tvly-prefixed key", valid.valid === true);

  delete process.env.DATA_ENCRYPTION_KEY;
  process.env.NODE_ENV = "development";
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  ok("encryptionRequiredButMissing blocks real-data workspace without DATA_ENCRYPTION_KEY", encryptionRequiredButMissing());
} finally {
  globalThis.fetch = originalFetch;
  dnsPromises.lookup = originalLookup;
  process.env = originalEnv;
}

console.log(`RESULT web-tavily-key: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
