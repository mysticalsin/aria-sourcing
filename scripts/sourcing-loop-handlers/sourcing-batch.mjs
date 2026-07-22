import { createHash } from "node:crypto";

import { discoverGithubCandidates } from "./github-discovery.mjs";
import {
  SOURCING_MAX_BATCH_ORDINAL,
  validateCanonicalGithubQuery,
  validateCanonicalGithubQueryForRoleBasis,
  validateDeterministicRoleBasis,
} from "./sourcing-query-policy.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SHA1_RE = /^[0-9a-f]{40}$/;
const SAFE_IDENTITY_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const IMAGE_DIGEST_RE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$/;
const REASON_MAX_LENGTH = 200;
const MAX_CANDIDATES = 3;
const AUTHORIZED_FIELDS = new Set([
  "activation_actor_id",
  "applied_lesson",
  "batch_ordinal",
  "campaign_id",
  "campaign_sha256",
  "canonical_query",
  "claim_token",
  "fence_version",
  "job_id",
  "lease_id",
  "provider_mode",
  "role_basis",
  "status",
  "workspace_id",
  "workspace_updated_at",
]);
const BEGIN_FIELDS = new Set([
  "campaign_id",
  "canonical_query_sha256",
  "claim_token",
  "egress_attempt_id",
  "fence_version",
  "job_id",
  "provider_mode",
  "status",
  "workspace_id",
]);
const REPLAY_FIELDS = new Set([
  "applied_lesson",
  "batch_ordinal",
  "campaign_id",
  "campaign_sha256",
  "candidate_count",
  "canonical_query",
  "job_id",
  "provider_mode",
  "query_count",
  "result_sha256",
  "status",
  "workspace_id",
]);
const APPLIED_LESSON_FIELDS = new Set([
  "graphify_artifact_sha256",
  "graphify_cluster_ref",
  "graphify_commit",
  "graphify_export_id",
  "graphify_image_digest",
  "lesson_id",
  "lesson_version",
  "promoted_by",
  "promotion_review_id",
  "query_hmac",
  "query_sha256",
  "query_value",
  "role_fingerprint",
  "snapshot_sha256",
  "workspace_id",
]);
const POLICY_PAUSE_FIELDS = new Set([
  "campaign_id",
  "job_id",
  "reason",
  "status",
]);

const AUTH_READ_ONLY_STATUSES = new Set([
  "invalid_request",
  "job_not_found",
  "wrong_kind",
  "wrong_workspace",
  "payload_mismatch",
  "lease_mismatch",
  "lease_expired",
  "replay_conflict",
]);
const AUTH_RETRYABLE_STATUSES = new Set([
  "activation_actor_invalid",
  "quota_exceeded",
  "sourcing_disabled",
  "workspace_unavailable",
]);
const AUTH_TERMINAL_STATUSES = new Set([
  "batch_out_of_range",
  "campaign_hash_mismatch",
  "campaign_not_sourcing",
  "campaign_not_found",
  "invalid_role_basis",
  "unsupported_provider_mode",
]);
const COMMIT_READ_ONLY_STATUSES = new Set([
  "invalid_request",
  "job_not_found",
  "wrong_kind",
  "wrong_workspace",
  "payload_mismatch",
  "lease_mismatch",
  "lease_expired",
  "replay_conflict",
]);
const COMMIT_RETRYABLE_STATUSES = new Set(["state_conflict", "workspace_unavailable"]);
const COMMIT_TERMINAL_STATUSES = new Set([
  "campaign_changed",
  "candidate_evidence_invalid",
  "idempotency_conflict",
  "query_invalid",
  "result_hash_invalid",
]);
const BEGIN_READ_ONLY_STATUSES = new Set([
  "already_begun",
  "claim_mismatch",
  "fence_mismatch",
  "invalid_request",
  "job_not_found",
  "lease_expired",
  "lease_mismatch",
  "payload_mismatch",
  "query_mismatch",
  "wrong_kind",
  "wrong_workspace",
]);
const BEGIN_RETRYABLE_STATUSES = new Set([
  "activation_actor_invalid",
  "sourcing_disabled",
  "workspace_unavailable",
]);
const BEGIN_TERMINAL_STATUSES = new Set([
  "campaign_changed",
  "campaign_not_sourcing",
]);
const EGRESS_FAILURE_FIELDS = new Set([
  "egress_attempt_id",
  "error_code",
  "job_id",
  "status",
]);
const EGRESS_RECOVERY_FIELDS = new Set([
  "candidate_count",
  "egress_attempt_id",
  "job_id",
  "query_count",
  "result_sha256",
  "status",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function appliedLessonSnapshotSha256(value) {
  return sha256([
    "aria.sourcing-lesson-snapshot.v1",
    value.workspace_id,
    value.role_fingerprint,
    value.lesson_id,
    String(value.lesson_version),
    value.promotion_review_id,
    value.promoted_by,
    value.graphify_export_id,
    value.graphify_artifact_sha256,
    value.graphify_image_digest,
    value.graphify_commit,
    value.graphify_cluster_ref,
    value.query_hmac,
    value.query_value,
    value.query_sha256,
  ].join("\n"));
}

export function validateAppliedSourcingLessonSnapshot(value, workspaceId, query) {
  if (value === null) return true;
  if (
    !exactFields(value, APPLIED_LESSON_FIELDS) ||
    typeof workspaceId !== "string" ||
    !UUID_RE.test(workspaceId) ||
    value.workspace_id !== workspaceId ||
    typeof value.role_fingerprint !== "string" ||
    !SHA256_RE.test(value.role_fingerprint) ||
    typeof value.lesson_id !== "string" ||
    !UUID_RE.test(value.lesson_id) ||
    !Number.isSafeInteger(value.lesson_version) ||
    value.lesson_version <= 0 ||
    typeof value.promotion_review_id !== "string" ||
    !UUID_RE.test(value.promotion_review_id) ||
    typeof value.promoted_by !== "string" ||
    !UUID_RE.test(value.promoted_by) ||
    typeof value.graphify_export_id !== "string" ||
    !UUID_RE.test(value.graphify_export_id) ||
    typeof value.graphify_artifact_sha256 !== "string" ||
    !SHA256_RE.test(value.graphify_artifact_sha256) ||
    typeof value.graphify_image_digest !== "string" ||
    !IMAGE_DIGEST_RE.test(value.graphify_image_digest) ||
    typeof value.graphify_commit !== "string" ||
    !SHA1_RE.test(value.graphify_commit) ||
    typeof value.graphify_cluster_ref !== "string" ||
    !SAFE_IDENTITY_RE.test(value.graphify_cluster_ref) ||
    typeof value.query_hmac !== "string" ||
    !SHA256_RE.test(value.query_hmac) ||
    typeof value.query_value !== "string" ||
    value.query_value !== query?.value ||
    typeof value.query_sha256 !== "string" ||
    value.query_sha256 !== query?.sha256 ||
    typeof value.snapshot_sha256 !== "string" ||
    value.snapshot_sha256 !== appliedLessonSnapshotSha256(value)
  ) {
    return false;
  }
  return true;
}

function boundedReason(error) {
  const raw =
    isRecord(error) && typeof error.code === "string"
      ? error.code
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : String(error ?? "unknown_error");
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, REASON_MAX_LENGTH);
}

function safeErrorCode(prefix, reason) {
  const combined = `${prefix}_${boundedReason(reason)}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return combined || `${prefix}_unknown`;
}

function discoveryFailureIsAmbiguous(code) {
  return code.endsWith("_transport_unknown") || code.endsWith("_response_read_unknown");
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isValidJobEnvelope(job) {
  return Boolean(
    isRecord(job) &&
      typeof job.id === "string" &&
      UUID_RE.test(job.id) &&
      typeof job.lease_id === "string" &&
      UUID_RE.test(job.lease_id) &&
      typeof job.workspace_id === "string" &&
      UUID_RE.test(job.workspace_id) &&
      job.kind === "sourcing_batch",
  );
}

function isValidJobPayload(payload) {
  return Boolean(
    exactFields(payload, new Set(["batch_ordinal", "campaign_id", "campaign_sha256"])) &&
      typeof payload.campaign_id === "string" &&
      UUID_RE.test(payload.campaign_id) &&
      typeof payload.campaign_sha256 === "string" &&
      SHA256_RE.test(payload.campaign_sha256) &&
      Number.isSafeInteger(payload.batch_ordinal) &&
      payload.batch_ordinal >= 0 &&
      payload.batch_ordinal <= SOURCING_MAX_BATCH_ORDINAL,
  );
}

function isExactAuthorization(result, job, providerMode) {
  if (!exactFields(result, AUTHORIZED_FIELDS)) return false;
  const roleBasisValid = validateDeterministicRoleBasis(result.role_basis).ok;
  const queryValid = roleBasisValid && validateCanonicalGithubQueryForRoleBasis(
    result.canonical_query,
    result.role_basis,
    job.payload.batch_ordinal,
  ).ok;
  return Boolean(
    result.status === "authorized" &&
      result.job_id === job.id &&
      result.lease_id === job.lease_id &&
      result.workspace_id === job.workspace_id &&
      result.campaign_id === job.payload.campaign_id &&
      result.campaign_sha256 === job.payload.campaign_sha256 &&
      result.batch_ordinal === job.payload.batch_ordinal &&
      typeof result.activation_actor_id === "string" &&
      UUID_RE.test(result.activation_actor_id) &&
      typeof result.claim_token === "string" &&
      UUID_RE.test(result.claim_token) &&
      Number.isSafeInteger(result.fence_version) &&
      result.fence_version > 0 &&
      result.provider_mode === providerMode &&
      isCanonicalTimestamp(result.workspace_updated_at) &&
      roleBasisValid &&
      queryValid &&
      validateAppliedSourcingLessonSnapshot(
        result.applied_lesson,
        job.workspace_id,
        result.canonical_query,
      ),
  );
}

function isExactBegin(result, job, authorization, canonicalQuerySha256) {
  return Boolean(
    exactFields(result, BEGIN_FIELDS) &&
      result.status === "begun" &&
      result.job_id === job.id &&
      result.workspace_id === job.workspace_id &&
      result.campaign_id === job.payload.campaign_id &&
      result.claim_token === authorization.claim_token &&
      result.fence_version === authorization.fence_version &&
      typeof result.egress_attempt_id === "string" &&
      UUID_RE.test(result.egress_attempt_id) &&
      result.provider_mode === authorization.provider_mode &&
      result.canonical_query_sha256 === canonicalQuerySha256,
  );
}

function isExactReplay(result, job) {
  const queryValid = validateCanonicalGithubQuery(result?.canonical_query).ok;
  return Boolean(
    exactFields(result, REPLAY_FIELDS) &&
      result.status === "no_op_replay" &&
      result.job_id === job.id &&
      result.workspace_id === job.workspace_id &&
      result.campaign_id === job.payload.campaign_id &&
      result.campaign_sha256 === job.payload.campaign_sha256 &&
      result.batch_ordinal === job.payload.batch_ordinal &&
      Number.isSafeInteger(result.candidate_count) &&
      result.candidate_count >= 0 &&
      result.candidate_count <= MAX_CANDIDATES &&
      result.query_count === 1 &&
      (result.provider_mode === "anonymous" || result.provider_mode === "authenticated") &&
      typeof result.result_sha256 === "string" &&
      SHA256_RE.test(result.result_sha256) &&
      queryValid &&
      validateAppliedSourcingLessonSnapshot(
        result.applied_lesson,
        job.workspace_id,
        result.canonical_query,
      ),
  );
}

function isExactPolicyPause(result, job, reason = "no_supported_query_terms") {
  return Boolean(
    exactFields(result, POLICY_PAUSE_FIELDS) &&
      result.status === "campaign_paused" &&
      result.job_id === job.id &&
      result.campaign_id === job.payload.campaign_id &&
      result.reason === reason,
  );
}

function isExactCommit(result, job, expectedCandidateCount, expectedResultSha256) {
  if (!isRecord(result)) return false;
  const expectedFields = new Set([
    "candidate_count",
    "job_id",
    "query_count",
    "result_sha256",
    "status",
  ]);
  return Boolean(
    exactFields(result, expectedFields) &&
      (result.status === "completed" || result.status === "no_op_replay") &&
      result.job_id === job.id &&
      result.candidate_count === expectedCandidateCount &&
      result.query_count === 1 &&
      result.result_sha256 === expectedResultSha256,
  );
}

async function callRpc(client, name, params) {
  try {
    const response = await client.rpc(name, params);
    if (!isRecord(response)) return { ok: false, reason: "invalid_rpc_response" };
    if (response.error) return { ok: false, reason: boundedReason(response.error) };
    return { ok: true, data: response.data };
  } catch (error) {
    return { ok: false, reason: boundedReason(error) };
  }
}

async function failOutcome(client, job, reason, retryable) {
  const failure = await callRpc(client, "fail_aria_job", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_error: reason.slice(0, 2_000),
    p_retryable: retryable,
  });
  if (!failure.ok) return { outcome: "unavailable", reason: failure.reason };
  if (failure.data === "queued") return { outcome: "retry_scheduled", reason };
  if (failure.data === "dead") return { outcome: "dead_lettered", reason };
  if (failure.data === "not_found") return { outcome: "stale_lease" };
  return { outcome: "unavailable", reason: "invalid_fail_response" };
}

function isExactEgressFailure(result, job, execution, reason) {
  return Boolean(
    exactFields(result, EGRESS_FAILURE_FIELDS) &&
      (result.status === "retry_scheduled" ||
        result.status === "dead_lettered" ||
        result.status === "ambiguous_dead_lettered") &&
      result.job_id === job.id &&
      result.egress_attempt_id === execution.egress_attempt_id &&
      result.error_code === reason,
  );
}

function isExactEgressRecovery(result, job, execution, expectedCommit) {
  return Boolean(
    expectedCommit &&
      exactFields(result, EGRESS_RECOVERY_FIELDS) &&
      (result.status === "completed" || result.status === "no_op_replay") &&
      result.job_id === job.id &&
      result.egress_attempt_id === execution.egress_attempt_id &&
      result.candidate_count === expectedCommit.candidateCount &&
      result.query_count === 1 &&
      result.result_sha256 === expectedCommit.resultSha256,
  );
}

async function settleEgressOutcome(
  client,
  job,
  authorization,
  execution,
  { reason, retryable, ambiguous, receipts, expectedCommit = null },
) {
  const settlement = await callRpc(client, "fail_sourcing_batch_egress", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_workspace_id: job.workspace_id,
    p_campaign_id: job.payload.campaign_id,
    p_campaign_sha256: job.payload.campaign_sha256,
    p_batch_ordinal: job.payload.batch_ordinal,
    p_claim_token: authorization.claim_token,
    p_fence_version: authorization.fence_version,
    p_egress_attempt_id: execution.egress_attempt_id,
    p_error_code: reason,
    p_retryable: retryable,
    p_ambiguous: ambiguous,
    p_source_receipts: receipts,
    p_result_sha256: expectedCommit?.resultSha256 ?? null,
    p_candidate_count: expectedCommit?.candidateCount ?? null,
    p_query_count: expectedCommit ? 1 : null,
  });
  if (!settlement.ok) return { outcome: "unavailable", reason: settlement.reason };
  if (isExactEgressRecovery(settlement.data, job, execution, expectedCommit)) {
    return {
      outcome: settlement.data.status,
      candidateCount: settlement.data.candidate_count,
      queryCount: settlement.data.query_count,
    };
  }
  if (!isExactEgressFailure(settlement.data, job, execution, reason)) {
    return { outcome: "unavailable", reason: "invalid_egress_settlement_response" };
  }
  if (settlement.data.status === "retry_scheduled") return { outcome: "retry_scheduled", reason };
  if (settlement.data.status === "dead_lettered") return { outcome: "dead_lettered", reason };
  return { outcome: "ambiguous_dead_lettered", reason };
}

function deterministicCandidateId(job, externalId) {
  return `github-${sha256(`${job.workspace_id}\n${job.payload.campaign_id}\ngithub\n${externalId}`).slice(0, 32)}`;
}

function avatarInitials(name) {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
}

function mapCandidate(job, query, observed, sourcedAt) {
  return {
    id: deterministicCandidateId(job, observed.externalId),
    campaignId: job.payload.campaign_id,
    name: observed.displayName,
    email: "",
    phone: "",
    avatarInitials: avatarInitials(observed.displayName),
    currentTitle: "",
    currentCompany: observed.company ?? "",
    location: observed.location ?? "",
    timezone: "",
    linkedinUrl: "",
    githubUrl: observed.githubUrl,
    sourceUrl: observed.githubUrl,
    sourceExternalId: observed.externalId,
    externalIds: { GitHub: observed.externalId },
    sourcePlatform: "GitHub",
    sourceQuery: query.value,
    matchScore: 0,
    matchBreakdown: [],
    // The exact search relevance is retained in sourceEvidence below. It is
    // deliberately not promoted into a candidate skill or personalization
    // fact: a provider search hit is weaker than verified work history.
    techStack: [],
    experience: [],
    education: [],
    languages: [],
    yearsExperience: null,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: {
      doNotContact: false,
      suppressed: false,
      unsubscribed: false,
      gdprExportRequested: false,
      anonymized: false,
      suppressedUntil: null,
    },
    createdAt: sourcedAt,
    provenance: "live",
    sourceEvidence: {
      provider: "github",
      externalId: observed.externalId,
      login: observed.login,
      displayName: observed.displayName,
      company: observed.company,
      location: observed.location,
      bio: observed.bio,
      githubUrl: observed.githubUrl,
      publicRepoCount: observed.publicRepoCount,
      followerCount: observed.followerCount,
      accountCreatedAt: observed.accountCreatedAt,
      matchedLanguage: observed.matchedLanguage,
      searchResultOrdinal: observed.searchResultOrdinal,
      searchResponseSha256: observed.searchResponseSha256,
      rawResponseSha256: observed.rawResponseSha256,
      normalizedPayloadSha256: observed.normalizedPayloadSha256,
    },
  };
}

function resultSha256(job, authorization, execution, query, candidates) {
  const evidence = candidates.map((candidate) => ({
    id: candidate.id,
    externalId: candidate.sourceEvidence.externalId,
    rawResponseSha256: candidate.sourceEvidence.rawResponseSha256,
    normalizedPayloadSha256: candidate.sourceEvidence.normalizedPayloadSha256,
  }));
  return sha256(JSON.stringify({
    version: "aria.sourcing-batch-result.v1",
    workspaceId: job.workspace_id,
    jobId: job.id,
    campaignId: job.payload.campaign_id,
    campaignSha256: job.payload.campaign_sha256,
    batchOrdinal: job.payload.batch_ordinal,
    claimToken: authorization.claim_token,
    fenceVersion: authorization.fence_version,
    egressAttemptId: execution.egress_attempt_id,
    providerMode: authorization.provider_mode,
    query,
    candidates: evidence,
  }));
}

export function isValidSourcingBatchOutcome(value) {
  if (!isRecord(value)) return false;
  if (value.outcome === "completed" || value.outcome === "no_op_replay") {
    return (
      Number.isSafeInteger(value.candidateCount) &&
      value.candidateCount >= 0 &&
      value.candidateCount <= MAX_CANDIDATES &&
      value.queryCount === 1
    );
  }
  if (value.outcome === "stale_lease") return Object.keys(value).length === 1;
  if (
    value.outcome === "retry_scheduled" ||
    value.outcome === "dead_lettered" ||
    value.outcome === "ambiguous_dead_lettered" ||
    value.outcome === "unavailable"
  ) {
    return typeof value.reason === "string" && value.reason.length >= 1 && value.reason.length <= 2_000;
  }
  return false;
}

/**
 * Consume one leased sourcing_batch job. The handler never reads campaign
 * context directly, never accepts a query from the job, and never marks a job
 * complete separately from the database's atomic evidence commit.
 */
export async function handleSourcingBatchJob(job, client, options) {
  if (!client || typeof client.rpc !== "function") {
    return { outcome: "unavailable", reason: "service_client_unavailable" };
  }
  if (!isValidJobEnvelope(job)) {
    return { outcome: "unavailable", reason: "invalid_job_envelope" };
  }
  if (!isValidJobPayload(job.payload)) {
    return { outcome: "unavailable", reason: "invalid_job_payload" };
  }
  const requestedProviderMode = options?.credential?.kind;
  if (requestedProviderMode !== "anonymous" && requestedProviderMode !== "authenticated") {
    return { outcome: "unavailable", reason: "invalid_provider_mode" };
  }

  const authorization = await callRpc(client, "authorize_sourcing_batch", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_workspace_id: job.workspace_id,
    p_campaign_id: job.payload.campaign_id,
    p_campaign_sha256: job.payload.campaign_sha256,
    p_batch_ordinal: job.payload.batch_ordinal,
    p_provider_mode: requestedProviderMode,
  });
  if (!authorization.ok) return { outcome: "unavailable", reason: authorization.reason };
  const authorizationResult = authorization.data;
  if (isRecord(authorizationResult) && authorizationResult.status === "no_op_replay") {
    if (!isExactReplay(authorizationResult, job)) {
      return { outcome: "unavailable", reason: "invalid_authorization_replay" };
    }
    return {
      outcome: "no_op_replay",
      candidateCount: authorizationResult.candidate_count,
      queryCount: authorizationResult.query_count,
    };
  }
  const authorizationStatus = isRecord(authorizationResult) ? authorizationResult.status : undefined;
  if (authorizationStatus === "campaign_paused") {
    return isExactPolicyPause(authorizationResult, job)
      ? { outcome: "dead_lettered", reason: authorizationResult.reason }
      : { outcome: "unavailable", reason: "invalid_policy_pause_response" };
  }
  if (authorizationStatus !== "authorized") {
    if (AUTH_READ_ONLY_STATUSES.has(authorizationStatus)) return { outcome: "stale_lease" };
    if (AUTH_RETRYABLE_STATUSES.has(authorizationStatus)) {
      return failOutcome(client, job, authorizationStatus, true);
    }
    if (AUTH_TERMINAL_STATUSES.has(authorizationStatus)) {
      return failOutcome(client, job, authorizationStatus, false);
    }
    return { outcome: "unavailable", reason: "unknown_authorization_response" };
  }
  if (!isExactAuthorization(authorizationResult, job, requestedProviderMode)) {
    return { outcome: "unavailable", reason: "invalid_authorization_response" };
  }

  const query = authorizationResult.canonical_query;

  const begin = await callRpc(client, "begin_sourcing_batch_egress", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_workspace_id: job.workspace_id,
    p_campaign_id: job.payload.campaign_id,
    p_campaign_sha256: job.payload.campaign_sha256,
    p_batch_ordinal: job.payload.batch_ordinal,
    p_claim_token: authorizationResult.claim_token,
    p_fence_version: authorizationResult.fence_version,
    p_provider_mode: authorizationResult.provider_mode,
    p_canonical_query_sha256: query.sha256,
  });
  if (!begin.ok) return { outcome: "unavailable", reason: begin.reason };
  const execution = begin.data;
  const beginStatus = isRecord(execution) ? execution.status : undefined;
  if (beginStatus !== "begun") {
    if (BEGIN_READ_ONLY_STATUSES.has(beginStatus)) return { outcome: "stale_lease" };
    if (BEGIN_RETRYABLE_STATUSES.has(beginStatus)) {
      return failOutcome(client, job, beginStatus, true);
    }
    if (BEGIN_TERMINAL_STATUSES.has(beginStatus)) {
      return failOutcome(client, job, beginStatus, false);
    }
    return { outcome: "unavailable", reason: "unknown_egress_begin_response" };
  }
  if (!isExactBegin(execution, job, authorizationResult, query.sha256)) {
    return { outcome: "unavailable", reason: "invalid_egress_begin_response" };
  }

  let discovery;
  try {
    discovery = await discoverGithubCandidates({
      credential: options?.credential,
      approvedRoleBasis: authorizationResult.role_basis,
      batchOrdinal: job.payload.batch_ordinal,
      query,
      resultLimit: options?.resultLimit,
      perCallTimeoutMs: options?.perCallTimeoutMs,
      overallDeadlineMs: options?.overallDeadlineMs,
      fetcher: options?.fetcher,
      signal: options?.signal,
      now: options?.now,
    });
  } catch {
    return settleEgressOutcome(client, job, authorizationResult, execution, {
      reason: "discovery_configuration_invalid",
      retryable: false,
      ambiguous: false,
      receipts: [],
    });
  }
  if (!discovery.ok) {
    const ambiguous = discoveryFailureIsAmbiguous(discovery.code);
    return settleEgressOutcome(client, job, authorizationResult, execution, {
      reason: discovery.code,
      retryable: ambiguous ? false : discovery.retryable,
      ambiguous,
      receipts: discovery.receipts,
    });
  }

  const now = typeof options?.now === "function" ? options.now : Date.now;
  const sourcedAt = new Date(now()).toISOString();
  const candidates = discovery.candidates.map((candidate) =>
    mapCandidate(job, query, candidate, sourcedAt));
  const resultHash = resultSha256(job, authorizationResult, execution, query, candidates);
  const expectedCommit = { resultSha256: resultHash, candidateCount: candidates.length };
  const commit = await callRpc(client, "commit_sourcing_batch", {
    p_job_id: job.id,
    p_lease_id: job.lease_id,
    p_workspace_id: job.workspace_id,
    p_campaign_id: job.payload.campaign_id,
    p_campaign_sha256: job.payload.campaign_sha256,
    p_batch_ordinal: job.payload.batch_ordinal,
    p_claim_token: authorizationResult.claim_token,
    p_fence_version: authorizationResult.fence_version,
    p_egress_attempt_id: execution.egress_attempt_id,
    p_query: query,
    p_candidates: candidates,
    p_source_receipts: discovery.receipts,
    p_result_sha256: resultHash,
  });
  if (!commit.ok) {
    return settleEgressOutcome(client, job, authorizationResult, execution, {
      reason: safeErrorCode("commit", commit.reason),
      retryable: false,
      ambiguous: true,
      receipts: discovery.receipts,
      expectedCommit,
    });
  }
  const commitResult = commit.data;
  const commitStatus = isRecord(commitResult) ? commitResult.status : undefined;
  if (commitStatus === "completed" || commitStatus === "no_op_replay") {
    if (!isExactCommit(commitResult, job, candidates.length, resultHash)) {
      return settleEgressOutcome(client, job, authorizationResult, execution, {
        reason: "commit_response_invalid",
        retryable: false,
        ambiguous: true,
        receipts: discovery.receipts,
        expectedCommit,
      });
    }
    return {
      outcome: commitStatus,
      candidateCount: commitResult.candidate_count,
      queryCount: commitResult.query_count,
    };
  }
  if (COMMIT_READ_ONLY_STATUSES.has(commitStatus)) return { outcome: "stale_lease" };
  if (COMMIT_RETRYABLE_STATUSES.has(commitStatus)) {
    return settleEgressOutcome(client, job, authorizationResult, execution, {
      reason: commitStatus,
      retryable: true,
      ambiguous: false,
      receipts: discovery.receipts,
      expectedCommit,
    });
  }
  if (COMMIT_TERMINAL_STATUSES.has(commitStatus)) {
    return settleEgressOutcome(client, job, authorizationResult, execution, {
      reason: commitStatus,
      retryable: false,
      ambiguous: false,
      receipts: discovery.receipts,
      expectedCommit,
    });
  }
  return settleEgressOutcome(client, job, authorizationResult, execution, {
    reason: "commit_response_unknown",
    retryable: false,
    ambiguous: true,
    receipts: discovery.receipts,
    expectedCommit,
  });
}
