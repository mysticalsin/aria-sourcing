import { createHash } from "node:crypto";

import type { JobAnalysis } from "@/lib/types";
import { buildCloudRequest, parseCloudResponse } from "@/lib/ai/provider";
import { buildIntakeParsePrompt, parseHermesIntakeJson, groundLiveIntakeFields, deriveValidationWarnings } from "@/lib/ai/intake";
import type {
  ActiveAiRuntimeBinding,
  ActiveAiRuntimeBindingResult,
  AiRuntimePurpose,
} from "@/lib/ai/runtime-binding";
import { JobAnalysisSchema } from "@/lib/sourcing/sourcing-agent-contract";
import { readBoundedResponseText, BoundedResponseError } from "@/lib/agents/framework/bounded-response";

const MAX_RESPONSE_BYTES = 64_000;
const MODEL_TIMEOUT_MS = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);
const PARSE_SYSTEM_PROMPT =
  "You are a precise data-extraction engine for recruiting briefs. Reply with JSON only.";

export interface RequisitionParseRpcResponse {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

export interface RequisitionParseRpcClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<RequisitionParseRpcResponse>;
}

export interface RequisitionParseJobInput {
  jobId: string;
  leaseId: string;
  workspaceId: string;
  requisitionId: string;
}

export interface RequisitionParseDependencies {
  getServiceClient(): RequisitionParseRpcClient | null;
  /** Resolves the database-approved runtime binding for this exact workspace and purpose. */
  resolveAiBinding(
    client: RequisitionParseRpcClient,
    workspaceId: string,
    purpose: AiRuntimePurpose,
  ): Promise<ActiveAiRuntimeBindingResult>;
  /** Decrypts only the binding-approved API key, scoped to this workspace. "" = unavailable/revoked. */
  resolveApiKeySecret(workspaceId: string, apiKeyId: string, expectedProvider: string): Promise<string>;
  fetcher?: typeof fetch;
  now?: () => number;
}

export type RequisitionParseOutcome =
  | { outcome: "completed"; ready: boolean }
  | { outcome: "no_op_replay" }
  | { outcome: "stale_lease" }
  | { outcome: "retry_scheduled"; reason: string }
  | { outcome: "dead_lettered"; reason: string }
  | { outcome: "unavailable"; reason: string };

function bounded(value: string | undefined, max: number): string {
  return (value ?? "").slice(0, max);
}

function boundedArray(values: string[] | undefined, maxItems: number, maxLength: number): string[] {
  return (values ?? []).slice(0, maxItems).map((value) => value.slice(0, maxLength));
}

function sameBindingAuthority(
  initial: ActiveAiRuntimeBinding,
  current: ActiveAiRuntimeBinding,
): boolean {
  return current.workspaceId === initial.workspaceId
    && current.bindingSetId === initial.bindingSetId
    && current.setSha256 === initial.setSha256
    && current.bindingId === initial.bindingId
    && current.purpose === initial.purpose
    && current.provider === initial.provider
    && current.credentialProvider === initial.credentialProvider
    && current.endpointProfile === initial.endpointProfile
    && current.model === initial.model
    && current.apiKeyId === initial.apiKeyId
    && current.catalogRevision === initial.catalogRevision
    && current.configSha256 === initial.configSha256;
}

/**
 * Reports `fail_aria_job`'s actual lease-transition result rather than
 * assuming success. `'queued'`/`'dead'` mean the transition really
 * happened; `'not_found'`/`'invalid_request'`/an RPC error mean the lease
 * was already gone (stolen/expired/reaped) and nothing was written for
 * this attempt — callers must never report retry/dead-letter success in
 * that case.
 */
async function failJob(
  client: RequisitionParseRpcClient,
  job: RequisitionParseJobInput,
  error: string,
  retryable: boolean,
): Promise<"queued" | "dead" | "lost"> {
  const response = await client.rpc("fail_aria_job", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_error: error.slice(0, 2_000),
    p_retryable: retryable,
  });
  if (response.error) return "lost";
  return response.data === "queued" || response.data === "dead" ? response.data : "lost";
}

async function failOutcome(
  client: RequisitionParseRpcClient,
  job: RequisitionParseJobInput,
  reason: string,
  retryable: boolean,
): Promise<RequisitionParseOutcome> {
  const transition = await failJob(client, job, reason, retryable);
  if (transition === "lost") return { outcome: "stale_lease" };
  return transition === "dead" ? { outcome: "dead_lettered", reason } : { outcome: "retry_scheduled", reason };
}

interface EgressClaim {
  claimToken: string;
  fenceVersion: number;
  egressAttemptId: string;
  provider: string;
  model: string;
}

/**
 * The ONLY authority used for a failure discovered after
 * `begin_requisition_parse_egress` succeeded. A retry from here would
 * re-authorize, re-begin, and call the provider a second time for work that
 * may already have gone out, so this never requeues: it atomically marks the
 * claim 'ambiguous' and the job 'dead' for an operator to reconcile. A
 * terminal outcome is reported only when that durable transition is
 * confirmed. Transport failures remain unavailable (and ownership loss is
 * stale) while the egress_started claim prevents any duplicate provider call;
 * the lease reaper later resolves an unconfirmed attempt to ambiguous/dead.
 */
async function failEgress(
  client: RequisitionParseRpcClient,
  job: RequisitionParseJobInput,
  claim: EgressClaim,
  reason: string,
): Promise<RequisitionParseOutcome> {
  const response = await client.rpc("fail_requisition_parse_egress", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_requisition_id: job.requisitionId,
    p_claim_token: claim.claimToken,
    p_fence_version: claim.fenceVersion,
    p_egress_attempt_id: claim.egressAttemptId,
    p_provider: claim.provider,
    p_model: claim.model,
    p_reason: reason.slice(0, 500),
  });
  if (response.error) {
    // Do not claim a durable terminal transition that the database did not
    // confirm. The claim remains egress_started and therefore cannot be
    // re-authorized; the lease reaper will move it to ambiguous/dead after
    // expiry without issuing another provider request.
    return { outcome: "unavailable", reason: `egress_state_unconfirmed:${reason}` };
  }
  const result = response.data as { status?: string } | null;
  if (result?.status === "marked_ambiguous") {
    return { outcome: "dead_lettered", reason };
  }
  if (result?.status === "lease_mismatch" || result?.status === "claim_lost") {
    return { outcome: "stale_lease" };
  }
  return { outcome: "unavailable", reason: `egress_state_unconfirmed:${reason}` };
}

/**
 * Process one claimed `requisition_parse` job. Loads only the current
 * workspace's requisition input, requires a database-approved cloud runtime
 * binding (never a synthetic/heuristic fallback), parses it into bounded
 * validated structured data, persists IDs/content only in the job spine, and
 * atomically enqueues `campaign_create` when the brief is ready. Never
 * creates candidates and never touches any send path.
 */
export async function handleRequisitionParseJob(
  job: RequisitionParseJobInput,
  deps: RequisitionParseDependencies,
): Promise<RequisitionParseOutcome> {
  const client = deps.getServiceClient();
  if (!client) return { outcome: "unavailable", reason: "service_client_unavailable" };

  // No provider egress or requisition mutation may occur before this
  // returns 'authorized': it is the single database-backed proof that this
  // exact lease is live and unexpired, the job is really a
  // requisition_parse job for this workspace whose payload names this
  // requisition, the input hash matches what was actually ingested, and
  // intake is currently enabled for this workspace.
  const authorization = await client.rpc("authorize_requisition_parse_job_v2", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_requisition_id: job.requisitionId,
  });
  if (authorization.error) {
    // The RPC did not prove that this handler owns the job. Mutating through
    // generic fail_aria_job here would let a forged parse dispatch requeue or
    // dead-letter an unrelated job kind.
    return { outcome: "stale_lease" };
  }
  const authorizationResult = authorization.data as {
    status?: string;
    workspace_id?: string;
    requisition_id?: string;
    content?: string;
    content_type?: string;
    need_sha256?: string;
    claim_token?: string;
    fence_version?: number;
    ready?: boolean;
  } | null;
  const authorizationStatus = authorizationResult?.status;
  if (authorizationStatus !== "authorized") {
    // A crash-recovered lost-response replay of an already-succeeded job is
    // proven entirely by the immutable receipt inside authorize itself, so
    // it short-circuits here with zero binding/vault/fetch/finalize calls.
    if (authorizationStatus === "no_op_replay") {
      return { outcome: "no_op_replay" };
    }
    // These statuses are returned only after job kind/workspace/payload/live
    // lease ownership has been established by the database, so it is safe to
    // transition this exact parse job. Every other denial is unowned/stale
    // and must be read-only.
    if (authorizationStatus === "input_not_found") {
      return failOutcome(client, job, "requisition_not_found_for_workspace", false);
    }
    if (authorizationStatus === "intake_disabled") {
      return failOutcome(client, job, "unauthorized_intake_disabled", true);
    }
    // The database atomically quarantined this exact current lease after it
    // discovered an older claim beyond the safe pre-egress state. No second
    // provider call occurred and no generic failure mutation is needed.
    if (authorizationStatus === "quarantined_ambiguous") {
      return { outcome: "dead_lettered", reason: "prior_egress_ambiguous" };
    }
    if (authorizationStatus === "duplicate_input_claim") {
      return failOutcome(client, job, "duplicate_input_claim", false);
    }
    // wrong_kind, wrong_workspace, lease_mismatch, lease_expired,
    // payload_mismatch, already_claimed, replay_conflict, job_not_found,
    // invalid_request: this exact call never owned the job, so it must
    // remain read-only.
    return { outcome: "stale_lease" };
  }
  if (!authorizationResult) return { outcome: "stale_lease" };

  if (
    authorizationResult.workspace_id !== job.workspaceId
    || authorizationResult.requisition_id !== job.requisitionId
    || typeof authorizationResult.content !== "string"
    || typeof authorizationResult.content_type !== "string"
    || !CONTENT_TYPES.has(authorizationResult.content_type)
    || typeof authorizationResult.need_sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(authorizationResult.need_sha256)
    || typeof authorizationResult.claim_token !== "string"
    || !UUID_RE.test(authorizationResult.claim_token)
    || typeof authorizationResult.fence_version !== "number"
    || !Number.isSafeInteger(authorizationResult.fence_version)
    || authorizationResult.fence_version < 1
  ) {
    return failOutcome(client, job, "requisition_context_invalid", false);
  }
  const sourceContent = authorizationResult.content;
  const contentType = authorizationResult.content_type;
  const inputSha256 = authorizationResult.need_sha256;
  const claimToken = authorizationResult.claim_token;
  const fenceVersion = authorizationResult.fence_version;

  const actualInputSha256 = createHash("sha256")
    .update(`${contentType}\n${sourceContent}`, "utf8")
    .digest("hex");
  if (actualInputSha256 !== inputSha256) {
    return failOutcome(client, job, "requisition_content_hash_mismatch", false);
  }

  const bindingResult = await deps.resolveAiBinding(client, job.workspaceId, "requisition_parse");
  if (!bindingResult.ok) {
    return failOutcome(
      client,
      job,
      `ai_binding_${bindingResult.code}`,
      bindingResult.code === "backend_error",
    );
  }
  const binding = bindingResult.binding;

  const secret = await deps.resolveApiKeySecret(
    job.workspaceId,
    binding.apiKeyId,
    binding.credentialProvider,
  );
  if (!secret) {
    return failOutcome(client, job, "ai_binding_credential_unavailable", false);
  }

  // The last gate before the provider is ever called: re-locks the job,
  // revalidates the exact live lease/claim token/fence version/workspace/
  // requisition/input hash/job payload/state and current controls, then
  // atomically binds provider+model, mints an egress_attempt_id, flips the
  // claim from 'claimed' to 'egress_started', and extends the lease to
  // cover the fetch plus the bounded read/parse/finalize that follow it. A
  // stale worker whose lease was already transferred to a newer claim
  // (crash -> reap -> re-lease -> re-authorize) is denied here, before it
  // can ever reach fetch.
  const begin = await client.rpc("begin_requisition_parse_egress", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_requisition_id: job.requisitionId,
    p_claim_token: claimToken,
    p_fence_version: fenceVersion,
    p_input_sha256: inputSha256,
    p_provider: binding.provider,
    p_model: binding.model,
  });
  if (begin.error) return { outcome: "stale_lease" };
  const beginResult = begin.data as { status?: string; egress_attempt_id?: string; fence_version?: number } | null;
  if (beginResult?.status !== "egress_started") {
    if (beginResult?.status === "intake_disabled") {
      return failOutcome(client, job, "unauthorized_intake_disabled", true);
    }
    // job_not_found/wrong_kind/wrong_workspace/payload_mismatch/
    // lease_mismatch/lease_expired/claim_lost/invalid_request: this exact
    // call no longer safely owns egress rights and must remain read-only —
    // no provider call, no fetch.
    return { outcome: "stale_lease" };
  }
  if (
    typeof beginResult.egress_attempt_id !== "string"
    || !UUID_RE.test(beginResult.egress_attempt_id)
    || typeof beginResult.fence_version !== "number"
    || !Number.isSafeInteger(beginResult.fence_version)
    || beginResult.fence_version !== fenceVersion
  ) {
    // The database says egress_started but the response is unusable: we
    // cannot safely proceed to finalize/fail without the attempt id, and we
    // must not guess one. Stay read-only here (no fetch happens either way)
    // — the claim is genuinely egress_started in the database now, so
    // expiry + the reaper will resolve it to ambiguous/dead on its own.
    return { outcome: "stale_lease" };
  }
  const claim: EgressClaim = {
    claimToken,
    fenceVersion: beginResult.fence_version,
    egressAttemptId: beginResult.egress_attempt_id,
    provider: binding.provider,
    model: binding.model,
  };

  // Secret resolution and the job-claim transaction can take long enough for
  // another admin to activate a different binding set. Re-resolve the exact
  // tenant authority after the durable egress claim and immediately before
  // fetch. If anything changed, record a terminal no-egress reconciliation
  // outcome rather than using a stale key/model combination.
  const currentBinding = await deps.resolveAiBinding(
    client,
    job.workspaceId,
    "requisition_parse",
  );
  if (!currentBinding.ok || !sameBindingAuthority(binding, currentBinding.binding)) {
    return failEgress(client, job, claim, "ai_binding_changed_before_egress");
  }

  const fetcher = deps.fetcher ?? fetch;
  const prompt = buildIntakeParsePrompt(sourceContent);
  const request = buildCloudRequest(binding.provider, binding.model, PARSE_SYSTEM_PROMPT, prompt, secret);

  // From here on exactly one provider call has been authorized for this
  // claim. Every failure from this point must go through failEgress, never
  // generic fail_aria_job: a retry would re-authorize, re-begin, and call
  // the (not known to be idempotent) provider a second time for work that
  // may have already gone out. The job is marked dead and the claim
  // ambiguous for an operator to reconcile — never automatically retried.
  let modelText: string;
  try {
    const response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return failEgress(client, job, claim, `model_http_${response.status}`);
    }
    const text = await readBoundedResponseText(response, MAX_RESPONSE_BYTES);
    const json: unknown = JSON.parse(text);
    modelText = parseCloudResponse(binding.provider, json);
  } catch (cause) {
    const reason = cause instanceof BoundedResponseError ? "model_response_too_large" : "model_call_failed";
    return failEgress(client, job, claim, reason);
  }

  const parsedFields = parseHermesIntakeJson(modelText);
  if (!parsedFields) {
    return failEgress(client, job, claim, "model_output_unparseable");
  }
  const fields = groundLiveIntakeFields(parsedFields, sourceContent);

  const jobAnalysisCandidate: JobAnalysis = {
    title: bounded(fields.title, 200),
    department: bounded(fields.department, 200),
    seniority: fields.seniority ?? "Unspecified",
    employmentType: fields.employmentType ?? "Unspecified",
    locationType: fields.locationType ?? "Unspecified",
    regions: boundedArray(fields.regions, 50, 200),
    timezone: bounded(fields.timezone, 100),
    salaryMin: fields.salaryMin ?? null,
    salaryMax: fields.salaryMax ?? null,
    currency: bounded(fields.currency, 20),
    equity: fields.equity ?? false,
    equityKnown: fields.equityKnown ?? false,
    requiredSkills: boundedArray(fields.requiredSkills, 100, 100),
    niceToHaveSkills: boundedArray(fields.niceToHaveSkills, 100, 100),
    minYearsExperience: fields.minYearsExperience ?? null,
    maxYearsExperience: fields.maxYearsExperience ?? null,
    education: bounded(fields.education, 500),
    industryExperience: boundedArray(fields.industryExperience, 50, 100),
    companyStageTarget: (fields.companyStageTarget ?? []).slice(0, 20),
    teamSize: bounded(fields.teamSize, 100),
    reportingTo: bounded(fields.reportingTo, 200),
    urgency: fields.urgency ?? "Standard",
    urgencyKnown: fields.urgencyKnown ?? false,
    language: fields.language,
    expectedStartDate: null,
    validationWarnings: [],
  };
  const validationWarnings = deriveValidationWarnings(jobAnalysisCandidate);
  const jobAnalysis: JobAnalysis = { ...jobAnalysisCandidate, validationWarnings };

  const validated = JobAnalysisSchema.safeParse(jobAnalysis);
  if (!validated.success) {
    return failEgress(client, job, claim, "bounded_validation_failed");
  }

  // The one atomic write: revalidates the exact same lease/token/fence/
  // attempt/kind/workspace/payload/input-hash/provider/model/controls facts
  // (closing the TOCTOU window the model call opened), computes readiness
  // server-side from validated.data itself (never trusts a client-computed
  // flag), records parse evidence, completes the job, flips the claim to
  // 'completed', and enqueues campaign_create when ready — all in one
  // transaction that rolls back together on any failure.
  const finalized = await client.rpc("finalize_requisition_parse", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_requisition_id: job.requisitionId,
    p_claim_token: claim.claimToken,
    p_fence_version: claim.fenceVersion,
    p_egress_attempt_id: claim.egressAttemptId,
    p_input_sha256: inputSha256,
    p_job_analysis: validated.data,
    p_warnings: validationWarnings,
    p_provider: binding.provider,
    p_model: binding.model,
  });
  if (finalized.error) {
    return failEgress(client, job, claim, "finalize_parse_failed");
  }
  const finalizedResult = finalized.data as { status?: string; ready?: boolean } | null;
  switch (finalizedResult?.status) {
    case "completed":
      if (typeof finalizedResult.ready === "boolean") {
        return { outcome: "completed", ready: finalizedResult.ready };
      }
      return failEgress(client, job, claim, "finalize_response_invalid");
    case "no_op_replay":
      return { outcome: "no_op_replay" };
    default:
      // Every denial reaching here happens after the provider was already
      // called for this claim: retrying would call it again. Always
      // terminal.
      return failEgress(client, job, claim, `unauthorized_${finalizedResult?.status ?? "unknown"}`);
  }
}
