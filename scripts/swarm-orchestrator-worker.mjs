// swarm-orchestrator-worker.mjs — the swarm orchestration tick (PLAN.md Rock 8).
//
// ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
// 2026-07-23); same banner as 0042-0046. Codex must attack this before enable.
//
// The server-side scheduler hermes-workspace never had: its orchestrator loop
// only ran when a UI called it. Here the loop is a tick worker over durable
// rows, and every safety decision lives in the 0046 RPCs, not in this process:
//
//   1. Global kill switch — fail-closed: anything but the exact string
//      "false" in ARIA_LOOP_KILL_SWITCH means the tick does NOTHING. The
//      per-workspace gate (sourcing_loop_controls.swarm_enabled, DEFAULT
//      FALSE) is enforced inside dispatch_ready_swarm_assignments.
//   2. record_loop_worker_heartbeat (worker id + release sha).
//   3. reap_expired_aria_job_leases — claim hygiene (idempotent with the
//      sourcing loop worker's reaper).
//   4. mark_stale_swarm_assignments — bounded auto-repair: requeue up to 3
//      dispatch attempts, then block + escalate. Never destructive.
//   5. route_swarm_reviews — the mechanical review-gate lane.
//   6. dispatch_ready_swarm_assignments — DAG + concurrency + greenlight +
//      switchboard gates, all in-DB.
//   7. claim_due_aria_jobs kinds=['swarm_assignment'] → for each job:
//      (see executeClaimedSwarmJob) fetch the lease-bound envelope, POST it
//      to ARIA_SWARM_EXECUTOR_URL, validate the six-field checkpoint reply,
//      record_swarm_checkpoint under the SAME lease, then complete the job
//      (enqueueing a continuation job transactionally when the checkpoint is
//      in_progress/handoff). No executor configured ⇒ jobs fail closed with
//      executor_not_configured and surface in the escalation inbox via the
//      stale sweep — never silent, never fake work.
//
// The executor is a pluggable HTTP endpoint (Dust, Flowise, a Claude runner):
// envelope in, checkpoint out. This worker grants it NOTHING beyond the task
// text and ids in the envelope — sends stay behind the outreach approval
// authority, and a checkpoint can only be recorded by the live lease holder.
//
// Conventions follow scripts/sourcing-loop-worker.mjs: pure exported
// functions, bounded reads, JSON-line logging, exit code 78 on invalid
// configuration, AbortController shutdown on SIGINT/SIGTERM.

import { pathToFileURL } from "node:url";

const SHA1_RE = /^[0-9a-f]{40}$/;
const WORKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
// Must stay under the 120s job lease so a live execution can never outlast
// its own lease and be double-claimed.
const EXECUTOR_TIMEOUT_MS = 100_000;
const RPC_RESPONSE_BYTES = 256_000;
const EXECUTOR_RESPONSE_BYTES = 128_000;
const HANDLER_KINDS = Object.freeze(["swarm_assignment"]);
const CHECKPOINT_STATES = Object.freeze([
  "in_progress", "done", "blocked", "needs_input", "handoff", "needs_review",
]);

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

export function loadSwarmOrchestratorConfiguration(environment) {
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

  const workerId = environment.ARIA_SWARM_WORKER_ID
    ?? (environment.FLY_MACHINE_ID ? `swarm-${environment.FLY_MACHINE_ID}` : "swarm-local");
  if (!WORKER_ID_RE.test(workerId)) {
    throw new Error("invalid ARIA_SWARM_WORKER_ID");
  }

  // Executor is optional-by-absence (the swarm dispatches nothing real until
  // an executor exists) but invalid-by-misconfiguration: a present-but-broken
  // value is a configuration failure, not a silent skip.
  const executorOrigin = environment.ARIA_SWARM_EXECUTOR_URL ?? "";
  const executorToken = environment.ARIA_SWARM_EXECUTOR_TOKEN ?? "";
  let executorUrl = null;
  if (executorOrigin !== "" || executorToken !== "") {
    let parsed;
    try {
      parsed = new URL(executorOrigin);
    } catch {
      throw new Error("invalid ARIA_SWARM_EXECUTOR_URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid ARIA_SWARM_EXECUTOR_URL");
    }
    if (!validServiceToken(executorToken)) {
      throw new Error("invalid ARIA_SWARM_EXECUTOR_TOKEN");
    }
    executorUrl = parsed;
  }

  return {
    supabaseUrl: endpoint,
    serviceRoleKey,
    releaseSha,
    workerId,
    executorUrl,
    executorToken,
    tickMs: boundedInteger(environment.ARIA_SWARM_TICK_MS, DEFAULT_TICK_MS, 5_000, 300_000, "ARIA_SWARM_TICK_MS"),
    timeoutMs: boundedInteger(environment.ARIA_SWARM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000, "ARIA_SWARM_TIMEOUT_MS"),
    staleMinutes: boundedInteger(environment.ARIA_SWARM_STALE_MINUTES, 15, 1, 240, "ARIA_SWARM_STALE_MINUTES"),
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

export function createSwarmRpcClient(configuration, fetcher = fetch) {
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

function boundedString(value, maximum) {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum;
}

function boundedStringArray(value, maximumItems, maximumEach) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => typeof item === "string" && item.length <= maximumEach);
}

// The six-field checkpoint contract, as a validated JSON shape. Mirrors the
// DB caps in record_swarm_checkpoint so an invalid reply fails HERE with a
// named reason instead of bouncing off the RPC.
export function validateExecutorCheckpoint(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object" };
  }
  if (!CHECKPOINT_STATES.includes(value.state)) {
    return { ok: false, reason: "invalid_state" };
  }
  const filesChanged = value.files_changed ?? [];
  const commandsRun = value.commands_run ?? [];
  if (!boundedStringArray(filesChanged, 50, 400)) return { ok: false, reason: "invalid_files_changed" };
  if (!boundedStringArray(commandsRun, 50, 400)) return { ok: false, reason: "invalid_commands_run" };
  if (value.result !== undefined && value.result !== null && !boundedString(value.result, 8_000)) {
    return { ok: false, reason: "invalid_result" };
  }
  if (value.blocker !== undefined && value.blocker !== null && !boundedString(value.blocker, 2_000)) {
    return { ok: false, reason: "invalid_blocker" };
  }
  if (value.next_action !== undefined && value.next_action !== null && !boundedString(value.next_action, 2_000)) {
    return { ok: false, reason: "invalid_next_action" };
  }
  const proof = value.proof ?? {};
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)
      || JSON.stringify(proof).length > 4_000) {
    return { ok: false, reason: "invalid_proof" };
  }
  return {
    ok: true,
    checkpoint: {
      state: value.state,
      files_changed: filesChanged,
      commands_run: commandsRun,
      result: value.result ?? null,
      blocker: value.blocker ?? null,
      next_action: value.next_action ?? null,
      proof,
    },
  };
}

async function callExecutor(configuration, envelope, fetcher) {
  let response;
  try {
    response = await fetcher(configuration.executorUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.executorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "swarm-checkpoint-v1",
        envelope,
        required_reply: {
          state: CHECKPOINT_STATES,
          fields: ["state", "files_changed", "commands_run", "result", "blocker", "next_action", "proof"],
        },
      }),
      signal: AbortSignal.timeout(EXECUTOR_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "executor_unreachable", retryable: true };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: `executor_http_${response.status}`, retryable: response.status >= 500 };
  }
  let body;
  try {
    body = await readBoundedJson(response, EXECUTOR_RESPONSE_BYTES);
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : "executor_response_invalid",
      retryable: false,
    };
  }
  const validated = validateExecutorCheckpoint(body);
  if (!validated.ok) {
    return { ok: false, reason: `executor_checkpoint_${validated.reason}`, retryable: false };
  }
  return { ok: true, checkpoint: validated.checkpoint };
}

export async function executeClaimedSwarmJob(client, configuration, job, fetcher = fetch) {
  if (!configuration.executorUrl) {
    // Fail closed and visibly: the dead job surfaces through the stale sweep
    // as requeue → requeue → blocked + escalation. Never fake work.
    await client.rpc("fail_aria_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_error: "executor_not_configured",
      p_retryable: false,
    });
    return { status: "executor_not_configured" };
  }

  const envelopeResult = await client.rpc("get_swarm_assignment_envelope", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
  });
  const envelope = envelopeResult.data;
  if (envelopeResult.error || !envelope || envelope.status !== "ok") {
    const reason = envelopeResult.error?.code ?? envelope?.status ?? "envelope_unavailable";
    await client.rpc("fail_aria_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_error: `envelope:${reason}`,
      p_retryable: false,
    });
    return { status: "envelope_failed", reason };
  }

  const executed = await callExecutor(configuration, envelope, fetcher);
  if (!executed.ok) {
    await client.rpc("fail_aria_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_error: executed.reason,
      p_retryable: executed.retryable,
    });
    return { status: "executor_failed", reason: executed.reason };
  }

  const checkpoint = executed.checkpoint;
  // record_swarm_checkpoint is the WHOLE commit: it verifies the live lease,
  // records the checkpoint, consumes this job as succeeded, and mints any
  // in_progress/handoff continuation — all in one DB transaction (a crash
  // between separate record/complete calls used to strand the chain).
  const recorded = await client.rpc("record_swarm_checkpoint", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_state: checkpoint.state,
    p_files_changed: checkpoint.files_changed,
    p_commands_run: checkpoint.commands_run,
    p_result: checkpoint.result,
    p_blocker: checkpoint.blocker,
    p_next_action: checkpoint.next_action,
    p_proof: checkpoint.proof,
  });
  if (recorded.error || recorded.data?.status !== "recorded") {
    const reason = recorded.error?.code ?? recorded.data?.status ?? "record_failed";
    await client.rpc("fail_aria_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_error: `checkpoint:${reason}`,
      p_retryable: false,
    });
    return { status: "record_failed", reason };
  }

  return { status: "ok", state: checkpoint.state, continued: recorded.data?.continued === true };
}

export async function runSwarmOrchestratorTick(client, configuration, environment, fetcher = fetch) {
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

  const stale = await client.rpc("mark_stale_swarm_assignments", {
    p_stale_minutes: configuration.staleMinutes,
    p_limit: 50,
  });
  if (stale.error) failureCodes.push(`stale:${stale.error.code}`);

  const reviews = await client.rpc("route_swarm_reviews", { p_limit: 50 });
  if (reviews.error) failureCodes.push(`reviews:${reviews.error.code}`);

  const dispatch = await client.rpc("dispatch_ready_swarm_assignments", { p_limit: 25 });
  if (dispatch.error) failureCodes.push(`dispatch:${dispatch.error.code}`);

  let claimed = 0;
  let executed = 0;
  // Small batch + per-job lease heartbeat: serial execution of a batch must
  // never let a later job's lease expire while an earlier one is at the LLM.
  const claim = await client.rpc("claim_due_aria_jobs", {
    p_worker_id: configuration.workerId,
    p_lease_seconds: 120,
    p_kinds: [...HANDLER_KINDS],
    p_limit: 3,
  });
  if (claim.error) {
    failureCodes.push(`claim:${claim.error.code}`);
  } else if (Array.isArray(claim.data)) {
    claimed = claim.data.length;
    for (const job of claim.data) {
      await client.rpc("heartbeat_aria_job", {
        p_job_id: job.id,
        p_lease_id: job.lease_id,
        p_lease_seconds: 120,
      });
      const outcome = await executeClaimedSwarmJob(client, configuration, job, fetcher);
      if (outcome.status === "ok") {
        executed += 1;
      } else {
        failureCodes.push(`execute:${outcome.status}`);
      }
    }
  }

  return {
    status: failureCodes.length === 0 ? "ok" : "degraded",
    jobLeasesReaped: typeof jobReap.data === "number" ? jobReap.data : 0,
    staleRequeued: stale.data?.requeued ?? 0,
    staleBlocked: stale.data?.blocked ?? 0,
    reviewsRouted: reviews.data?.routed ?? 0,
    dispatched: dispatch.data?.dispatched ?? 0,
    claimed,
    executed,
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

export async function runSwarmOrchestratorForever({
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
      result = await runSwarmOrchestratorTick(client, configuration, environment, fetcher);
    } catch {
      result = { status: "failed", failureCodes: ["worker_exception"] };
    }
    const durationMs = Math.max(0, now() - started);
    logger({
      event: "swarm_orchestrator_tick",
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
        event: "swarm_orchestrator_crash",
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
    configuration = loadSwarmOrchestratorConfiguration(process.env);
  } catch (cause) {
    console.error(JSON.stringify({
      event: "swarm_orchestrator_configuration",
      status: "failed",
      code: cause instanceof Error ? cause.message : "configuration_invalid",
    }));
    process.exitCode = 78;
    return;
  }
  installCrashHandlers(configuration.workerId);
  const client = createSwarmRpcClient(configuration);
  const controller = new AbortController();
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    process.on(signalName, () => controller.abort());
  }
  await runSwarmOrchestratorForever({
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
