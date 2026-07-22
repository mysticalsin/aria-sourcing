// sourcing-loop-worker.mjs — the autonomous-loop tick worker (PLAN.md Rock 1).
//
// Runs as its own Fly process group ("loop"). Every tick, in order:
//   1. Global kill switch — fail-closed: anything but the exact string
//      "false" in ARIA_LOOP_KILL_SWITCH means the tick does NOTHING (no DB
//      writes, no HTTP). The loop ships dark by default.
//   2. record_sourcing_loop_heartbeat (worker id + release sha + exact
//      deployed-handler contract).
//   3. Lease reapers: reap_expired_aria_job_leases (crash recovery for the
//      job spine) + reap_expired_agent_framework_leases (closes the 0029
//      reaper gap).
//   4. Optional outbound drain: GET /api/cron/dispatch-outbound on the web process
//      (Bearer CRON_SECRET) — the EXACT route the daily Vercel cron hits, so
//      every send-side guardrail (approval re-verification, suppression,
//      quiet hours, atomic claims) is reused verbatim, just minute-level
//      instead of daily. No dispatch logic is duplicated here.
//      Explicit opt-in only (ARIA_LOOP_ENABLE_OUTBOUND_DRAIN === "true"),
//      so configuring internal requisition parsing can never start sends.
//   5. Independent, bounded claims for sourcing_batch, requisition_parse,
//      and campaign_create. Separate claims prevent one workload from
//      starving the others and give each handler a lease matched to its work.
//
// Conventions follow scripts/agent-framework-heartbeat-worker.mjs: pure
// exported functions, bounded reads, JSON-line logging, exit code 78 on
// invalid configuration, AbortController shutdown on SIGINT/SIGTERM.

import { pathToFileURL } from "node:url";

import {
  handleSourcingBatchJob,
  isValidSourcingBatchOutcome,
} from "./sourcing-loop-handlers/sourcing-batch.mjs";
import {
  handleCampaignCreateJob,
  isValidCampaignCreateOutcome,
} from "./sourcing-loop-handlers/campaign-create.mjs";
import { registerObservability } from "../src/lib/observability/register.mjs";
import { withCriticalPathTelemetry } from "../src/lib/observability/critical-path.mjs";

const SHA1_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;
export const SOURCING_LOOP_HEARTBEAT_INTERVAL_MS = 20_000;
const DISPATCH_TIMEOUT_MS = 55_000;
// The web handler's provider call is bounded at 20s. Keep the dispatch
// timeout above that bound and safely below the job lease.
export const REQUISITION_PARSE_DISPATCH_TIMEOUT_MS = 90_000;
export const SOURCING_EXECUTION_DISPATCH_TIMEOUT_MS = 45_000;
export const REQUISITION_PARSE_LEASE_SECONDS = 120;
export const REQUISITION_PARSE_CLAIM_LIMIT = 1;
// Campaign creation is DB-only. A 180s lease covers finalize plus a possible
// failure transition even at the maximum 60s RPC timeout.
export const CAMPAIGN_CREATE_LEASE_SECONDS = 180;
export const CAMPAIGN_CREATE_CLAIM_LIMIT = 5;
const RPC_RESPONSE_BYTES = 256_000;
const DEFAULT_SOURCING_RESULT_LIMIT = 3;
const DEFAULT_SOURCING_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_SOURCING_DEADLINE_MS = 40_000;
const SOURCING_JOB_LEASE_SECONDS = 180;
const DEFAULT_SOURCING_CLAIM_CONCURRENCY = 1;
export const SOURCING_CLAIM_CONCURRENCY_HARD_CAP = 3;
const SOURCING_HANDLER_KINDS = Object.freeze(["sourcing_batch"]);
const REQUISITION_PARSE_HANDLER_KINDS = Object.freeze(["requisition_parse"]);
const CAMPAIGN_CREATE_HANDLER_KINDS = Object.freeze(["campaign_create"]);
export const SOURCING_LOOP_HANDLER_CONTRACT_SHA256 =
  "88ed71725132fec6e7981c52d200513810f668d358811fdbcc213339b26cb6f3";

function classifyCriticalOutcome(value) {
  const code = typeof value?.outcome === "string"
    ? value.outcome
    : typeof value?.status === "string"
      ? value.status
      : "outcome_invalid";
  if (code === "completed" || code === "no_op_replay" || code === "ok") {
    return { status: "ok", code };
  }
  if (code === "dead_lettered" || code === "ambiguous_dead_lettered") {
    return { status: "failed", code };
  }
  return { status: "degraded", code };
}

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

function validGithubToken(value) {
  return typeof value === "string"
    && value.length >= 20
    && value.length <= 512
    && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function githubCredential(environment, providerMode) {
  if (providerMode === "anonymous") return Object.freeze({ kind: "anonymous" });
  const token = environment.GITHUB_TOKEN;
  if (!validGithubToken(token)) throw new Error("invalid GITHUB_TOKEN");
  const credential = { kind: "authenticated" };
  Object.defineProperty(credential, "authorizationHeader", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => `Bearer ${token}`,
  });
  return Object.freeze(credential);
}

function parsePrivateWebOrigin(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("invalid ARIA_WEB_INTERNAL_URL");
  }
  const hostname = endpoint.hostname.toLowerCase();
  const isFlyPrivate = hostname.endsWith(".internal");
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    || (!isFlyPrivate && !isLoopback)
    || endpoint.username !== ""
    || endpoint.password !== ""
    || endpoint.pathname !== "/"
    || endpoint.search !== ""
    || endpoint.hash !== ""
  ) {
    throw new Error("invalid ARIA_WEB_INTERNAL_URL");
  }
  return endpoint;
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

  // Requisition parsing is optional-by-absence so a sourcing-only worker can
  // be deployed independently. A configured parse secret requires a valid
  // internal origin. The credential is sent only to Fly-private DNS or
  // loopback.
  const webOrigin = environment.ARIA_WEB_INTERNAL_URL ?? "";
  const requisitionParseSecret = environment.ARIA_REQUISITION_PARSE_SECRET ?? "";
  const sourcingExecutionSecret = environment.ARIA_SOURCING_EXECUTION_SECRET ?? "";
  const cronSecret = environment.CRON_SECRET ?? "";
  // ARIA_WEB_INTERNAL_URL may already exist for an outbound-only deployment.
  // Parse work is enabled only when its purpose-bound secret is present.
  const parseConfigured = requisitionParseSecret !== "";
  let privateWebOrigin = null;
  let requisitionParseUrl = null;
  if (parseConfigured) {
    privateWebOrigin = parsePrivateWebOrigin(webOrigin);
    if (!validServiceToken(requisitionParseSecret)) {
      throw new Error("invalid ARIA_REQUISITION_PARSE_SECRET");
    }
    requisitionParseUrl = new URL("/api/internal/requisition-parse", privateWebOrigin);
  }

  const sourcingExecutionConfigured = sourcingExecutionSecret !== "";
  let sourcingExecutionUrl = null;
  if (sourcingExecutionConfigured) {
    privateWebOrigin ??= parsePrivateWebOrigin(webOrigin);
    if (!validServiceToken(sourcingExecutionSecret)) {
      throw new Error("invalid ARIA_SOURCING_EXECUTION_SECRET");
    }
    if (sourcingExecutionSecret === requisitionParseSecret) {
      throw new Error("ARIA_SOURCING_EXECUTION_SECRET and ARIA_REQUISITION_PARSE_SECRET must be distinct");
    }
    if (sourcingExecutionSecret === cronSecret) {
      throw new Error("ARIA_SOURCING_EXECUTION_SECRET and CRON_SECRET must be distinct");
    }
    sourcingExecutionUrl = new URL("/api/internal/sourcing-execute", privateWebOrigin);
  }

  // Outbound sending is a separate capability and remains disabled unless
  // explicitly opted in. It must use a distinct credential.
  const outboundDrainEnabled = (environment.ARIA_LOOP_ENABLE_OUTBOUND_DRAIN ?? "") === "true";
  let dispatchUrl = null;
  if (outboundDrainEnabled) {
    privateWebOrigin ??= parsePrivateWebOrigin(webOrigin);
    if (!validServiceToken(cronSecret)) {
      throw new Error("invalid CRON_SECRET");
    }
    if (cronSecret === requisitionParseSecret) {
      throw new Error("CRON_SECRET and ARIA_REQUISITION_PARSE_SECRET must be distinct");
    }
    if (cronSecret === sourcingExecutionSecret) {
      throw new Error("CRON_SECRET and ARIA_SOURCING_EXECUTION_SECRET must be distinct");
    }
    dispatchUrl = new URL("/api/cron/dispatch-outbound", privateWebOrigin);
  }

  const sourcingRequestTimeoutMs = boundedInteger(
    environment.ARIA_SOURCING_REQUEST_TIMEOUT_MS,
    DEFAULT_SOURCING_REQUEST_TIMEOUT_MS,
    1_000,
    15_000,
    "ARIA_SOURCING_REQUEST_TIMEOUT_MS",
  );
  const sourcingDeadlineMs = boundedInteger(
    environment.ARIA_SOURCING_DEADLINE_MS,
    DEFAULT_SOURCING_DEADLINE_MS,
    sourcingRequestTimeoutMs,
    45_000,
    "ARIA_SOURCING_DEADLINE_MS",
  );
  const sourcingProviderMode = environment.ARIA_SOURCING_GITHUB_PROVIDER_MODE ?? "anonymous";
  if (sourcingProviderMode !== "anonymous" && sourcingProviderMode !== "authenticated") {
    throw new Error("invalid ARIA_SOURCING_GITHUB_PROVIDER_MODE");
  }
  const sourcingGithubCredential = githubCredential(environment, sourcingProviderMode);

  return {
    supabaseUrl: endpoint,
    serviceRoleKey,
    releaseSha,
    workerId,
    dispatchUrl,
    requisitionParseUrl,
    requisitionParseSecret: requisitionParseUrl ? requisitionParseSecret : "",
    sourcingExecutionUrl,
    sourcingExecutionSecret: sourcingExecutionUrl ? sourcingExecutionSecret : "",
    cronSecret: outboundDrainEnabled ? cronSecret : "",
    outboundDrainEnabled,
    tickMs: boundedInteger(environment.ARIA_LOOP_TICK_MS, DEFAULT_TICK_MS, 5_000, 300_000, "ARIA_LOOP_TICK_MS"),
    timeoutMs: boundedInteger(environment.ARIA_LOOP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 60_000, "ARIA_LOOP_TIMEOUT_MS"),
    sourcingProviderMode,
    sourcingGithubCredential,
    sourcingGithubClaimConcurrency: boundedInteger(
      environment.ARIA_SOURCING_CLAIM_CONCURRENCY,
      DEFAULT_SOURCING_CLAIM_CONCURRENCY,
      1,
      SOURCING_CLAIM_CONCURRENCY_HARD_CAP,
      "ARIA_SOURCING_CLAIM_CONCURRENCY",
    ),
    sourcingGithubResultLimit: boundedInteger(
      environment.ARIA_SOURCING_GITHUB_RESULT_LIMIT,
      DEFAULT_SOURCING_RESULT_LIMIT,
      1,
      3,
      "ARIA_SOURCING_GITHUB_RESULT_LIMIT",
    ),
    sourcingRequestTimeoutMs,
    sourcingDeadlineMs,
  };
}

export function killSwitchEngaged(environment) {
  // Fail-closed: only the exact string "false" disengages.
  return (environment.ARIA_LOOP_KILL_SWITCH ?? "") !== "false";
}

export async function recordSourcingLoopHeartbeat(client, configuration) {
  const heartbeat = await client.rpc("record_sourcing_loop_heartbeat", {
    p_worker_id: configuration.workerId,
    p_release_sha: configuration.releaseSha,
    p_handler_contract_sha256: SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
  });
  // Database error envelopes are untrusted and can contain record or tenant
  // identifiers. Logs need the failing boundary, not the upstream payload.
  if (heartbeat.error) return { status: "failed", code: "rpc_error" };
  if (heartbeat.data !== true) return { status: "failed", code: "response_invalid" };
  return { status: "ok" };
}

/**
 * Keep liveness independent from job duration. A requisition provider call can
 * legitimately outlive the normal tick interval; tying heartbeats to tick
 * completion would make a healthy worker appear stale while it is working.
 * @param {{
 *   client: { rpc: (name: string, params: Record<string, unknown>) => Promise<{data: unknown, error: {code: string} | null}> },
 *   configuration: Record<string, any>,
 *   environment: Record<string, string | undefined>,
 *   signal: AbortSignal,
 *   logger?: (event: Record<string, unknown>) => void,
 *   schedule?: (callback: () => void, milliseconds: number) => any,
 *   cancel?: (handle: any) => void,
 * }} options
 */
export function startSourcingLoopHeartbeatPump({
  client,
  configuration,
  environment,
  signal,
  logger = () => undefined,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let stopped = false;
  let timer = null;
  let inFlight = false;

  const stop = () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const arm = () => {
    if (stopped || signal.aborted) return;
    timer = schedule(() => { void pulse(); }, SOURCING_LOOP_HEARTBEAT_INTERVAL_MS);
    timer?.unref?.();
  };
  const pulse = async () => {
    if (stopped || signal.aborted || inFlight) return;
    if (timer !== null) cancel(timer);
    timer = null;
    if (killSwitchEngaged(environment)) {
      arm();
      return;
    }
    inFlight = true;
    let result;
    try {
      result = await recordSourcingLoopHeartbeat(client, configuration);
    } catch {
      result = { status: "failed", code: "worker_exception" };
    } finally {
      inFlight = false;
    }
    logger({
      event: "sourcing_loop_heartbeat",
      workerId: configuration.workerId,
      releaseSha: configuration.releaseSha,
      ...result,
    });
    arm();
  };

  signal.addEventListener("abort", stop, { once: true });
  arm();
  return { stop, pulse };
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
  const reader = response.body?.getReader();
  const chunks = [];
  let receivedBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("response_size_invalid");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
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

async function dispatchClaimedRequisitionParseJob(job, configuration, fetcher) {
  if (!configuration.requisitionParseUrl) {
    return { status: "unconfigured" };
  }
  let response;
  try {
    response = await fetcher(configuration.requisitionParseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.requisitionParseSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jobId: job.id,
        leaseId: job.lease_id,
        workspaceId: job.workspace_id,
        requisitionId: job.payload?.requisition_id,
      }),
      signal: AbortSignal.timeout(REQUISITION_PARSE_DISPATCH_TIMEOUT_MS),
      redirect: "error",
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
    if (!body || typeof body !== "object" || body.ok !== true) {
      return { status: "response_invalid" };
    }
    const outcome = body.outcome;
    if (!outcome || typeof outcome !== "object") {
      return { status: "response_invalid" };
    }
    const handled = outcome.outcome;
    if (!new Set(["completed", "no_op_replay", "retry_scheduled", "dead_lettered"]).has(handled)) {
      return { status: "response_invalid" };
    }
    if (handled === "completed" && typeof outcome.ready !== "boolean") {
      return { status: "response_invalid" };
    }
    if (
      (handled === "retry_scheduled" || handled === "dead_lettered")
      && (typeof outcome.reason !== "string" || outcome.reason.length < 1 || outcome.reason.length > 2_000)
    ) {
      return { status: "response_invalid" };
    }
    return { status: "ok", outcome: handled };
  } catch {
    return { status: "response_invalid" };
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value, fields) {
  return isRecord(value)
    && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}

const WEB_LOCATOR_FIELDS = new Set([
  "campaignId",
  "claimToken",
  "fenceVersion",
  "jobId",
  "leaseId",
  "workspaceId",
]);

function validSourcingJobForWeb(job) {
  return isRecord(job)
    && typeof job.id === "string"
    && UUID_RE.test(job.id)
    && typeof job.lease_id === "string"
    && UUID_RE.test(job.lease_id)
    && typeof job.workspace_id === "string"
    && UUID_RE.test(job.workspace_id)
    && job.kind === "sourcing_batch"
    && exactFields(job.payload, new Set(["batch_ordinal", "campaign_id", "campaign_sha256"]))
    && typeof job.payload.campaign_id === "string"
    && UUID_RE.test(job.payload.campaign_id)
    && typeof job.payload.campaign_sha256 === "string"
    && SHA256_RE.test(job.payload.campaign_sha256)
    && Number.isSafeInteger(job.payload.batch_ordinal)
    && job.payload.batch_ordinal >= 0
    && job.payload.batch_ordinal <= 4;
}

function exactWebLocator(value, job) {
  return exactFields(value, WEB_LOCATOR_FIELDS)
    && value.jobId === job.id
    && value.leaseId === job.lease_id
    && value.workspaceId === job.workspace_id
    && value.campaignId === job.payload.campaign_id
    && typeof value.claimToken === "string"
    && UUID_RE.test(value.claimToken)
    && Number.isSafeInteger(value.fenceVersion)
    && value.fenceVersion > 0;
}

function exactWebOutcome(value) {
  if (!isRecord(value)) return false;
  if (value.outcome === "completed") {
    return Object.keys(value).length === 3
      && Number.isSafeInteger(value.candidateCount)
      && value.candidateCount >= 0
      && value.candidateCount <= 5
      && value.queryCount === 1;
  }
  if (value.outcome === "no_op_replay" || value.outcome === "stale_lease") {
    return Object.keys(value).length === 1;
  }
  if (
    value.outcome === "retry_scheduled"
    || value.outcome === "dead_lettered"
    || value.outcome === "ambiguous_dead_lettered"
    || value.outcome === "unavailable"
  ) {
    return Object.keys(value).length === 2
      && typeof value.reason === "string"
      && /^[a-z][a-z0-9_]{0,127}$/.test(value.reason);
  }
  return false;
}

async function dispatchAutonomousWebLocator(locator, configuration, fetcher) {
  let response;
  try {
    response = await fetcher(configuration.sourcingExecutionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.sourcingExecutionSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(locator),
      signal: AbortSignal.timeout(SOURCING_EXECUTION_DISPATCH_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return { outcome: "unavailable", reason: "web_dispatch_unreachable" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { outcome: "unavailable", reason: "web_dispatch_failed" };
  }
  try {
    const body = await readBoundedJson(response, RPC_RESPONSE_BYTES);
    if (!exactFields(body, new Set(["ok", "outcome"])) || body.ok !== true || !exactWebOutcome(body.outcome)) {
      return { outcome: "unavailable", reason: "web_dispatch_response_invalid" };
    }
    return body.outcome;
  } catch {
    return { outcome: "unavailable", reason: "web_dispatch_response_invalid" };
  }
}

async function failWebAuthorization(client, job, reason, retryable) {
  const failure = await client.rpc("fail_aria_job", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_error: `autonomous_web_${reason}`,
    p_retryable: retryable,
  });
  if (failure.error) return { outcome: "unavailable", reason: "web_authorization_failure_unconfirmed" };
  if (failure.data === "queued") return { outcome: "retry_scheduled", reason };
  if (failure.data === "dead") return { outcome: "dead_lettered", reason };
  if (failure.data === "not_found") return { outcome: "stale_lease" };
  return { outcome: "unavailable", reason: "web_authorization_failure_unconfirmed" };
}

async function handleClaimedSourcingJob(job, client, configuration, fetcher, githubHandler) {
  if (!configuration.sourcingExecutionUrl) {
    return githubHandler(job, client, {
      credential: configuration.sourcingGithubCredential,
      resultLimit: configuration.sourcingGithubResultLimit,
      perCallTimeoutMs: configuration.sourcingRequestTimeoutMs,
      overallDeadlineMs: configuration.sourcingDeadlineMs,
      fetcher,
    });
  }
  if (!validSourcingJobForWeb(job)) {
    return { outcome: "unavailable", reason: "invalid_job_envelope" };
  }
  let authorization;
  try {
    authorization = await client.rpc("authorize_autonomous_web_sourcing", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_workspace_id: job.workspace_id,
      p_campaign_id: job.payload.campaign_id,
      p_campaign_sha256: job.payload.campaign_sha256,
      p_batch_ordinal: job.payload.batch_ordinal,
    });
  } catch {
    return { outcome: "unavailable", reason: "web_authorization_unavailable" };
  }
  if (authorization.error || !isRecord(authorization.data)) {
    return { outcome: "unavailable", reason: "web_authorization_unavailable" };
  }
  const result = authorization.data;
  if (
    (result.status === "role_not_approved_for_web" || result.status === "provider_lane_conflict")
    && exactFields(result, new Set(["status"]))
  ) {
    // A provider-lane conflict here is positive database evidence that this
    // exact job already owns an immutable 0054 GitHub claim. Keep that lane
    // sticky across re-leases instead of churning the job or switching egress.
    return githubHandler(job, client, {
      credential: configuration.sourcingGithubCredential,
      resultLimit: configuration.sourcingGithubResultLimit,
      perCallTimeoutMs: configuration.sourcingRequestTimeoutMs,
      overallDeadlineMs: configuration.sourcingDeadlineMs,
      fetcher,
    });
  }
  if (
    result.status === "authorized"
    && exactFields(result, new Set(["status", "locator"]))
    && exactWebLocator(result.locator, job)
  ) {
    return dispatchAutonomousWebLocator(result.locator, configuration, fetcher);
  }
  if (
    result.status === "attempt_already_started"
    && exactFields(result, new Set(["status", "egressAttemptId", "locator"]))
    && typeof result.egressAttemptId === "string"
    && UUID_RE.test(result.egressAttemptId)
    && exactWebLocator(result.locator, job)
  ) {
    // The route's begin call can only reconcile this existing attempt. It can
    // never receive fresh request/key authority or issue a second fetch.
    return dispatchAutonomousWebLocator(result.locator, configuration, fetcher);
  }
  if (
    result.status === "no_op_replay"
    && exactFields(result, new Set([
      "candidateCount",
      "jobId",
      "queryCount",
      "resultSha256",
      "status",
    ]))
    && result.jobId === job.id
    && typeof result.resultSha256 === "string"
    && SHA256_RE.test(result.resultSha256)
    && Number.isSafeInteger(result.candidateCount)
    && result.candidateCount >= 0
    && result.candidateCount <= 5
    && result.queryCount === 1
  ) {
    return { outcome: "no_op_replay" };
  }
  if (result.status === "credential_unavailable" && exactFields(result, new Set(["status"]))) {
    return failWebAuthorization(client, job, "credential_unavailable", true);
  }
  if (result.status === "sourcing_disabled" && exactFields(result, new Set(["status"]))) {
    return failWebAuthorization(client, job, "sourcing_disabled", true);
  }
  if (result.status === "campaign_invalid" && exactFields(result, new Set(["status"]))) {
    return failWebAuthorization(client, job, "campaign_invalid", false);
  }
  if (
    result.status === "invalid_request"
    || result.status === "job_not_found"
    || result.status === "job_lease_invalid"
    || result.status === "claim_conflict"
  ) {
    return { outcome: "stale_lease" };
  }
  return { outcome: "unavailable", reason: "web_authorization_response_invalid" };
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

export async function runSourcingLoopTick(
  client,
  configuration,
  environment,
  fetcher = fetch,
  dependencies = {},
) {
  if (killSwitchEngaged(environment)) {
    return { status: "kill_switch_engaged" };
  }

  const failureCodes = [];

  const heartbeat = await recordSourcingLoopHeartbeat(client, configuration);
  if (heartbeat.status !== "ok") failureCodes.push(`heartbeat:${heartbeat.code}`);

  const jobReap = await client.rpc("reap_expired_aria_job_leases", { p_limit: 100 });
  if (jobReap.error) failureCodes.push("job_reap:rpc_error");

  const frameworkReap = await client.rpc("reap_expired_agent_framework_leases", { p_limit: 50 });
  if (frameworkReap.error) failureCodes.push("framework_reap:rpc_error");

  // Bound the email delivery-receipt dedup spine (default 180-day retention,
  // floored at 90 in-DB). Keeps the table from growing without limit.
  const receiptGc = await client.rpc("cleanup_email_ledger_delivery_receipts", { p_retention_days: 180 });
  if (receiptGc.error) failureCodes.push("receipt_gc:rpc_error");

  const dispatch = configuration.outboundDrainEnabled
    ? await drainOutbound(configuration, fetcher)
    : { status: "disabled" };
  if (dispatch.status !== "ok" && dispatch.status !== "unconfigured" && dispatch.status !== "disabled") {
    failureCodes.push(`dispatch:${dispatch.status}`);
  }

  let claimed = 0;
  let completed = 0;
  let replayed = 0;
  let retryScheduled = 0;
  let deadLettered = 0;
  let ambiguousDeadLettered = 0;
  let staleLeases = 0;
  if (SOURCING_HANDLER_KINDS.length > 0) {
    const claim = await client.rpc("claim_due_sourcing_batch_jobs", {
      p_worker_id: configuration.workerId,
      p_lease_seconds: SOURCING_JOB_LEASE_SECONDS,
      p_limit: configuration.sourcingGithubClaimConcurrency,
    });
    if (claim.error) {
      failureCodes.push("claim:rpc_error");
    } else if (Array.isArray(claim.data)) {
      claimed = claim.data.length;
      if (claim.data.length > configuration.sourcingGithubClaimConcurrency) {
        failureCodes.push("claim:response_limit_exceeded");
      } else if (claim.data.length > 0) {
        const handler = dependencies.handleSourcingBatchJob ?? handleSourcingBatchJob;
        const outcomes = await Promise.allSettled(claim.data.map((claimedJob) =>
          withCriticalPathTelemetry(
            "sourcing_batch",
            () => handleClaimedSourcingJob(
              claimedJob,
              client,
              configuration,
              fetcher,
              handler,
            ),
            { classify: classifyCriticalOutcome },
          ),
        ));
        for (const settled of outcomes) {
          const outcome = settled.status === "fulfilled"
            ? settled.value
            : { outcome: "unavailable", reason: "handler_exception" };
          if (!isValidSourcingBatchOutcome(outcome) && !exactWebOutcome(outcome)) {
            failureCodes.push("sourcing_batch:invalid_handler_outcome");
          } else if (outcome.outcome === "completed") {
            completed += 1;
          } else if (outcome.outcome === "no_op_replay") {
            replayed += 1;
          } else if (outcome.outcome === "retry_scheduled") {
            retryScheduled += 1;
          } else if (outcome.outcome === "dead_lettered") {
            deadLettered += 1;
            failureCodes.push("sourcing_batch:dead_lettered");
          } else if (outcome.outcome === "ambiguous_dead_lettered") {
            ambiguousDeadLettered += 1;
            failureCodes.push("sourcing_batch:ambiguous_dead_lettered");
          } else if (outcome.outcome === "stale_lease") {
            staleLeases += 1;
          } else {
            // Handler reasons can originate in provider/database envelopes.
            // Keep only the fixed, bounded outcome category in JSON logs.
            failureCodes.push("sourcing_batch:unavailable");
          }
        }
      }
    } else {
      failureCodes.push("claim:response_invalid");
    }
  }

  let requisitionParseClaimed = 0;
  if (configuration.requisitionParseUrl && REQUISITION_PARSE_HANDLER_KINDS.length > 0) {
    const parseClaim = await client.rpc("claim_due_aria_jobs", {
      p_worker_id: configuration.workerId,
      p_lease_seconds: REQUISITION_PARSE_LEASE_SECONDS,
      p_kinds: [...REQUISITION_PARSE_HANDLER_KINDS],
      p_limit: REQUISITION_PARSE_CLAIM_LIMIT,
    });
    if (parseClaim.error) {
      failureCodes.push("requisition_parse_claim:rpc_error");
    } else if (Array.isArray(parseClaim.data)) {
      requisitionParseClaimed = parseClaim.data.length;
      if (requisitionParseClaimed > REQUISITION_PARSE_CLAIM_LIMIT) {
        // Never turn a malformed/compromised response into unbounded paid
        // egress. Dispatch none and let the leases expire through the reaper.
        failureCodes.push("requisition_parse_claim:response_limit_exceeded");
      } else {
        for (const claimedJob of parseClaim.data) {
          const parseDispatch = await dispatchClaimedRequisitionParseJob(
            claimedJob,
            configuration,
            fetcher,
          );
          if (parseDispatch.status !== "ok") {
            failureCodes.push(`requisition_parse:${parseDispatch.status}`);
          }
        }
      }
    } else {
      failureCodes.push("requisition_parse_claim:response_invalid");
    }
  }

  let campaignCreateClaimed = 0;
  if (CAMPAIGN_CREATE_HANDLER_KINDS.length > 0) {
    const campaignClaim = await client.rpc("claim_due_aria_jobs", {
      p_worker_id: configuration.workerId,
      p_lease_seconds: CAMPAIGN_CREATE_LEASE_SECONDS,
      p_kinds: [...CAMPAIGN_CREATE_HANDLER_KINDS],
      p_limit: CAMPAIGN_CREATE_CLAIM_LIMIT,
    });
    if (campaignClaim.error) {
      failureCodes.push("campaign_create_claim:rpc_error");
    } else if (Array.isArray(campaignClaim.data)) {
      campaignCreateClaimed = campaignClaim.data.length;
      if (campaignCreateClaimed > CAMPAIGN_CREATE_CLAIM_LIMIT) {
        failureCodes.push("campaign_create_claim:response_limit_exceeded");
      } else {
        const handler = dependencies.handleCampaignCreateJob ?? handleCampaignCreateJob;
        const outcomes = await Promise.all(campaignClaim.data.map(async (claimedJob) => {
          try {
            return await withCriticalPathTelemetry(
              "campaign_create",
              () => handler(claimedJob, client),
              { classify: classifyCriticalOutcome },
            );
          } catch {
            return { outcome: "unavailable", reason: "handler_exception" };
          }
        }));
        for (const outcome of outcomes) {
          if (!isValidCampaignCreateOutcome(outcome)) {
            failureCodes.push("campaign_create:invalid_outcome");
          } else if (outcome.outcome !== "completed" && outcome.outcome !== "no_op_replay") {
            failureCodes.push(`campaign_create:${outcome.outcome}`);
          }
        }
      }
    } else {
      failureCodes.push("campaign_create_claim:response_invalid");
    }
  }

  return {
    status: failureCodes.length === 0 ? "ok" : "degraded",
    jobLeasesReaped: typeof jobReap.data === "number" ? jobReap.data : 0,
    frameworkLeasesReaped: typeof frameworkReap.data === "number" ? frameworkReap.data : 0,
    dispatch: dispatch.status,
    claimed,
    requisitionParseClaimed,
    campaignCreateClaimed,
    completed,
    replayed,
    retryScheduled,
    deadLettered,
    ambiguousDeadLettered,
    staleLeases,
    failureCodes,
  };
}

export function delay(milliseconds, signal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer === null) return;
      const activeTimer = timer;
      timer = null;
      clearTimeout(activeTimer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    // Close the small race between the caller's initial aborted check and
    // listener registration.
    if (signal.aborted) finish();
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
  const heartbeatPump = startSourcingLoopHeartbeatPump({
    client,
    configuration,
    environment,
    signal,
    logger,
  });
  try {
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
  } finally {
    heartbeatPump.stop();
  }
}

/** @param {unknown} [_cause] */
export function sourcingLoopCrashReceipt(kind, workerId, _cause) {
  return {
    event: "sourcing_loop_crash",
    kind,
    workerId,
    code: "worker_exception",
  };
}

function installCrashHandlers(workerId) {
  for (const [event, kind] of [["unhandledRejection", "unhandled_rejection"], ["uncaughtException", "uncaught_exception"]]) {
    process.on(event, () => {
      console.error(JSON.stringify(sourcingLoopCrashReceipt(kind, workerId)));
      process.exit(1);
    });
  }
}

async function main() {
  let configuration;
  try {
    registerObservability(process.env);
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
