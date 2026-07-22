// campaign-create.mjs — the campaign_create job handler (Plan 05).
//
// Consumes one claimed `campaign_create` job and calls
// finalize_campaign_create_job, the sole database authority for this stage.
// This stage performs no network/provider egress, so unlike
// requisition_parse (src/lib/needs/requisition-parse.ts) there is no
// authorize/begin-egress split or execution-claim fencing: one RPC call
// proves ownership, does the work, and finishes the job atomically. It is
// therefore invoked directly by the loop worker (no internal HTTP route, no
// bearer secret) rather than dispatched to the web process.

const OUTCOME_VALUES = new Set([
  "completed",
  "no_op_replay",
  "stale_lease",
  "retry_scheduled",
  "dead_lettered",
  "unavailable",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function isValidCampaignCreateOutcome(outcome) {
  if (!outcome || typeof outcome !== "object" || !OUTCOME_VALUES.has(outcome.outcome)) {
    return false;
  }
  if (
    (outcome.outcome === "retry_scheduled" || outcome.outcome === "dead_lettered" || outcome.outcome === "unavailable")
    && (typeof outcome.reason !== "string" || outcome.reason.length < 1 || outcome.reason.length > 2_000)
  ) {
    return false;
  }
  return true;
}

/**
 * Reports `fail_aria_job`'s actual lease transition. Only explicit
 * `queued`/`dead` values prove a write; `not_found` proves a stale lease, and
 * transport/error envelopes remain unavailable because ownership is unknown.
 */
async function failOutcome(client, job, reason, retryable) {
  let response;
  try {
    response = await client.rpc("fail_aria_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_error: reason.slice(0, 2_000),
      p_retryable: retryable,
    });
  } catch (error) {
    return { outcome: "unavailable", reason: boundedReason(error) };
  }
  if (!response || typeof response !== "object") {
    return { outcome: "unavailable", reason: "invalid_fail_response" };
  }
  if (response.error) {
    return { outcome: "unavailable", reason: boundedReason(response.error) };
  }
  if (response.data === "dead") return { outcome: "dead_lettered", reason };
  if (response.data === "queued") return { outcome: "retry_scheduled", reason };
  if (response.data === "not_found") return { outcome: "stale_lease" };
  return { outcome: "unavailable", reason: "invalid_fail_response" };
}

// finalize_campaign_create_job statuses proving this exact call never
// owned/proved the job (plus `invalid_request`, which proves the envelope
// itself was never valid enough to reach ownership checks): never call
// fail_aria_job for these, or a forged or duplicate call could requeue or
// dead-letter a job it does not own.
const READ_ONLY_STATUSES = new Set([
  "invalid_request",
  "job_not_found",
  "wrong_kind",
  "wrong_workspace",
  "payload_mismatch",
  "lease_mismatch",
  "lease_expired",
  "replay_conflict",
]);

// Transient: the campaign cannot be created right now, but a later attempt
// may succeed once an operator re-enables sourcing or restores admin
// membership for the activation actor.
const RETRYABLE_STATUSES = new Set([
  "sourcing_disabled",
  "activation_actor_invalid",
  "workspace_unavailable",
]);

// Terminal: not-ready, bad parse evidence, and an invalid role basis will
// not resolve by retrying the exact same job. `state_conflict` is not
// reachable here: finalize_campaign_create_job raises (never returns a
// status) once the campaign row is written, so a lost requisition-update
// race surfaces as an RPC error, not this status.
const TERMINAL_STATUSES = new Set([
  "requisition_not_ready",
  "parse_receipt_mismatch",
  "invalid_role_basis",
]);

const REASON_MAX_LENGTH = 200;

function boundedReason(error) {
  const raw =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : error && typeof error === "object" && typeof error.message === "string"
        ? error.message
      : String(error ?? "unknown_error");
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, REASON_MAX_LENGTH);
}

/**
 * Validates the claimed job row itself before any RPC call is made. A
 * malformed or incomplete envelope (missing id/lease/workspace, wrong kind)
 * cannot be safely handed to finalize_campaign_create_job or fail_aria_job:
 * neither call can prove ownership of a job it cannot even identify.
 */
function isValidClaimedJobEnvelope(job) {
  return Boolean(
    job &&
      typeof job === "object" &&
      typeof job.id === "string" &&
      UUID_RE.test(job.id) &&
      typeof job.lease_id === "string" &&
      UUID_RE.test(job.lease_id) &&
      typeof job.workspace_id === "string" &&
      UUID_RE.test(job.workspace_id) &&
      job.kind === "campaign_create",
  );
}

function isExactSuccessfulResponse(result, job, requisitionId) {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result.status === "completed" || result.status === "no_op_replay") &&
      result.job_id === job.id &&
      typeof result.campaign_id === "string" &&
      UUID_RE.test(result.campaign_id) &&
      typeof result.campaign_sha256 === "string" &&
      SHA256_RE.test(result.campaign_sha256) &&
      typeof result.sourcing_job_id === "string" &&
      UUID_RE.test(result.sourcing_job_id) &&
      typeof requisitionId === "string" &&
      UUID_RE.test(requisitionId),
  );
}

/**
 * Process one claimed `campaign_create` job. The database authority projects
 * the app campaign and relational identity atomically. This handler never
 * creates candidates or calls a provider.
 */
export async function handleCampaignCreateJob(job, client) {
  if (!client) return { outcome: "unavailable", reason: "service_client_unavailable" };
  if (!isValidClaimedJobEnvelope(job)) {
    return { outcome: "unavailable", reason: "invalid_job_envelope" };
  }

  const payload = job.payload;
  const requisitionId = payload?.requisition_id;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !Object.hasOwn(payload, "requisition_id") ||
    typeof requisitionId !== "string" ||
    !UUID_RE.test(requisitionId)
  ) {
    // A malformed payload is not enough proof to mutate the claimed job. Let
    // the lease expire into the normal reaper path and surface degraded state.
    return { outcome: "unavailable", reason: "invalid_job_payload" };
  }

  let finalized;
  try {
    finalized = await client.rpc("finalize_campaign_create_job", {
      p_job_id: job.id,
      p_lease_id: job.lease_id,
      p_workspace_id: job.workspace_id,
      p_requisition_id: requisitionId,
    });
  } catch (error) {
    // Transport-level failure (network, timeout, driver throw): the RPC
    // never ran, so nothing about ownership was proven either way. Report
    // degraded service rather than guessing at a lease/ownership outcome.
    return { outcome: "unavailable", reason: boundedReason(error) };
  }
  if (!finalized || typeof finalized !== "object") {
    return { outcome: "unavailable", reason: "invalid_rpc_response" };
  }
  if (finalized.error) {
    // Same reasoning for a returned (rather than thrown) transport/handler
    // error: the RPC did not prove ownership, so mutating through generic
    // fail_aria_job here would let a forged or duplicate call requeue or
    // dead-letter a job it does not own.
    return { outcome: "unavailable", reason: boundedReason(finalized.error) };
  }
  const result = finalized.data;
  const status = result && typeof result === "object" ? result.status : undefined;

  if (status === "completed" || status === "no_op_replay") {
    if (!isExactSuccessfulResponse(result, job, requisitionId)) {
      return { outcome: "unavailable", reason: "invalid_finalize_response" };
    }
    return { outcome: status };
  }
  if (READ_ONLY_STATUSES.has(status)) return { outcome: "stale_lease" };
  if (status === undefined) return { outcome: "unavailable", reason: "invalid_finalize_response" };
  if (RETRYABLE_STATUSES.has(status)) return failOutcome(client, job, status, true);
  if (TERMINAL_STATUSES.has(status)) return failOutcome(client, job, status, false);
  // Unknown database responses are never authority to mutate a leased job.
  return { outcome: "unavailable", reason: "unknown_finalize_response" };
}
