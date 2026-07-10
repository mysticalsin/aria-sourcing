/* tests/databricks-intake.mts - area: Databricks intake
 * Run: node --import tsx tests/databricks-intake.mts
 */
import { executeNeedsQuery, clearDatabricksTokenCacheForTests } from "../src/lib/integrations/databricks";
import {
  runDatabricksNeedsForWorkspace,
  rowsToProposals,
} from "../src/app/api/integrations/databricks/needs/route";
import type { DatabricksSettings, HermesState } from "../src/lib/types";

let pass = 0,
  fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseCfg: DatabricksSettings = {
  host: "https://93.184.216.34",
  warehouseId: "wh-123",
  authMode: "m2m",
  clientId: "client-123",
  apiKeyId: "key-db",
  needsQuery: "SELECT title, description, location, skills FROM needs WHERE updated_at >= :since",
};

function statementSucceeded(rows: unknown[]) {
  return {
    statement_id: "stmt-1",
    status: { state: "SUCCEEDED" },
    manifest: {
      schema: {
        columns: [
          { name: "title" },
          { name: "description" },
          { name: "location" },
          { name: "skills" },
        ],
      },
    },
    result: { data_array: rows },
  };
}

function fakeSession(cfg: DatabricksSettings) {
  const state = { settings: { databricks: cfg } } as HermesState;
  const calls: string[] = [];
  const query = {
    select: (cols: string) => {
      calls.push(`select:${cols}`);
      return query;
    },
    eq: (col: string, value: unknown) => {
      calls.push(`eq:${col}:${String(value)}`);
      return query;
    },
    maybeSingle: () => Promise.resolve({ data: { state }, error: null }),
  };
  return {
    calls,
    client: {
      rpc: (fn: string) => {
        calls.push(`rpc:${fn}`);
        if (fn === "current_workspace_id") return Promise.resolve({ data: "ws-1", error: null });
        return Promise.resolve({ data: "admin", error: null });
      },
      from: (table: string) => {
        calls.push(`from:${table}`);
        return query;
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }) },
    },
  };
}

function fakeService(secret = "dapi1234567890abcdef") {
  const calls: string[] = [];
  const writes: string[] = [];
  const query = {
    select: (cols: string) => {
      calls.push(`select:${cols}`);
      return query;
    },
    eq: (col: string, value: unknown) => {
      calls.push(`eq:${col}:${String(value)}`);
      return query;
    },
    maybeSingle: () => Promise.resolve({ data: { secret }, error: null }),
    single: () => Promise.resolve({ data: { secret, workspace_id: "ws-1" }, error: null }),
    insert: (value: unknown) => {
      writes.push(`insert:${JSON.stringify(value)}`);
      return query;
    },
    update: (value: unknown) => {
      writes.push(`update:${JSON.stringify(value)}`);
      return query;
    },
    delete: () => {
      writes.push("delete");
      return query;
    },
    upsert: (value: unknown) => {
      writes.push(`upsert:${JSON.stringify(value)}`);
      return query;
    },
  };
  return {
    calls,
    writes,
    client: {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return query;
      },
    },
  };
}

try {
  clearDatabricksTokenCacheForTests();

  {
    let fetches = 0;
    const session = fakeSession({ ...baseCfg, host: "https://10.0.0.5", authMode: "pat" });
    const service = fakeService();
    const res = await runDatabricksNeedsForWorkspace(
      session.client as never,
      { since: "2026-07-10T00:00:00.000Z" },
      {
        serviceClient: service.client as never,
        fetchImpl: (async () => {
          fetches++;
          return responseJson({});
        }) as typeof fetch,
        pollDelayMs: 0,
      },
    );
    const json = (await res.json()) as { ok: boolean; error?: string };
    ok("private Databricks host is rejected", res.status === 400 && json.ok === false);
    ok("private Databricks host is rejected before any fetch", fetches === 0);
  }

  {
    clearDatabricksTokenCacheForTests();
    const calls: { url: string; init?: RequestInit }[] = [];
    const since = "2026-07-10T00:00:00.000Z";
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/oidc/v1/token")) {
        return responseJson({ access_token: "cached-token", expires_in: 3600 });
      }
      return responseJson(statementSucceeded([["Senior Data Engineer", "Build lakehouse pipelines", "Paris", "Python, SQL, Spark"]]));
    }) as typeof fetch;

    const first = await executeNeedsQuery(baseCfg, "oauth-secret-value", { since, fetchImpl, pollDelayMs: 0 });
    const second = await executeNeedsQuery(baseCfg, "oauth-secret-value", { since, fetchImpl, pollDelayMs: 0 });
    const tokenCalls = calls.filter((c) => c.url.endsWith("/oidc/v1/token"));
    const statementCalls = calls.filter((c) => c.url.endsWith("/api/2.0/sql/statements"));
    const tokenAuth = String(tokenCalls[0]?.init?.headers && (tokenCalls[0].init.headers as Record<string, string>).Authorization);
    const statementAuth = String(statementCalls[0]?.init?.headers && (statementCalls[0].init.headers as Record<string, string>).Authorization);
    const body = JSON.parse(String(statementCalls[0]?.init?.body ?? "{}")) as {
      statement?: string;
      parameters?: { name: string; value: string; type: string }[];
    };

    ok("M2M token endpoint is hit once across two calls", tokenCalls.length === 1);
    ok("M2M token request sends HTTP Basic auth", tokenAuth === `Basic ${Buffer.from("client-123:oauth-secret-value").toString("base64")}`);
    ok("Statement requests use cached Bearer token", statementCalls.length === 2 && statementAuth === "Bearer cached-token");
    ok("M2M execute calls succeed", first.ok && second.ok);
    ok("Statement keeps :since marker in SQL", body.statement?.includes(":since") === true);
    ok("Raw since value is not interpolated into SQL", body.statement?.includes(since) === false);
    ok(
      "Statement sends since as typed parameter",
      body.parameters?.[0]?.name === "since" &&
        body.parameters[0].value === since &&
        body.parameters[0].type === "TIMESTAMP",
    );
  }

  {
    const rows = [
      { title: "Senior Data Engineer", description: "Build lakehouse pipelines with Python, SQL, and Spark.", location: "Paris", skills: "Python, SQL, Spark" },
    ];
    const proposals = rowsToProposals(rows);
    ok("JSON_ARRAY rows map to ParsedIntake proposals", proposals.length === 1 && proposals[0].jobAnalysis.title.includes("Data Engineer"));

    const malformedFetch = (async () =>
      responseJson(
        statementSucceeded([
          ["Senior Data Engineer", "Build lakehouse pipelines with Python, SQL, and Spark.", "Paris", "Python, SQL, Spark"],
          ["wrong-column-count"],
          ["Null Role", null, "Paris", "SQL"],
        ]),
      )) as typeof fetch;
    const result = await executeNeedsQuery(
      { ...baseCfg, authMode: "pat" },
      "dapi1234567890abcdef",
      { since: "2026-07-10T00:00:00.000Z", fetchImpl: malformedFetch, pollDelayMs: 0 },
    );
    ok("Malformed JSON_ARRAY rows are skipped without throwing", result.ok && result.rows.length === 1);
  }

  {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/2.0/sql/statements")) {
        return responseJson({ statement_id: "stmt-pending", status: { state: "PENDING" } });
      }
      if (String(url).endsWith("/api/2.0/sql/statements/stmt-pending")) {
        return responseJson(statementSucceeded([["Senior Platform Engineer", "Kubernetes platform work with Go and Terraform.", "Berlin", "Go, Kubernetes, Terraform"]]));
      }
      return responseJson({}, 500);
    }) as typeof fetch;
    const result = await executeNeedsQuery(
      { ...baseCfg, authMode: "pat" },
      "dapi1234567890abcdef",
      { since: "2026-07-10T00:00:00.000Z", fetchImpl, pollDelayMs: 0 },
    );
    ok("PENDING response is polled until SUCCEEDED", result.ok && result.rows.length === 1);
    ok("PENDING path uses statement poll endpoint", calls.some((url) => url.endsWith("/api/2.0/sql/statements/stmt-pending")));
  }

  {
    const session = fakeSession({ ...baseCfg, authMode: "pat" });
    const service = fakeService();
    const fetchImpl = (async () =>
      responseJson(statementSucceeded([["Senior Data Engineer", "Build lakehouse pipelines with Python, SQL, and Spark.", "Paris", "Python, SQL, Spark"]]))) as typeof fetch;
    const res = await runDatabricksNeedsForWorkspace(
      session.client as never,
      { since: "2026-07-10T00:00:00.000Z" },
      { serviceClient: service.client as never, fetchImpl, pollDelayMs: 0 },
    );
    const json = (await res.json()) as { ok: boolean; proposals?: unknown[] };
    ok("Route returns proposed intake drafts", res.status === 200 && json.ok === true && json.proposals?.length === 1);
    ok("Route writes no campaign/store state", service.writes.length === 0 && !session.calls.some((c) => /insert|update|upsert|delete/.test(c)));
  }
} finally {
  clearDatabricksTokenCacheForTests();
}

console.log(`RESULT databricks-intake: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
