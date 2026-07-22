import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { decryptSecret } from "@/lib/crypto-secrets";

const UuidSchema = z.string().uuid();
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const LocatorSchema = z.object({
  jobId: UuidSchema,
  leaseId: UuidSchema,
  workspaceId: UuidSchema,
  campaignId: UuidSchema,
  claimToken: UuidSchema,
  fenceVersion: z.number().int().positive(),
}).strict();
const RequestSchema = z.object({
  query: z.string().min(1).max(500),
  search_depth: z.literal("basic"),
  max_results: z.literal(5),
  include_domains: z.tuple([z.literal("linkedin.com")]),
  include_answer: z.literal(false),
  include_images: z.literal(false),
}).strict();
const BegunSchema = z.object({
  status: z.literal("begun"),
  egressAttemptId: UuidSchema,
  provider: z.literal("tavily"),
  credentialId: UuidSchema,
  credentialVersion: HashSchema,
  queryPolicyVersion: z.literal("tavily-linkedin-deterministic-v1"),
  canonicalQuerySha256: HashSchema,
  requestSha256: HashSchema,
  request: RequestSchema,
  egressExpiresAt: z.string().datetime({ offset: true }),
}).strict();
const AlreadyBegunSchema = z.object({
  status: z.literal("already_begun"),
  egressAttemptId: UuidSchema,
}).strict();
const BeginNoOpReplaySchema = z.object({
  status: z.literal("no_op_replay"),
}).strict();
const ConfirmedSchema = z.object({
  status: z.literal("confirmed"),
  egressAttemptId: UuidSchema,
  mustStartBy: z.string().datetime({ offset: true }),
}).strict();
const AlreadyConfirmedSchema = z.object({
  status: z.literal("already_confirmed"),
  egressAttemptId: UuidSchema,
  mustStartBy: z.string().datetime({ offset: true }),
}).strict();
const RecordedSchema = z.object({
  status: z.literal("recorded"),
  resultSha256: HashSchema,
  candidateCount: z.number().int().min(0).max(5),
}).strict();
const CompletedSchema = z.object({
  status: z.enum(["completed", "no_op_replay"]),
  resultSha256: HashSchema,
  candidateCount: z.number().int().min(0).max(5),
}).strict();
const ResultBindingInvalidSchema = z.object({
  status: z.literal("result_binding_invalid"),
}).strict();
const ReconcileSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    resultSha256: HashSchema,
    candidateCount: z.number().int().min(0).max(5),
  }).strict(),
  z.object({
    status: z.literal("result_ready"),
    resultSha256: HashSchema,
    candidateCount: z.number().int().min(0).max(5),
  }).strict(),
  z.object({
    status: z.literal("no_durable_response"),
    resultSha256: z.null(),
  }).strict(),
  z.object({ status: z.literal("not_reconcilable") }).strict(),
]);

export interface AutonomousWebRpcClient {
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface CredentialQueryResult {
  data: unknown;
  error: unknown;
}

interface AutonomousWebCredentialQuery {
  select(columns: string): AutonomousWebCredentialQuery;
  eq(column: string, value: unknown): AutonomousWebCredentialQuery;
  in(column: string, values: readonly unknown[]): AutonomousWebCredentialQuery;
  maybeSingle(): PromiseLike<CredentialQueryResult>;
}

const TAVILY_VERIFICATION_METHODS = ["tavily_usage_v1", "tavily_key_info_v1"] as const;

function isVerifiedTavilyMethod(value: unknown): value is (typeof TAVILY_VERIFICATION_METHODS)[number] {
  return typeof value === "string" && TAVILY_VERIFICATION_METHODS.includes(
    value as (typeof TAVILY_VERIFICATION_METHODS)[number],
  );
}

export interface AutonomousWebCredentialClient {
  from(table: string): AutonomousWebCredentialQuery;
}

export interface WorkspaceTavilyCredential {
  kind: "workspace";
  authorizationHeader(): string;
}

export interface SuccessfulAutonomousWebSearch {
  ok: true;
  normalizedResults: Array<{
    url: string;
    title: string;
    content: string;
    score: number;
  }>;
  rawResponseSha256: string;
  rawResponseBytes: number;
  providerReceipt: Record<string, unknown>;
}

export interface FailedAutonomousWebSearch {
  ok: false;
  code: string;
  retryable: boolean;
  ambiguous: boolean;
}

export interface AutonomousWebRuntimeDependencies {
  resolveCredential(
    client: AutonomousWebRpcClient,
    workspaceId: string,
    credentialId: string,
    credentialVersion: string,
  ): Promise<WorkspaceTavilyCredential | null>;
  executeSearch(options: {
    authority: {
      provider: "tavily";
      queryPolicyVersion: "tavily-linkedin-deterministic-v1";
      canonicalQuerySha256: string;
      requestSha256: string;
      request: z.infer<typeof RequestSchema>;
    };
    credential: WorkspaceTavilyCredential;
    timeoutMs: number;
    fetcher: typeof fetch;
  }): Promise<SuccessfulAutonomousWebSearch | FailedAutonomousWebSearch>;
  fetcher?: typeof fetch;
  now?: () => number;
}

export type AutonomousWebSourcingOutcome =
  | { outcome: "completed"; candidateCount: number; queryCount: 1 }
  | { outcome: "no_op_replay" }
  | { outcome: "stale_lease" }
  | { outcome: "retry_scheduled"; reason: string }
  | { outcome: "dead_lettered"; reason: string }
  | { outcome: "ambiguous_dead_lettered"; reason: string }
  | { outcome: "unavailable"; reason: string };

function canonicalPostgresTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}.000${match[3]}`);
  if (!Number.isFinite(parsed)) return null;
  return `${new Date(parsed).toISOString().slice(0, 19)}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}

function sameUtf8(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Read only the exact 0060-approved tenant credential and independently
 * recompute its immutable version before any provider request. The secret is
 * exposed only through a non-enumerable closure and is never returned as data.
 */
export async function resolveAutonomousWebTavilyCredential(
  client: AutonomousWebCredentialClient,
  workspaceId: string,
  credentialId: string,
  expectedVersion: string,
  decrypt: (stored: string) => string = decryptSecret,
): Promise<WorkspaceTavilyCredential | null> {
  if (
    !UuidSchema.safeParse(workspaceId).success
    || !UuidSchema.safeParse(credentialId).success
    || !HashSchema.safeParse(expectedVersion).success
  ) {
    return null;
  }
  const query = client
    .from("api_keys")
    .select(
      "id,workspace_id,provider,status,secret,last4,last_tested_at,verification_method,verification_http_status",
    );
  const { data, error } = await query
    .eq("id", credentialId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "Tavily")
    .eq("status", "valid")
    .in("verification_method", TAVILY_VERIFICATION_METHODS)
    .eq("verification_http_status", 200)
    .maybeSingle();
  if (error || typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const testedAt = canonicalPostgresTimestamp(row.last_tested_at);
  if (
    row.id !== credentialId
    || row.workspace_id !== workspaceId
    || row.provider !== "Tavily"
    || row.status !== "valid"
    || typeof row.last4 !== "string"
    || row.last4.length !== 4
    || testedAt === null
    || !isVerifiedTavilyMethod(row.verification_method)
    || row.verification_http_status !== 200
    || typeof row.secret !== "string"
  ) {
    return null;
  }
  const actualVersion = createHash("sha256").update([
    "aria.autonomous-web-credential.v1",
    credentialId,
    workspaceId,
    "Tavily",
    row.last4,
    testedAt,
    row.verification_method,
    "200",
  ].join("\n"), "utf8").digest("hex");
  if (!sameUtf8(actualVersion, expectedVersion)) return null;
  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch {
    return null;
  }
  if (
    typeof secret !== "string"
    || !/^tvly-[^\s\u0000-\u001f\u007f]{15,507}$/.test(secret)
    || secret.length > 512
    || !sameUtf8(secret.slice(-4), row.last4)
  ) {
    return null;
  }
  const credential = { kind: "workspace" as const } as WorkspaceTavilyCredential;
  Object.defineProperty(credential, "authorizationHeader", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => `Bearer ${secret}`,
  });
  return Object.freeze(credential);
}

async function callRpc(
  client: AutonomousWebRpcClient,
  name: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const response = await client.rpc(name, params);
    if (response.error) return { ok: false };
    return { ok: true, data: response.data };
  } catch {
    return { ok: false };
  }
}

function safeCode(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) return fallback;
  return value;
}

function beginParams(job: z.infer<typeof LocatorSchema>) {
  return {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_campaign_id: job.campaignId,
    p_claim_token: job.claimToken,
    p_fence_version: job.fenceVersion,
  };
}

async function reconcile(
  client: AutonomousWebRpcClient,
  job: z.infer<typeof LocatorSchema>,
  attemptId: string,
  resultSha256: string | null = null,
) {
  const response = await callRpc(client, "reconcile_autonomous_web_sourcing", {
    p_job_id: job.jobId,
    p_workspace_id: job.workspaceId,
    p_egress_attempt_id: attemptId,
    p_result_sha256: resultSha256,
  });
  if (!response.ok) return null;
  const parsed = ReconcileSchema.safeParse(response.data);
  return parsed.success ? parsed.data : null;
}

async function failAttempt(
  client: AutonomousWebRpcClient,
  job: z.infer<typeof LocatorSchema>,
  attemptId: string,
  reason: string,
  retryable: boolean,
  ambiguous: boolean,
): Promise<AutonomousWebSourcingOutcome> {
  const code = safeCode(reason, "runtime_failure");
  const response = await callRpc(client, "fail_autonomous_web_sourcing", {
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_claim_token: job.claimToken,
    p_fence_version: job.fenceVersion,
    p_egress_attempt_id: attemptId,
    p_error_code: code,
    p_retryable: retryable,
    p_ambiguous: ambiguous,
  });
  if (!response.ok || typeof response.data !== "object" || response.data === null) {
    return { outcome: "unavailable", reason: `failure_state_unconfirmed_${code}` };
  }
  const status = (response.data as { status?: unknown }).status;
  if (status === "result_ready" || status === "completed") {
    return { outcome: "unavailable", reason: "durable_result_requires_reconciliation" };
  }
  if (retryable && !ambiguous && status === "retry_scheduled") {
    return { outcome: "retry_scheduled", reason: code };
  }
  if (ambiguous && status === "ambiguous") {
    return { outcome: "ambiguous_dead_lettered", reason: code };
  }
  if (!ambiguous && status === "dead") {
    return { outcome: "dead_lettered", reason: code };
  }
  return { outcome: "unavailable", reason: `failure_state_unconfirmed_${code}` };
}

function confirmParams(
  job: z.infer<typeof LocatorSchema>,
  begin: z.infer<typeof BegunSchema>,
) {
  return {
    p_egress_attempt_id: begin.egressAttemptId,
    ...beginParams(job),
    p_credential_id: begin.credentialId,
    p_credential_version: begin.credentialVersion,
    p_query_policy_version: begin.queryPolicyVersion,
    p_canonical_query_sha256: begin.canonicalQuerySha256,
    p_request_sha256: begin.requestSha256,
  };
}

async function settleConfirmedReplay(
  client: AutonomousWebRpcClient,
  job: z.infer<typeof LocatorSchema>,
  attemptId: string,
): Promise<AutonomousWebSourcingOutcome> {
  const recovered = await reconcile(client, job, attemptId);
  if (recovered?.status === "completed") return { outcome: "no_op_replay" };
  if (
    recovered?.status === "result_ready"
    && typeof recovered.resultSha256 === "string"
    && typeof recovered.candidateCount === "number"
  ) {
    return commitRecordedResult(
      client,
      job,
      attemptId,
      recovered.resultSha256,
      recovered.candidateCount,
    );
  }
  if (recovered?.status === "no_durable_response") {
    return { outcome: "ambiguous_dead_lettered", reason: "no_durable_response" };
  }
  return { outcome: "unavailable", reason: "egress_state_unconfirmed" };
}

async function commitRecordedResult(
  client: AutonomousWebRpcClient,
  job: z.infer<typeof LocatorSchema>,
  attemptId: string,
  resultSha256: string,
  candidateCount: number,
): Promise<AutonomousWebSourcingOutcome> {
  const commitParams = {
    ...beginParams(job),
    p_egress_attempt_id: attemptId,
    p_result_sha256: resultSha256,
  };
  const acceptCommit = (data: unknown): AutonomousWebSourcingOutcome | null => {
    const completed = CompletedSchema.safeParse(data);
    if (
      !completed.success
      || completed.data.resultSha256 !== resultSha256
      || completed.data.candidateCount !== candidateCount
    ) {
      return null;
    }
    return completed.data.status === "completed"
      ? { outcome: "completed", candidateCount, queryCount: 1 }
      : { outcome: "no_op_replay" };
  };
  const firstCommit = await callRpc(client, "commit_autonomous_web_sourcing", commitParams);
  const firstOutcome = firstCommit.ok ? acceptCommit(firstCommit.data) : null;
  if (firstOutcome) return firstOutcome;
  if (firstCommit.ok && ResultBindingInvalidSchema.safeParse(firstCommit.data).success) {
    return failAttempt(
      client,
      job,
      attemptId,
      "result_binding_invalid",
      false,
      false,
    );
  }

  const recovered = await reconcile(client, job, attemptId, resultSha256);
  if (
    recovered?.status === "completed"
    && recovered.resultSha256 === resultSha256
    && recovered.candidateCount === candidateCount
  ) {
    return { outcome: "no_op_replay" };
  }
  if (
    recovered?.status === "result_ready"
    && recovered.resultSha256 === resultSha256
    && recovered.candidateCount === candidateCount
  ) {
    const retry = await callRpc(client, "commit_autonomous_web_sourcing", commitParams);
    const retryOutcome = retry.ok ? acceptCommit(retry.data) : null;
    if (retryOutcome) return retryOutcome;
    const retryRecovered = await reconcile(client, job, attemptId, resultSha256);
    if (
      retryRecovered?.status === "completed"
      && retryRecovered.resultSha256 === resultSha256
      && retryRecovered.candidateCount === candidateCount
    ) {
      return { outcome: "no_op_replay" };
    }
  }
  return { outcome: "unavailable", reason: "commit_state_unconfirmed" };
}

/**
 * Consume one 0060 locator. Every authority-bearing value comes from the
 * database; the caller supplies only the locator minted by authorize. No
 * provider response is reported successful until record and atomic commit are
 * both durably confirmed.
 */
export async function handleAutonomousWebSourcingJob(
  input: unknown,
  client: AutonomousWebRpcClient,
  deps: AutonomousWebRuntimeDependencies,
): Promise<AutonomousWebSourcingOutcome> {
  const locator = LocatorSchema.safeParse(input);
  if (!locator.success) return { outcome: "stale_lease" };
  const job = locator.data;
  let begin = await callRpc(
    client,
    "begin_autonomous_web_sourcing_egress",
    beginParams(job),
  );
  // A failed first response may have followed a committed begin. Retrying this
  // same locator is safe because 0060 reissues authority only while the exact
  // attempt remains unconfirmed; a confirmed attempt is reconciliation-only.
  if (!begin.ok) {
    begin = await callRpc(
      client,
      "begin_autonomous_web_sourcing_egress",
      beginParams(job),
    );
  }
  if (!begin.ok) return { outcome: "unavailable", reason: "begin_unavailable" };
  if (BeginNoOpReplaySchema.safeParse(begin.data).success) {
    return { outcome: "no_op_replay" };
  }
  const priorAttempt = AlreadyBegunSchema.safeParse(begin.data);
  if (priorAttempt.success) {
    return settleConfirmedReplay(client, job, priorAttempt.data.egressAttemptId);
  }
  const begun = BegunSchema.safeParse(begin.data);
  if (!begun.success) {
    const status = (begin.data as { status?: unknown } | null)?.status;
    if (
      status === "job_lease_invalid"
      || status === "claim_invalid"
      || status === "invalid_request"
    ) {
      return { outcome: "stale_lease" };
    }
    return { outcome: "unavailable", reason: "begin_denied" };
  }
  const authority = begun.data;
  let credential: WorkspaceTavilyCredential | null;
  try {
    credential = await deps.resolveCredential(
      client,
      job.workspaceId,
      authority.credentialId,
      authority.credentialVersion,
    );
  } catch {
    credential = null;
  }
  if (!credential) {
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "credential_resolution_failed",
      false,
      false,
    );
  }

  const confirmation = await callRpc(
    client,
    "confirm_autonomous_web_sourcing_egress",
    confirmParams(job, authority),
  );
  if (!confirmation.ok) {
    return settleConfirmedReplay(client, job, authority.egressAttemptId);
  }
  const alreadyConfirmed = AlreadyConfirmedSchema.safeParse(confirmation.data);
  if (alreadyConfirmed.success) {
    return settleConfirmedReplay(client, job, authority.egressAttemptId);
  }
  const confirmed = ConfirmedSchema.safeParse(confirmation.data);
  if (!confirmed.success || confirmed.data.egressAttemptId !== authority.egressAttemptId) {
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "egress_confirmation_denied",
      false,
      false,
    );
  }
  const now = deps.now ?? Date.now;
  const mustStartBy = Date.parse(confirmed.data.mustStartBy);
  if (!Number.isFinite(mustStartBy) || now() >= mustStartBy) {
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "confirmation_window_expired",
      false,
      false,
    );
  }

  let search: SuccessfulAutonomousWebSearch | FailedAutonomousWebSearch;
  try {
    search = await deps.executeSearch({
      authority: {
        provider: authority.provider,
        queryPolicyVersion: authority.queryPolicyVersion,
        canonicalQuerySha256: authority.canonicalQuerySha256,
        requestSha256: authority.requestSha256,
        request: authority.request,
      },
      credential,
      timeoutMs: 15_000,
      fetcher: deps.fetcher ?? fetch,
    });
  } catch {
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "search_configuration_invalid",
      false,
      false,
    );
  }
  if (!search.ok) {
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      search.code,
      search.retryable,
      search.ambiguous,
    );
  }

  const record = await callRpc(client, "record_autonomous_web_sourcing_result", {
    p_egress_attempt_id: authority.egressAttemptId,
    p_job_id: job.jobId,
    p_lease_id: job.leaseId,
    p_workspace_id: job.workspaceId,
    p_claim_token: job.claimToken,
    p_fence_version: job.fenceVersion,
    p_provider: authority.provider,
    p_credential_id: authority.credentialId,
    p_credential_version: authority.credentialVersion,
    p_query_policy_version: authority.queryPolicyVersion,
    p_canonical_query_sha256: authority.canonicalQuerySha256,
    p_request_sha256: authority.requestSha256,
    p_raw_response_sha256: search.rawResponseSha256,
    p_raw_response_bytes: search.rawResponseBytes,
    p_provider_receipt: search.providerReceipt,
    p_normalized_results: search.normalizedResults,
  });
  if (!record.ok) {
    const recovered = await reconcile(client, job, authority.egressAttemptId);
    if (
      recovered?.status === "result_ready"
      && typeof recovered.resultSha256 === "string"
      && recovered.candidateCount === search.normalizedResults.length
    ) {
      return commitRecordedResult(
        client,
        job,
        authority.egressAttemptId,
        recovered.resultSha256,
        search.normalizedResults.length,
      );
    }
    if (
      recovered?.status === "completed"
      && recovered.candidateCount === search.normalizedResults.length
    ) {
      return { outcome: "no_op_replay" };
    }
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "record_state_unconfirmed",
      false,
      true,
    );
  }
  const recorded = RecordedSchema.safeParse(record.data);
  if (
    !recorded.success
    || recorded.data.candidateCount !== search.normalizedResults.length
  ) {
    const recovered = await reconcile(client, job, authority.egressAttemptId);
    if (
      recovered?.status === "result_ready"
      && typeof recovered.resultSha256 === "string"
      && recovered.candidateCount === search.normalizedResults.length
    ) {
      return commitRecordedResult(
        client,
        job,
        authority.egressAttemptId,
        recovered.resultSha256,
        recovered.candidateCount,
      );
    }
    if (
      recovered?.status === "completed"
      && recovered.candidateCount === search.normalizedResults.length
    ) {
      return { outcome: "no_op_replay" };
    }
    return failAttempt(
      client,
      job,
      authority.egressAttemptId,
      "record_response_invalid",
      false,
      true,
    );
  }
  return commitRecordedResult(
    client,
    job,
    authority.egressAttemptId,
    recorded.data.resultSha256,
    recorded.data.candidateCount,
  );
}
