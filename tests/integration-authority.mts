import { existsSync, readFileSync } from "node:fs";
import {
  clearDatabricksTokenCacheForTests,
  executeNeedsQuery,
} from "../src/lib/integrations/databricks";
import { isDatabricksOriginAllowed } from "../src/lib/integrations/databricks-origin-policy";
import { normalizeHermesState } from "../src/lib/store/migrations";
import { buildSeedState } from "../src/lib/seed";
import type { DatabricksSettings } from "../src/lib/types";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

function source(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseConfig: DatabricksSettings = {
  host: "https://93.184.216.34",
  warehouseId: "warehouse-1",
  authMode: "m2m",
  clientId: "shared-client-id",
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  needsQuery: "SELECT title FROM hiring_needs WHERE updated_at >= :since",
};
const originalAllowedOrigins = process.env.DATABRICKS_ALLOWED_ORIGINS;

try {
  process.env.DATABRICKS_ALLOWED_ORIGINS = baseConfig.host;
  {
    const current = buildSeedState();
    const polluted = {
      ...current,
      settings: {
        ...current.settings,
        databricks: { host: "https://attacker.example.com", apiKeyId: baseConfig.apiKeyId },
      },
    } as typeof current;
    const normalized = normalizeHermesState(polluted);
    ok(
      "same-version state normalization strips legacy Databricks authority",
      !("databricks" in (normalized.settings as typeof normalized.settings & { databricks?: unknown })),
    );
  }

  ok(
    "Databricks origin policy requires an exact deployment-owned origin",
    isDatabricksOriginAllowed("https://workspace.example.com", {
      DATABRICKS_ALLOWED_ORIGINS: "https://workspace.example.com,https://second.example.com",
    }) &&
      !isDatabricksOriginAllowed("https://attacker.example.com", {
        DATABRICKS_ALLOWED_ORIGINS: "https://workspace.example.com",
      }),
  );
  ok(
    "Databricks origin policy fails closed when absent or URL-ambiguous",
    !isDatabricksOriginAllowed("https://workspace.example.com", {}) &&
      !isDatabricksOriginAllowed("https://workspace.example.com/path", {
        DATABRICKS_ALLOWED_ORIGINS: "https://workspace.example.com",
      }),
  );

  // Behavior first: two tenant/credential authorities that happen to share one
  // Databricks origin and client ID must never reuse each other's bearer token.
  clearDatabricksTokenCacheForTests();
  {
    const calls: { url: string; init?: RequestInit }[] = [];
    let tokenNumber = 0;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/oidc/v1/token")) {
        tokenNumber += 1;
        return responseJson({ access_token: `tenant-token-${tokenNumber}`, expires_in: 3600 });
      }
      return responseJson({
        statement_id: `statement-${tokenNumber}`,
        status: { state: "SUCCEEDED" },
        manifest: { schema: { columns: [{ name: "title" }] } },
        result: { data_array: [["Data Engineer"]] },
      });
    }) as typeof fetch;

    await executeNeedsQuery(baseConfig, "secret-a", {
      since: "2026-07-10T00:00:00.000Z",
      authorityScope: "workspace-a:connection-a:1:key-a",
      fetchImpl,
      pollDelayMs: 0,
    });
    await executeNeedsQuery(
      { ...baseConfig, apiKeyId: "22222222-2222-4222-8222-222222222222" },
      "secret-b",
      {
        since: "2026-07-10T00:00:00.000Z",
        authorityScope: "workspace-b:connection-b:1:key-b",
        fetchImpl,
        pollDelayMs: 0,
      },
    );

    const tokenCalls = calls.filter((call) => call.url.endsWith("/oidc/v1/token"));
    const statementAuth = calls
      .filter((call) => call.url.endsWith("/api/2.0/sql/statements"))
      .map((call) => String((call.init?.headers as Record<string, string> | undefined)?.Authorization));
    ok("M2M token cache is isolated by server authority", tokenCalls.length === 2);
    ok(
      "separate authorities use separate bearer tokens",
      statementAuth[0] === "Bearer tenant-token-1" && statementAuth[1] === "Bearer tenant-token-2",
    );
  }

  const migrationPath = "supabase/migrations/0019_agent_authority_and_integrations.sql";
  const authorityPath = "src/lib/integrations/databricks-authority.ts";
  const configRoutePath = "src/app/api/integrations/databricks/config/route.ts";
  const migration = source(migrationPath);
  const authoritySource = source(authorityPath);
  const configRoute = source(configRoutePath);
  const needsRoute = source("src/app/api/integrations/databricks/needs/route.ts");
  const executionSource = source("src/lib/integrations/databricks.ts");
  const panel = source("src/components/settings/databricks-panel.tsx");

  ok("normalized Databricks authority migration exists", migration.length > 0);
  ok("authority module exists", authoritySource.length > 0);
  ok("admin config route exists", configRoute.length > 0);
  ok("migration creates normalized connections", /create table[^;]+databricks_connections/is.test(migration));
  ok("migration creates append-only config audit", /create table[^;]+databricks_connection_events/is.test(migration));
  ok("migration binds key workspace and provider", /foreign key\s*\(api_key_id,\s*workspace_id,\s*credential_provider\)/i.test(migration));
  ok("migration denies member configuration writes", /current_profile_role\(\)\s*=\s*'admin'/i.test(migration));
  ok(
    "migration grants the server resolver explicit read access",
    /grant\s+select\s+on\s+public\.databricks_connections\s+to\s+service_role/i.test(migration),
  );
  ok("migration strips legacy workspace JSON authority", /strip_legacy_databricks_authority/i.test(migration));
  ok("migration leaves an append boundary for privilege work", /END DATABRICKS AUTHORITY SECTION/i.test(migration));
  ok("config mutations require server admin authority", /requireAdmin\(/.test(configRoute));
  ok("config save enforces the deployment origin allowlist", /isDatabricksOriginAllowed\(origin\)/.test(configRoute));
  ok(
    "config save accepts only a tested valid Databricks key",
    /\.eq\(["']provider["'],\s*["']Databricks["']\)[\s\S]{0,180}\.eq\(["']status["'],\s*["']valid["']\)/.test(configRoute),
  );
  ok("config responses never select or return a secret", !/select\([^)]*secret/i.test(configRoute) && !/\bsecret\s*:/.test(configRoute));
  ok("needs execution no longer reads workspace_state", !/workspace_state/.test(needsRoute));
  ok("needs execution resolves canonical authority", /resolveDatabricksAuthority/.test(needsRoute));
  ok(
    "default Databricks transport uses pinned public egress",
    /fetchPublicUrl/.test(executionSource) && !/opts\.fetchImpl\s*\?\?\s*fetch\b/.test(executionSource),
  );
  ok("settings UI uses the config API", /api\/integrations\/databricks\/config/.test(panel));
  ok("settings UI no longer stores Databricks in shared settings", !/updateSettings|settings\.databricks/.test(panel));

  if (authoritySource.length > 0) {
    const { resolveDatabricksAuthority } = await import("../src/lib/integrations/databricks-authority");
    const calls: string[] = [];
    const connectionRow = {
      id: "33333333-3333-4333-8333-333333333333",
      workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      origin: "https://93.184.216.34",
      warehouse_id: "warehouse-1",
      auth_mode: "m2m",
      client_id: "client-1",
      api_key_id: "11111111-1111-4111-8111-111111111111",
      needs_query: "SELECT title FROM hiring_needs WHERE updated_at >= :since",
      config_revision: 4,
      enabled: true,
    };
    const terminal = async (table: string) => ({
      data: table === "databricks_connections" ? connectionRow : { secret: "stored-secret", status: "valid" },
      error: null,
    });
    const queryFor = (table: string) => {
      const query = {
        select(columns: string) {
          calls.push(`${table}:select:${columns}`);
          return query;
        },
        eq(column: string, value: unknown) {
          calls.push(`${table}:eq:${column}:${String(value)}`);
          return query;
        },
        maybeSingle() {
          return terminal(table);
        },
      };
      return query;
    };
    const session = {
      rpc: async (name: string) => {
        calls.push(`rpc:${name}`);
        return { data: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", error: null };
      },
    };
    const service = {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return queryFor(table);
      },
    };

    const resolved = await resolveDatabricksAuthority(session as never, service as never);
    ok("resolver returns an approved usable authority", resolved.ok === true);
    ok("resolver never loads member-controlled workspace state", !calls.some((call) => call.includes("workspace_state")));
    ok(
      "resolver scopes the secret to workspace, provider, and exact key",
      calls.includes("api_keys:eq:workspace_id:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") &&
        calls.includes("api_keys:eq:provider:Databricks") &&
        calls.includes("api_keys:eq:status:valid") &&
        calls.includes("api_keys:eq:id:11111111-1111-4111-8111-111111111111"),
    );
    ok(
      "resolver creates a revisioned authority cache scope",
      resolved.ok &&
        resolved.authority.authorityScope ===
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:33333333-3333-4333-8333-333333333333:4:11111111-1111-4111-8111-111111111111",
    );

    const failedSession = {
      rpc: async () => ({ data: null, error: { message: "rpc unavailable" } }),
    };
    const failed = await resolveDatabricksAuthority(failedSession as never, service as never);
    ok("workspace RPC errors fail closed as backend errors", !failed.ok && failed.code === "backend_error");
  }
} finally {
  clearDatabricksTokenCacheForTests();
  if (originalAllowedOrigins === undefined) delete process.env.DATABRICKS_ALLOWED_ORIGINS;
  else process.env.DATABRICKS_ALLOWED_ORIGINS = originalAllowedOrigins;
}

console.log(`RESULT integration-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
