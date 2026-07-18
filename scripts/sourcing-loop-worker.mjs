// sourcing-loop-worker.mjs — the autonomous-loop tick worker (PLAN.md Rock 1).
//
// ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
// 2026-07-23); Owner acknowledged hybrid build in-conversation (meeting 024).
//
// Runs as its own Fly process group ("loop"). Every tick, in order:
//   1. Global kill switch — fail-closed: anything but the exact string
//      "false" in ARIA_LOOP_KILL_SWITCH means the tick does NOTHING (no DB
//      writes, no HTTP). The loop ships dark by default.
//   2. record_loop_worker_heartbeat (worker id + release sha).
//   3. Lease reapers: reap_expired_aria_job_leases (crash recovery for the
//      job spine) + reap_expired_agent_framework_leases (closes the 0029
//      reaper gap).
//   4. Outbound drain: GET /api/cron/dispatch-outbound on the web process
//      (Bearer CRON_SECRET) — the EXACT route the daily Vercel cron hits, so
//      every send-side guardrail (approval re-verification, suppression,
//      quiet hours, atomic claims) is reused verbatim, just minute-level
//      instead of daily. No dispatch logic is duplicated here.
//   5. Job claim loop: claim_due_aria_jobs for the kinds this worker has
//      handlers for. Rock 1 registers NO handlers — the spine is proven by
//      the DB suite; producers/handlers arrive with Rocks 2-5.
//
// Conventions follow scripts/agent-framework-heartbeat-worker.mjs: pure
// exported functions, bounded reads, JSON-line logging, exit code 78 on
// invalid configuration, AbortController shutdown on SIGINT/SIGTERM.

import { pathToFileURL } from "node:url";

const SHA1_RE = /^[0-9a-f]{40}$/;
const WORKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DISPATCH_TIMEOUT_MS = 55_000;
const RPC_RESPONSE_BYTES = 256_000;
const HANDLER_KINDS = Object.freeze([]); // Rock 1: spine only — no job handlers yet.

function boundedInteger(value, fallback, minimum, maximum, name) {
  const raw = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(raw) || raw < minimum || raw > maximum) {
    throw new Error(`invalid ${name}`);
  }
  return raw;
}

function validServiceToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && !/\s/.test(value);
}

export function loadSourcingLoopConfiguration(environment) {
  const supabaseUrl = environment.SUPABASE_URL ?? "";
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const releaseSha = (environment.ARIA_RELEASE_SHA ?? "").toLowerCase();
  let endpoint;
  try {
    endpoint = new URL(supabaseUrl);
  } catch {
    throw new Error("invalid SUPABASE_URL");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("invalid SUPABASE_URL");
  }
  if (!validServiceToken(serviceRoleKey)) {
    throw new Error("invalid SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!SHA1_RE.test(releaseSha)) {
    throw new Error("invalid ARIA_RELEASE_SHA");
  }

  const workerId = environment.ARIA_LOOP_WORKER_ID
    ?? (environment.FLY_MACHINE_ID ? `loop-${environment.FLY_MACHINE_ID}` : "loop-local");
  if (!WORKER_ID_RE.test(workerId)) {
    throw new Error("invalid ARIA_LOOP_WORKER_ID");
  }

  // Dispatch drain is optional-by-absence (the Vercel cron backstop still
  // exists) but invalid-by-misconfiguration: a present-but-broken value is a
  // configuration failure, not a silent skip.
  const webOrigin = environment.ARIA_WEB_INTERNAL_URL ?? "";
  const cronSecret = environment.CRON_SECRET ?? "";
  let dispatchUrl = null;
  if (webOrigin !== "" || cronSecret !== "") {
    let parsed;
    try {
      parsed = new URL("/api/cron/dispatch-outbound", webOrigin);
    } catch {
      throw new Error("invalid ARIA_WEB_INTERNAL_URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid ARIA_WEB_INTERNAL_URL");
    }
    if (!validServiceToken(cronSecret)) {
      throw new Error("invalid CRON_SECRET");
    }
    dispatchUrl = parsed;
  }

  return {
    supabaseUrl: endpoint,
    serviceRoleKey,
    releaseSha,
    workerId,
    dispatchUrl,
    cronSecret,
    tickMs: boundedInteger(environment.ARIA_LOOP_TICK_MS, DEFAULT_TICK_MS, 5_000, 300_000, "ARIA_LOOP_TICK_MS"),
    timeoutMs: boundedInteger(environment.ARIA_LOOP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000, "ARIA_LOOP_TIMEOUT_MS"),
  };
}

export function killSwitchEngaged(environment) {
  // Fail-closed: only the exact string "false" disengages.
  return (environment.ARIA_LOOP_KILL_SWITCH ?? "") !== "false";
}

async function readBoundedJson(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("response_size_invalid");
    }
  }
  const text = await response.text();
  if (text.length > maximumBytes) throw new Error("response_size_invalid");
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("response_json_invalid");
  }
}

export function createLoopRpcClient(configuration, fetcher = fetch) {
  async function rpc(name, args) {
    const target = new URL(`/rest/v1/rpc/${name}`, configuration.supabaseUrl);
    let response;
    try {
      response = await fetcher(target, {
        method: "POST",
        headers: {
          apikey: configuration.serviceRoleKey,
          authorization: `Bearer ${configuration.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args ?? {}),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
    } catch {
      return { data: null, error: { code: "rpc_unavailable" } };
    }
    if (!response.ok) {
      return { data: null, error: { code: `rpc_http_${response.status}` } };
    }
    try {
      return { data: await readBoundedJson(response, RPC_RESPONSE_BYTES), error: null };
    } catch (cause) {
      return { data: null, error: { code: cause instanceof Error ? cause.message : "rpc_response_invalid" } };
    }
  }
  return { rpc };
}

async function drainOutbound(configuration, fetcher) {
  if (!configuration.dispatchUrl) {
    return { status: "unconfigured" };
  }
  let response;
  try {
    response = await fetcher(configuration.dispatchUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${configuration.cronSecret}` },
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch {
    return { status: "unreachable" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { status: `http_${response.status}` };
  }
  try {
    const body = await readBoundedJson(response, RPC_RESPONSE_BYTES);
    return { status: "ok", ...(body && typeof body === "object" ? body : {}) };
  } catch {
    return { status: "response_invalid" };
  }
}

export async function runSourcingLoopTick(client, configuration, environment, fetcher = fetch) {
  if (killSwitchEngaged(environment)) {
    return { status: "kill_switch_engaged" };
  }

  const failureCodes = [];

  const heartbeat = await client.rpc("record_loop_worker_heartbeat", {
    p_worker_id: configuration.workerId,
    p_release_sha: configuration.releaseSha,
  });
  if (heartbeat.error) failureCodes.push(`heartbeat:${heartbeat.error.code}`);

  const jobReap = await client.rpc("reap_expired_aria_job_leases", { p_limit: 100 });
  if (jobReap.error) failureCodes.push(`job_reap:${jobReap.error.code}`);

  const frameworkReap = await client.rpc("reap_expired_agent_framework_leases", { p_limit: 50 });
  if (frameworkReap.error) failureCodes.push(`framework_reap:${frameworkReap.error.code}`);

  // Bound the email delivery-receipt dedup spine (default 180-day retention,
  // floored at 90 in-DB). Keeps the table from growing without limit.
  const receiptGc = await client.rpc("cleanup_email_ledger_delivery_receipts", { p_retention_days: 180 });
  if (receiptGc.error) failureCodes.push(`receipt_gc:${receiptGc.error.code}`);

  const dispatch = await drainOutbound(configuration, fetcher);
  if (dispatch.status !== "ok" && dispatch.status !== "unconfigured") {
    failureCodes.push(`dispatch:${dispatch.status}`);
  }

  let claimed = 0;
  if (HANDLER_KINDS.length > 0) {
    const claim = await client.rpc("claim_due_aria_jobs", {
      p_worker_id: configuration.workerId,
      p_lease_seconds: 120,
      p_kinds: [...HANDLER_KINDS],
      p_limit: 10,
    });
    if (claim.error) {
      failureCodes.push(`claim:${claim.error.code}`);
    } else if (Array.isArray(claim.data)) {
      claimed = claim.data.length;
      // Rock 1 has no handlers; nothing is ever claimed because HANDLER_KINDS
      // is empty. When handlers land (Rocks 2-5), each claimed job routes to
      // its handler and completes/fails through the lease-bound RPCs.
    }
  }

  return {
    status: failureCodes.length === 0 ? "ok" : "degraded",
    jobLeasesReaped: typeof jobReap.data === "number" ? jobReap.data : 0,
    frameworkLeasesReaped: typeof frameworkReap.data === "number" ? frameworkReap.data : 0,
    dispatch: dispatch.status,
    claimed,
    failureCodes,
  };
}

function delay(milliseconds, signal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runSourcingLoopForever({
  client,
  configuration,
  environment,
  signal,
  fetcher = fetch,
  logger = () => undefined,
  now = Date.now,
  sleep = delay,
}) {
  while (!signal.aborted) {
    const started = now();
    let result;
    try {
      result = await runSourcingLoopTick(client, configuration, environment, fetcher);
    } catch {
      result = { status: "failed", failureCodes: ["worker_exception"] };
    }
    const durationMs = Math.max(0, now() - started);
    logger({
      event: "sourcing_loop_tick",
      workerId: configuration.workerId,
      releaseSha: configuration.releaseSha,
      ...result,
      durationMs,
    });
    if (signal.aborted) break;
    const jitterMs = Math.floor(Math.random() * 5_000);
    await sleep(Math.max(0, configuration.tickMs - durationMs) + jitterMs, signal);
  }
}

function installCrashHandlers(workerId) {
  for (const [event, kind] of [["unhandledRejection", "unhandled_rejection"], ["uncaughtException", "uncaught_exception"]]) {
    process.on(event, (err) => {
      console.error(JSON.stringify({
        event: "sourcing_loop_crash",
        kind,
        workerId,
        message: err instanceof Error ? err.message : String(err),
      }));
      process.exit(1);
    });
  }
}

async function main() {
  let configuration;
  try {
    configuration = loadSourcingLoopConfiguration(process.env);
  } catch (cause) {
    console.error(JSON.stringify({
      event: "sourcing_loop_configuration",
      status: "failed",
      code: cause instanceof Error ? cause.message : "configuration_invalid",
    }));
    process.exitCode = 78;
    return;
  }
  installCrashHandlers(configuration.workerId);
  const client = createLoopRpcClient(configuration);
  const controller = new AbortController();
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    process.on(signalName, () => controller.abort());
  }
  await runSourcingLoopForever({
    client,
    configuration,
    environment: process.env,
    signal: controller.signal,
    logger(event) {
      const writer = event.status === "ok" || event.status === "kill_switch_engaged"
        ? console.log
        : console.error;
      writer(JSON.stringify(event));
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
