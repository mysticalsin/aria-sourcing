import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loadSourcingLoopConfiguration,
  startSourcingLoopHeartbeatPump,
  runSourcingLoopTick,
  REQUISITION_PARSE_DISPATCH_TIMEOUT_MS,
  REQUISITION_PARSE_LEASE_SECONDS,
  REQUISITION_PARSE_CLAIM_LIMIT,
  SOURCING_EXECUTION_DISPATCH_TIMEOUT_MS,
  CAMPAIGN_CREATE_LEASE_SECONDS,
  CAMPAIGN_CREATE_CLAIM_LIMIT,
  SOURCING_LOOP_HEARTBEAT_INTERVAL_MS,
  SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
  delay,
  sourcingLoopCrashReceipt,
} from "../scripts/sourcing-loop-worker.mjs";

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  ARIA_RELEASE_SHA: "a".repeat(40),
  ARIA_WEB_INTERNAL_URL: "http://web.process.aria-mantu-app.internal:3000",
  ARIA_REQUISITION_PARSE_SECRET: "p".repeat(40),
};

const JOB = {
  id: "70000000-0000-4000-8000-000000000001",
  lease_id: "80000000-0000-4000-8000-000000000001",
  workspace_id: "51111111-1111-4111-8111-111111111111",
  kind: "campaign_create",
  payload: { requisition_id: "61111111-1111-4111-8111-111111111111" },
};
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const SOURCING_JOB_ID = "d0000000-0000-4000-8000-000000000001";
const CAMPAIGN_SHA256 = "a".repeat(64);
const WEB_SECRET = "w".repeat(40);
const MIGRATION_0054 = readFileSync(
  new URL("../supabase/migrations/0054_sourcing_batch_authority.sql", import.meta.url),
  "utf8",
);
const MIGRATION_0060 = readFileSync(
  new URL("../supabase/migrations/0060_autonomous_web_sourcing_authority.sql", import.meta.url),
  "utf8",
);
const ROLLBACK_0060 = readFileSync(
  new URL("../supabase/rollbacks/0060_autonomous_web_sourcing_authority.sql", import.meta.url),
  "utf8",
);
const SOURCE_JOB = {
  id: SOURCING_JOB_ID,
  lease_id: "e0000000-0000-4000-8000-000000000001",
  workspace_id: JOB.workspace_id,
  kind: "sourcing_batch",
  payload: {
    campaign_id: CAMPAIGN_ID,
    campaign_sha256: CAMPAIGN_SHA256,
    batch_ordinal: 0,
  },
};
const WEB_LOCATOR = {
  jobId: SOURCE_JOB.id,
  leaseId: SOURCE_JOB.lease_id,
  workspaceId: SOURCE_JOB.workspace_id,
  campaignId: SOURCE_JOB.payload.campaign_id,
  claimToken: "f0000000-0000-4000-8000-000000000001",
  fenceVersion: 1,
};

interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

interface RpcResult {
  data: unknown;
  error: { code: string } | null;
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// claim_due_aria_jobs is called once per enabled handler kind, each
// with its own p_kinds). A kind-blind override would answer both calls
// identically and cross-contaminate the requisition_parse and
// campaign_create claim paths. This keys the response by the exact p_kinds
// the worker actually asked for, defaulting to no work for any kind not
// named in `byKind`.
function claimByKind(byKind: Record<string, unknown[]>) {
  return (params: Record<string, unknown>): RpcResult => {
    const kinds = params.p_kinds as string[];
    const kind = kinds[0];
    return { data: byKind[kind] ?? [], error: null };
  };
}

function makeClient(overrides: Partial<Record<string, (params: Record<string, unknown>) => RpcResult>> = {}) {
  const calls: RpcCall[] = [];
  const defaults: Record<string, (params: Record<string, unknown>) => RpcResult> = {
    record_sourcing_loop_heartbeat: () => ({ data: true, error: null }),
    reap_expired_aria_job_leases: () => ({ data: 0, error: null }),
    reap_expired_agent_framework_leases: () => ({ data: 0, error: null }),
    cleanup_email_ledger_delivery_receipts: () => ({ data: 0, error: null }),
    claim_due_aria_jobs: () => ({ data: [], error: null }),
    claim_due_sourcing_batch_jobs: () => ({ data: [], error: null }),
    finalize_campaign_create_job: () => ({ data: { status: "completed" }, error: null }),
  };
  const behavior = { ...defaults, ...overrides };
  return {
    calls,
    rpc: async (name: string, params: Record<string, unknown>): Promise<RpcResult> => {
      calls.push({ name, params });
      const fn = behavior[name];
      if (!fn) throw new Error(`unexpected rpc: ${name}`);
      return fn(params);
    },
  };
}

test("outbound drain timeout bound stays greater than the 20s model timeout and less than the 120s lease", () => {
  assert.ok(REQUISITION_PARSE_DISPATCH_TIMEOUT_MS > 20_000);
  assert.ok(REQUISITION_PARSE_DISPATCH_TIMEOUT_MS < REQUISITION_PARSE_LEASE_SECONDS * 1_000);
  assert.equal(REQUISITION_PARSE_LEASE_SECONDS, 120);
});

test("claim limit is bounded to exactly one expensive parse job per tick", () => {
  assert.equal(REQUISITION_PARSE_CLAIM_LIMIT, 1);
});

test("heartbeat contract digest exactly binds every deployed loop handler", () => {
  assert.equal(
    SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
    createHash("sha256")
      .update("aria.sourcing-loop-handlers.v1|autonomous_web_sourcing|campaign_create|requisition_parse|sourcing_batch")
      .digest("hex"),
  );
});

function normalizedFunctionDefinition(source: string, signature: string): string {
  const start = source.indexOf(`create or replace function public.${signature}`);
  assert.notEqual(start, -1, `missing function definition for ${signature}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function definition for ${signature}`);
  return source.slice(start, end + 4).replace(/\s+/g, " ").trim();
}

test("0060 readiness uses the worker's four-handler contract and rollback restores 0054 exactly", () => {
  const expectedHandlerIdentity =
    "aria.sourcing-loop-handlers.v1|autonomous_web_sourcing|campaign_create|requisition_parse|sourcing_batch";
  const forwardIdentity = normalizedFunctionDefinition(
    MIGRATION_0060,
    "expected_sourcing_loop_handler_contract_sha256()",
  );
  assert.ok(forwardIdentity.includes(expectedHandlerIdentity));
  assert.equal(
    createHash("sha256").update(expectedHandlerIdentity).digest("hex"),
    SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
  );
  assert.match(
    normalizedFunctionDefinition(MIGRATION_0060, "get_sourcing_loop_readiness(p_release_sha text)"),
    /expected_handler_count constant integer := 4/,
  );
  assert.equal(
    normalizedFunctionDefinition(
      ROLLBACK_0060,
      "expected_sourcing_loop_handler_contract_sha256()",
    ),
    normalizedFunctionDefinition(
      MIGRATION_0054,
      "expected_sourcing_loop_handler_contract_sha256()",
    ),
  );
  assert.equal(
    normalizedFunctionDefinition(
      ROLLBACK_0060,
      "get_sourcing_loop_readiness(p_release_sha text)",
    ),
    normalizedFunctionDefinition(
      MIGRATION_0054,
      "get_sourcing_loop_readiness(p_release_sha text)",
    ),
  );
});

test("configuration: autonomous web dispatch uses a distinct secret and private route", () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  assert.equal(
    String(configuration.sourcingExecutionUrl),
    "http://web.process.aria-mantu-app.internal:3000/api/internal/sourcing-execute",
  );
  assert.equal(configuration.sourcingExecutionSecret, WEB_SECRET);
  assert.ok(SOURCING_EXECUTION_DISPATCH_TIMEOUT_MS < 180_000);

  assert.throws(
    () => loadSourcingLoopConfiguration({
      ...BASE_ENV,
      ARIA_SOURCING_EXECUTION_SECRET: BASE_ENV.ARIA_REQUISITION_PARSE_SECRET,
    }),
    /must be distinct/,
  );
});

test("crash receipts never serialize exception messages or other untrusted material", () => {
  const secretBearingError = new Error("provider-key=must-not-be-logged");
  assert.deepEqual(
    sourcingLoopCrashReceipt("unhandled_rejection", "loop-machine-1", secretBearingError),
    {
      event: "sourcing_loop_crash",
      kind: "unhandled_rejection",
      workerId: "loop-machine-1",
      code: "worker_exception",
    },
  );
});

test("normal loop sleep removes its abort listener after the timer wakes", async () => {
  let listener: (() => void) | null = null;
  let added = 0;
  let removed = 0;
  const signal = {
    aborted: false,
    addEventListener(event: string, callback: () => void) {
      assert.equal(event, "abort");
      listener = callback;
      added += 1;
    },
    removeEventListener(event: string, callback: () => void) {
      assert.equal(event, "abort");
      assert.equal(callback, listener);
      removed += 1;
      listener = null;
    },
  } as unknown as AbortSignal;

  await delay(1, signal);

  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(listener, null);
});

test("configuration: outbound drain defaults off when the flag is absent", () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  assert.equal(configuration.outboundDrainEnabled, false);
});

test("configuration: outbound drain stays off for any value other than the exact string \"true\"", () => {
  for (const value of ["1", "yes", "TRUE", " true", "true "]) {
    const configuration = loadSourcingLoopConfiguration({ ...BASE_ENV, ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: value });
    assert.equal(configuration.outboundDrainEnabled, false, `expected false for ${JSON.stringify(value)}`);
  }
});

test("configuration: outbound drain turns on only for the exact string \"true\"", () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "true",
    CRON_SECRET: "c".repeat(40),
  });
  assert.equal(configuration.outboundDrainEnabled, true);
});

test("configuration: parse dispatch requires a dedicated secret and a Fly-private or loopback origin", () => {
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...BASE_ENV, ARIA_REQUISITION_PARSE_SECRET: "short" }),
    /invalid ARIA_REQUISITION_PARSE_SECRET/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...BASE_ENV, ARIA_WEB_INTERNAL_URL: "https://attacker.example" }),
    /invalid ARIA_WEB_INTERNAL_URL/,
  );
  for (const origin of [
    "http://user:pass@web.process.aria-mantu-app.internal:3000",
    "http://web.process.aria-mantu-app.internal:3000/base",
    "http://web.process.aria-mantu-app.internal:3000?token=leak",
    "http://web.process.aria-mantu-app.internal:3000#fragment",
  ]) {
    assert.throws(
      () => loadSourcingLoopConfiguration({ ...BASE_ENV, ARIA_WEB_INTERNAL_URL: origin }),
      /invalid ARIA_WEB_INTERNAL_URL/,
      origin,
    );
  }
  assert.doesNotThrow(() => loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_WEB_INTERNAL_URL: "http://127.0.0.1:3000",
  }));
});

test("configuration: outbound drain needs its own distinct secret only when explicitly enabled", () => {
  assert.doesNotThrow(() => loadSourcingLoopConfiguration(BASE_ENV));
  assert.throws(
    () => loadSourcingLoopConfiguration({ ...BASE_ENV, ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "true" }),
    /invalid CRON_SECRET/,
  );
  assert.throws(
    () => loadSourcingLoopConfiguration({
      ...BASE_ENV,
      ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "true",
      CRON_SECRET: BASE_ENV.ARIA_REQUISITION_PARSE_SECRET,
    }),
    /must be distinct/,
  );
});

test("tick: every kill-switch value except exact false causes zero RPC and HTTP side effects", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  for (const value of [undefined, "", "False", "FALSE", "true", "0", " false"] as const) {
    let rpcCalls = 0;
    let httpCalls = 0;
    const client = {
      async rpc() {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    };
    const result = await runSourcingLoopTick(
      client,
      configuration,
      value === undefined ? {} : { ARIA_LOOP_KILL_SWITCH: value },
      (async () => { httpCalls += 1; return okJson({ ok: true }); }) as unknown as typeof fetch,
    );
    assert.deepEqual(result, { status: "kill_switch_engaged" });
    assert.equal(rpcCalls, 0);
    assert.equal(httpCalls, 0);
  }
});

test("tick: heartbeat advertises the exact handler contract and never calls the legacy RPC", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient();

  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async () => okJson({ ok: true })) as unknown as typeof fetch,
  );

  assert.equal(result.status, "ok");
  assert.deepEqual(
    client.calls.filter((call) => call.name === "record_sourcing_loop_heartbeat"),
    [{
      name: "record_sourcing_loop_heartbeat",
      params: {
        p_worker_id: "loop-local",
        p_release_sha: "a".repeat(40),
        p_handler_contract_sha256: SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
      },
    }],
  );
  assert.equal(client.calls.some((call) => call.name === "record_loop_worker_heartbeat"), false);
});

test("tick: a malformed heartbeat success is degraded", async () => {
  for (const data of [null, false, "true", { recorded: true }]) {
    const configuration = loadSourcingLoopConfiguration(BASE_ENV);
    const client = makeClient({
      record_sourcing_loop_heartbeat: () => ({ data, error: null }),
    });

    const result = await runSourcingLoopTick(
      client,
      configuration,
      { ARIA_LOOP_KILL_SWITCH: "false" },
      (async () => okJson({ ok: true })) as unknown as typeof fetch,
    );

    assert.equal(result.status, "degraded");
    assert.deepEqual(result.failureCodes, ["heartbeat:response_invalid"]);
  }
});

test("tick: upstream RPC error payloads are reduced to fixed operational codes", async () => {
  const tenantMarker = `tenant_${JOB.workspace_id}`;
  const rpcFailure = () => ({ data: null, error: { code: tenantMarker } });
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    record_sourcing_loop_heartbeat: rpcFailure,
    reap_expired_aria_job_leases: rpcFailure,
    reap_expired_agent_framework_leases: rpcFailure,
    cleanup_email_ledger_delivery_receipts: rpcFailure,
    claim_due_sourcing_batch_jobs: rpcFailure,
    claim_due_aria_jobs: rpcFailure,
  });

  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    async () => okJson({ ok: true }),
  );

  assert.deepEqual(result.failureCodes, [
    "heartbeat:rpc_error",
    "job_reap:rpc_error",
    "framework_reap:rpc_error",
    "receipt_gc:rpc_error",
    "claim:rpc_error",
    "requisition_parse_claim:rpc_error",
    "campaign_create_claim:rpc_error",
  ]);
  assert.equal(JSON.stringify(result.failureCodes).includes(tenantMarker), false);
});

test("heartbeat pump records exact-release liveness independently of tick completion", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient();
  const controller = new AbortController();
  const delays: number[] = [];
  const cancelled: unknown[] = [];
  const events: Record<string, unknown>[] = [];
  let nextHandle = 0;
  const pump = startSourcingLoopHeartbeatPump({
    client,
    configuration,
    environment: { ARIA_LOOP_KILL_SWITCH: "false" },
    signal: controller.signal,
    logger: (event: Record<string, unknown>) => { events.push(event); },
    schedule: (_callback: () => void, milliseconds: number) => {
      delays.push(milliseconds);
      nextHandle += 1;
      return nextHandle;
    },
    cancel: (handle: unknown) => { cancelled.push(handle); },
  });

  assert.deepEqual(delays, [SOURCING_LOOP_HEARTBEAT_INTERVAL_MS]);
  assert.equal(client.calls.length, 0, "the pump does not race the tick's initial heartbeat");
  await pump.pulse();
  assert.deepEqual(
    client.calls,
    [{
      name: "record_sourcing_loop_heartbeat",
      params: {
        p_worker_id: "loop-local",
        p_release_sha: "a".repeat(40),
        p_handler_contract_sha256: SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
      },
    }],
  );
  assert.equal(events.at(-1)?.status, "ok");
  assert.deepEqual(delays, [SOURCING_LOOP_HEARTBEAT_INTERVAL_MS, SOURCING_LOOP_HEARTBEAT_INTERVAL_MS]);

  controller.abort();
  assert.ok(cancelled.length >= 2, "manual pulse and abort both clear their pending timers");
});

test("heartbeat pump remains dark while the process kill switch is engaged", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient();
  const controller = new AbortController();
  const pump = startSourcingLoopHeartbeatPump({
    client,
    configuration,
    environment: { ARIA_LOOP_KILL_SWITCH: "true" },
    signal: controller.signal,
    schedule: () => 1,
    cancel: () => undefined,
  });
  await pump.pulse();
  assert.equal(client.calls.length, 0);
  controller.abort();
});

test("tick: parse dispatch is configured but outbound send drain is never fetched by default", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  assert.ok(configuration.requisitionParseUrl, "parse dispatch URL should be configured");
  assert.equal(configuration.dispatchUrl, null, "outbound URL stays absent while drain is disabled");
  assert.equal(configuration.outboundDrainEnabled, false);

  const client = makeClient();
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string | URL): Promise<Response> => {
    fetchedUrls.push(String(url));
    return okJson({ ok: true });
  };

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, fetcher as unknown as typeof fetch);
  assert.equal(result.dispatch, "disabled");
  assert.ok(!fetchedUrls.some((url) => url.includes("/api/cron/dispatch-outbound")));
});

test("tick: enabling the explicit flag does drain outbound", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "true",
    CRON_SECRET: "c".repeat(40),
  });
  const client = makeClient();
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string | URL): Promise<Response> => {
    fetchedUrls.push(String(url));
    return okJson({ ok: true });
  };

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, fetcher as unknown as typeof fetch);
  assert.equal(result.dispatch, "ok");
  assert.ok(fetchedUrls.some((url) => url.includes("/api/cron/dispatch-outbound")));
});

test("tick: claims requisition_parse jobs with exact lease seconds and a limit of one", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient();
  const fetcher = async (): Promise<Response> => okJson({ ok: true });

  await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, fetcher);
  const claimCall = client.calls.find(
    (c) => c.name === "claim_due_aria_jobs"
      && (c.params.p_kinds as string[])[0] === "requisition_parse",
  );
  assert.ok(claimCall);
  assert.equal(claimCall.params.p_lease_seconds, 120);
  assert.equal(claimCall.params.p_limit, 1);
  assert.deepEqual(claimCall.params.p_kinds, ["requisition_parse"]);
});

test("tick: an oversized claim response is degraded and dispatches no paid work", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const secondJob = {
    ...JOB,
    id: "70000000-0000-4000-8000-000000000002",
    lease_id: "80000000-0000-4000-8000-000000000002",
  };
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ requisition_parse: [JOB, secondJob] }),
  });
  let dispatches = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async () => { dispatches += 1; return okJson({ ok: true }); }) as unknown as typeof fetch,
  );
  assert.equal(result.status, "degraded");
  assert.equal(result.requisitionParseClaimed, 2);
  assert.deepEqual(result.failureCodes, ["requisition_parse_claim:response_limit_exceeded"]);
  assert.equal(dispatches, 0);
});

test("tick: a non-array claim response is degraded instead of silently treated as no work", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: (params) =>
      (params.p_kinds as string[])[0] === "requisition_parse"
        ? { data: { unexpected: "shape" }, error: null }
        : { data: [], error: null },
  });
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async () => okJson({ ok: true })) as unknown as typeof fetch,
  );
  assert.equal(result.status, "degraded");
  assert.equal(result.requisitionParseClaimed, 0);
  assert.deepEqual(result.failureCodes, ["requisition_parse_claim:response_invalid"]);
});

test("tick: an exact claimed job is dispatched to the requisition-parse route with its own id/lease/workspace/requisition", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ requisition_parse: [JOB] }),
  });
  const dispatchedRequests: { url: string; authorization: string | null; body: unknown }[] = [];
  const fetcher = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(url).includes("/api/internal/requisition-parse")) {
      dispatchedRequests.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return okJson({ ok: true, outcome: { outcome: "completed", ready: true } });
    }
    return okJson({ ok: true });
  };

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, fetcher as unknown as typeof fetch);
  assert.equal(result.requisitionParseClaimed, 1);
  assert.equal(dispatchedRequests.length, 1);
  assert.equal(
    dispatchedRequests[0].authorization,
    `Bearer ${BASE_ENV.ARIA_REQUISITION_PARSE_SECRET}`,
  );
  assert.deepEqual(dispatchedRequests[0].body, {
    jobId: JOB.id,
    leaseId: JOB.lease_id,
    workspaceId: JOB.workspace_id,
    requisitionId: JOB.payload.requisition_id,
  });
  assert.equal(result.failureCodes.length, 0);
});

test("tick: a 200 handler body that reports unavailable is rejected as a failure", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ requisition_parse: [JOB] }),
  });
  const fetcher = async (): Promise<Response> =>
    okJson({ ok: true, outcome: { outcome: "unavailable", reason: "service_client_unavailable" } });

  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    fetcher as unknown as typeof fetch,
  );
  assert.deepEqual(result.failureCodes, [
    "requisition_parse:response_invalid",
  ]);
});

test("tick: a malformed 200 handler body is rejected as a failure", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ requisition_parse: [JOB] }),
  });
  const fetcher = async (): Promise<Response> => okJson({ ok: true });

  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    fetcher as unknown as typeof fetch,
  );
  assert.deepEqual(result.failureCodes, [
    "requisition_parse:response_invalid",
  ]);
});

test("tick: terminal or retry outcomes without a bounded reason are rejected", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  for (const outcome of [
    { outcome: "dead_lettered" },
    { outcome: "dead_lettered", reason: 503 },
    { outcome: "retry_scheduled", reason: "" },
    { outcome: "dead_lettered", reason: "x".repeat(2_001) },
  ]) {
    const client = makeClient({
      claim_due_aria_jobs: claimByKind({ requisition_parse: [JOB] }),
    });
    const fetcher = async (): Promise<Response> => okJson({ ok: true, outcome });
    const result = await runSourcingLoopTick(
      client,
      configuration,
      { ARIA_LOOP_KILL_SWITCH: "false" },
      fetcher as unknown as typeof fetch,
    );
    assert.deepEqual(result.failureCodes, [
      "requisition_parse:response_invalid",
    ]);
  }
});

test("tick: a general-role sourcing job is authorized before GitHub and dispatched with only its web locator", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: { status: "authorized", locator: WEB_LOCATOR },
      error: null,
    }),
  });
  let githubCalls = 0;
  const dispatched: Array<{ url: string; authorization: string | null; body: unknown }> = [];
  const fetcher = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (String(input).endsWith("/api/internal/sourcing-execute")) {
      dispatched.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      });
      return okJson({
        ok: true,
        outcome: { outcome: "completed", candidateCount: 1, queryCount: 1 },
      });
    }
    return okJson({ ok: true });
  };

  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    fetcher,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 0, queryCount: 1 };
      },
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.completed, 1);
  assert.equal(githubCalls, 0);
  assert.deepEqual(client.calls.find(({ name }) => name === "authorize_autonomous_web_sourcing"), {
    name: "authorize_autonomous_web_sourcing",
    params: {
      p_job_id: SOURCE_JOB.id,
      p_lease_id: SOURCE_JOB.lease_id,
      p_workspace_id: SOURCE_JOB.workspace_id,
      p_campaign_id: SOURCE_JOB.payload.campaign_id,
      p_campaign_sha256: SOURCE_JOB.payload.campaign_sha256,
      p_batch_ordinal: SOURCE_JOB.payload.batch_ordinal,
    },
  });
  assert.deepEqual(dispatched, [{
    url: "http://web.process.aria-mantu-app.internal:3000/api/internal/sourcing-execute",
    authorization: `Bearer ${WEB_SECRET}`,
    body: WEB_LOCATOR,
  }]);
});

test("tick: a bounded autonomous web retry outcome is counted without GitHub fallback", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: { status: "authorized", locator: WEB_LOCATOR },
      error: null,
    }),
  });
  let githubCalls = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async (input) => String(input).endsWith("/api/internal/sourcing-execute")
      ? okJson({ ok: true, outcome: { outcome: "retry_scheduled", reason: "search_rate_limited" } })
      : okJson({ ok: true })) as typeof fetch,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.retryScheduled, 1);
  assert.equal(result.failureCodes.length, 0);
  assert.equal(githubCalls, 0);
});

test("tick: only an exact web-policy exclusion falls through to the existing GitHub authority", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: { status: "role_not_approved_for_web" },
      error: null,
    }),
  });
  let githubCalls = 0;
  let webDispatches = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async (input) => {
      if (String(input).endsWith("/api/internal/sourcing-execute")) webDispatches += 1;
      return okJson({ ok: true });
    }) as typeof fetch,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );
  assert.equal(result.status, "ok");
  assert.equal(result.completed, 1);
  assert.equal(githubCalls, 1);
  assert.equal(webDispatches, 0);
});

test("tick: an exact prior-GitHub lane conflict resumes GitHub without web egress", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: { status: "provider_lane_conflict" },
      error: null,
    }),
  });
  let githubCalls = 0;
  let webDispatches = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async (input) => {
      if (String(input).endsWith("/api/internal/sourcing-execute")) webDispatches += 1;
      return okJson({ ok: true });
    }) as typeof fetch,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.completed, 1);
  assert.equal(githubCalls, 1);
  assert.equal(webDispatches, 0);
});

test("tick: a malformed provider-lane conflict never selects GitHub", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: { status: "provider_lane_conflict", jobId: SOURCE_JOB.id },
      error: null,
    }),
  });
  let githubCalls = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async () => okJson({ ok: true })) as typeof fetch,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );

  assert.equal(result.status, "degraded");
  assert.deepEqual(result.failureCodes, ["sourcing_batch:unavailable"]);
  assert.equal(githubCalls, 0);
});

test("tick: a durable autonomous-web replay never dispatches or falls through to GitHub", async () => {
  const configuration = loadSourcingLoopConfiguration({
    ...BASE_ENV,
    ARIA_SOURCING_EXECUTION_SECRET: WEB_SECRET,
  });
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    authorize_autonomous_web_sourcing: () => ({
      data: {
        status: "no_op_replay",
        jobId: SOURCE_JOB.id,
        resultSha256: "3".repeat(64),
        candidateCount: 1,
        queryCount: 1,
      },
      error: null,
    }),
  });
  let paidCalls = 0;
  let githubCalls = 0;
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    (async () => { paidCalls += 1; return okJson({ ok: true }); }) as typeof fetch,
    {
      handleSourcingBatchJob: async () => {
        githubCalls += 1;
        return { outcome: "completed", candidateCount: 1, queryCount: 1 };
      },
    },
  );
  assert.equal(result.status, "ok");
  assert.equal(result.replayed, 1);
  assert.equal(paidCalls, 0);
  assert.equal(githubCalls, 0);
});

test("tick: claims campaign_create jobs separately from parse jobs with their own lease seconds and kind", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  assert.equal(CAMPAIGN_CREATE_LEASE_SECONDS, 180);
  assert.ok(CAMPAIGN_CREATE_LEASE_SECONDS > 2 * 60, "lease covers finalize plus fail at maximum RPC timeout");
  assert.equal(CAMPAIGN_CREATE_CLAIM_LIMIT, 5);
  const client = makeClient();

  await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, async () => okJson({ ok: true }));
  const claimCalls = client.calls.filter((c) => c.name === "claim_due_aria_jobs");
  assert.equal(claimCalls.length, 2);
  const sourcingClaimCalls = client.calls.filter((c) => c.name === "claim_due_sourcing_batch_jobs");
  assert.equal(sourcingClaimCalls.length, 1);
  const campaignClaimCall = claimCalls.find((c) => (c.params.p_kinds as string[])[0] === "campaign_create");
  assert.ok(campaignClaimCall, "expected a separate claim_due_aria_jobs call for campaign_create");
  assert.equal(campaignClaimCall.params.p_lease_seconds, CAMPAIGN_CREATE_LEASE_SECONDS);
  assert.equal(campaignClaimCall.params.p_limit, CAMPAIGN_CREATE_CLAIM_LIMIT);
  assert.deepEqual(campaignClaimCall.params.p_kinds, ["campaign_create"]);
});

test("tick: an oversized campaign_create claim response is degraded and finalizes no jobs", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const jobs = Array.from({ length: CAMPAIGN_CREATE_CLAIM_LIMIT + 1 }, (_, index) => ({
    ...JOB,
    id: `70000000-0000-4000-8000-00000000009${index}`,
  }));
  let finalizeCalls = 0;
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ campaign_create: jobs }),
    finalize_campaign_create_job: () => {
      finalizeCalls += 1;
      return { data: { status: "completed" }, error: null };
    },
  });

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, async () => okJson({ ok: true }));
  assert.equal(result.status, "degraded");
  assert.equal(result.campaignCreateClaimed, CAMPAIGN_CREATE_CLAIM_LIMIT + 1);
  assert.deepEqual(result.failureCodes, ["campaign_create_claim:response_limit_exceeded"]);
  assert.equal(finalizeCalls, 0);
});

test("tick: a completed campaign_create job is claimed and finalized with no failure codes", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  let finalizeParams: Record<string, unknown> | undefined;
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ campaign_create: [JOB] }),
    finalize_campaign_create_job: (params) => {
      finalizeParams = params;
      return {
        data: {
          status: "completed",
          job_id: JOB.id,
          campaign_id: CAMPAIGN_ID,
          campaign_sha256: CAMPAIGN_SHA256,
          sourcing_job_id: SOURCING_JOB_ID,
        },
        error: null,
      };
    },
  });

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, async () => okJson({ ok: true }));
  assert.equal(result.campaignCreateClaimed, 1);
  assert.equal(result.failureCodes.length, 0);
  assert.deepEqual(finalizeParams, {
    p_job_id: JOB.id,
    p_lease_id: JOB.lease_id,
    p_workspace_id: JOB.workspace_id,
    p_requisition_id: JOB.payload.requisition_id,
  });
});

test("tick: a campaign_create claim RPC error is recorded as a failure code", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: (params) =>
      (params.p_kinds as string[])[0] === "campaign_create"
        ? { data: null, error: { code: "rpc_unavailable" } }
        : { data: [], error: null },
  });

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, async () => okJson({ ok: true }));
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.failureCodes, ["campaign_create_claim:rpc_error"]);
});

test("tick: a campaign_create RPC transport error remains read-only and degrades the worker", async () => {
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_aria_jobs: claimByKind({ campaign_create: [JOB] }),
    finalize_campaign_create_job: () => ({ data: null, error: { code: "rpc_unavailable" } }),
  });

  const result = await runSourcingLoopTick(client, configuration, { ARIA_LOOP_KILL_SWITCH: "false" }, async () => okJson({ ok: true }));
  assert.equal(result.campaignCreateClaimed, 1);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.failureCodes, [
    "campaign_create:unavailable",
  ]);
});

test("tick: every non-success campaign outcome is observable and degraded", async () => {
  const cases = [
    { finalStatus: "requisition_not_ready", failResult: "dead", expectedOutcome: "dead_lettered" },
    { finalStatus: "sourcing_disabled", failResult: "queued", expectedOutcome: "retry_scheduled" },
    { finalStatus: "lease_mismatch", failResult: null, expectedOutcome: "stale_lease" },
  ];
  for (const scenario of cases) {
    const configuration = loadSourcingLoopConfiguration(BASE_ENV);
    const client = makeClient({
      claim_due_aria_jobs: claimByKind({ campaign_create: [JOB] }),
      finalize_campaign_create_job: () => ({ data: { status: scenario.finalStatus }, error: null }),
      fail_aria_job: () => ({ data: scenario.failResult, error: null }),
    });
    const result = await runSourcingLoopTick(
      client,
      configuration,
      { ARIA_LOOP_KILL_SWITCH: "false" },
      async () => okJson({ ok: true }),
    );
    assert.equal(result.status, "degraded");
    assert.deepEqual(result.failureCodes, [
      `campaign_create:${scenario.expectedOutcome}`,
    ]);
  }
});

test("tick: failure codes retain bounded categories without job or tenant identifiers", async () => {
  const tenantMarker = `tenant_${JOB.workspace_id}`;
  const configuration = loadSourcingLoopConfiguration(BASE_ENV);
  const client = makeClient({
    claim_due_sourcing_batch_jobs: () => ({ data: [SOURCE_JOB], error: null }),
    claim_due_aria_jobs: claimByKind({ campaign_create: [JOB] }),
  });
  const result = await runSourcingLoopTick(
    client,
    configuration,
    { ARIA_LOOP_KILL_SWITCH: "false" },
    async () => okJson({ ok: true }),
    {
      handleSourcingBatchJob: async () => ({ outcome: "unavailable", reason: "tenant_acme" }),
      handleCampaignCreateJob: async () => ({ outcome: "unavailable", reason: tenantMarker }),
    },
  );

  assert.deepEqual(result.failureCodes, [
    "sourcing_batch:unavailable",
    "campaign_create:unavailable",
  ]);
  const serialized = JSON.stringify(result.failureCodes);
  for (const identifier of [
    JOB.id,
    JOB.lease_id,
    JOB.workspace_id,
    SOURCE_JOB.id,
    SOURCE_JOB.lease_id,
    "tenant_acme",
    tenantMarker,
  ]) {
    assert.equal(serialized.includes(identifier), false);
  }
  assert.ok(result.failureCodes.every((code) => /^[a-z_]+:[a-z0-9_]+$/.test(code)));
});
