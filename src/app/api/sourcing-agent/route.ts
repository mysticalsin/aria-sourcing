import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import {
  detectInjection,
  validateCandidateBoundText,
} from "@/lib/agent-disclosure-policy";
import type { AiProviderSlug } from "@/lib/ai/provider";
import { resolveActiveAiRuntimeBinding, type ActiveAiRuntimeBinding } from "@/lib/ai/runtime-binding";
import { makeSourcingToolRunner, type SourcingQueryExecution } from "@/lib/ai/sourcing-tools";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { dedupeCandidates } from "@/lib/rules";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import {
  beginSourcingRun,
  beginAgentFrameworkSourcingRun,
  completeSourcingRun,
  completeAgentFrameworkSourcingEffect,
  checkAgentFrameworkSourcingExecution,
  failSourcingRun,
  failAgentFrameworkSourcingEffect,
  listPromotedSourcingLessons,
  resumeSourcingRunResult,
  type SourcingLearningLesson,
  type SourcingRoleBasis,
} from "@/lib/sourcing/learning-authority";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";
import { appliedPromotedLessonIds } from "@/lib/sourcing/framework-learning-selection";
import { sourcingRoleBasisForCampaign } from "@/lib/sourcing/role-basis";
import {
  SourcingAgentRequestSchema,
  parseSourcingAgentCandidates,
  parseSourcingAgentSuccessResponse,
  projectSourcingAgentWorkspace,
  sourcingAgentCampaignFingerprint,
  type SourcingAgentCampaign,
} from "@/lib/sourcing/sourcing-agent-contract";
import {
  isStoredTavilyCredentialAuthorized,
  resolveStoredTavilyCredential,
} from "@/lib/sourcing/tavily";
import {
  executeBoundSourcingPipeline,
  type BoundSourcingDraft,
} from "@/lib/sourcing/bound-sourcing-execution";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Candidate, Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ErrorCode =
  | "INVALID_REQUEST"
  | "CROSS_ORIGIN_REQUEST"
  | "NOT_AUTHENTICATED"
  | "INSUFFICIENT_PERMISSIONS"
  | "WORKSPACE_NOT_FOUND"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_NOT_ACTIVE"
  | "CAMPAIGN_NOT_READY"
  | "CAMPAIGN_INPUT_UNSAFE"
  | "CAMPAIGN_CHANGED"
  | "SOURCING_AGENT_RATE_LIMITED"
  | "SOURCING_AGENT_REPLAY_BLOCKED"
  | "SOURCING_AGENT_NOT_CONFIGURED"
  | "SOURCING_AGENT_UPSTREAM_FAILED"
  | "SOURCING_AGENT_RESPONSE_INVALID"
  | "SOURCING_AGENT_UNAVAILABLE";

type Session = NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>;

function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(
  status: number,
  code: ErrorCode,
  error: string,
  correlationId: string,
  retryAfter?: number,
): NextResponse {
  const response = noStoreJson(
    { ok: false, code, error, requestId: correlationId },
    status,
  );
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

async function readWorkspace(
  session: Session,
  workspaceId: string,
  campaignId: string,
) {
  const { data, error } = await session
    .from("workspace_state")
    .select("state")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { status: "unavailable" as const };
  return projectSourcingAgentWorkspace(data?.state, campaignId);
}

function campaignAllowsSourcing(campaign: SourcingAgentCampaign): boolean {
  return campaign.status === "Sourcing" || campaign.status === "Outreach";
}

function campaignInputUnsafe(campaign: SourcingAgentCampaign): boolean {
  const job = campaign.jobAnalysis;
  const values = [
    job.title,
    job.department,
    job.education,
    job.reportingTo,
    job.teamSize,
    ...job.requiredSkills,
    ...job.niceToHaveSkills,
    ...job.industryExperience,
    ...job.regions,
    ...campaign.sourcingStrategy.githubQueries.map((query) => query.query),
  ];
  return values.some((value) => detectInjection(value).flagged);
}

function lessonExecutionKey(platform: string, query: string): string {
  return `${platform}\u0000${query.trim()}`;
}

async function handlePost(req: NextRequest, correlationId: string) {
  const fail = (
    status: number,
    code: ErrorCode,
    error: string,
    retryAfter?: number,
  ) => errorResponse(status, code, error, correlationId, retryAfter);

  if (prodFailClosed() || !supabaseEnabled) {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin sourcing is not allowed.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return fail(401, "NOT_AUTHENTICATED", "Authentication is required.");

  const [{ data: role }, { data: workspaceId }] = await Promise.all([
    session.rpc("current_profile_role"),
    session.rpc("current_workspace_id"),
  ]);
  if (!can(role as Role, "source")) {
    return fail(403, "INSUFFICIENT_PERMISSIONS", "Live sourcing authority is required.");
  }
  if (typeof workspaceId !== "string" || !workspaceId) {
    return fail(400, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }

  const limit = checkRateLimit(rateLimitKey(req, "sourcing-agent", user.id), {
    windowMs: 60_000,
    max: 10,
  });
  if (!limit.ok) {
    return fail(
      429,
      "SOURCING_AGENT_RATE_LIMITED",
      "Sourcing-agent rate limit reached.",
      limit.retryAfterSec,
    );
  }

  const validated = await validateBody(req, SourcingAgentRequestSchema, {
    maxBytes: 2_000,
  });
  if (!validated.ok) {
    return fail(validated.response.status, "INVALID_REQUEST", "Invalid sourcing-agent request.");
  }
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!UUID_RE.test(idempotencyKey)) {
    return fail(400, "INVALID_REQUEST", "A valid idempotency key is required.");
  }
  const { campaignId } = validated.data;
  const count = validated.data.count ?? 5;
  const initial = await readWorkspace(session, workspaceId, campaignId);
  if (initial.status === "campaign_not_found") {
    return fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
  }
  if (initial.status !== "ok") {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Campaign authority is unavailable.");
  }
  if (!campaignAllowsSourcing(initial.value.campaign)) {
    return fail(409, "CAMPAIGN_NOT_ACTIVE", "Campaign is not active for sourcing.");
  }
  if (!evaluateNeedReadiness(initial.value.campaign.jobAnalysis).ready) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign brief requires review before sourcing.");
  }
  if (campaignInputUnsafe(initial.value.campaign)) {
    return fail(409, "CAMPAIGN_INPUT_UNSAFE", "Campaign brief requires safety review before sourcing.");
  }
  const configuredQueries = initial.value.campaign.sourcingStrategy.githubQueries
    .map((query) => query.query.trim())
    .filter(Boolean);
  const frameworkAuthorization = validated.data.agentFrameworkRunId &&
    validated.data.agentFrameworkCapabilityToken &&
    validated.data.agentFrameworkQuery
    ? {
        runId: validated.data.agentFrameworkRunId,
        capabilityToken: validated.data.agentFrameworkCapabilityToken,
        query: validated.data.agentFrameworkQuery,
      }
    : null;
  if (frameworkAuthorization && !configuredQueries.includes(frameworkAuthorization.query)) {
    return fail(409, "CAMPAIGN_CHANGED", "The framework query is no longer approved for this campaign.");
  }
  const roleBasis: SourcingRoleBasis = sourcingRoleBasisForCampaign(initial.value.campaign);
  if (roleBasis.skills.length === 0) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign brief requires a reviewed role skill.");
  }
  const campaignFingerprint = createHash("sha256")
    .update(initial.value.fingerprint, "utf8")
    .digest("hex");

  // Recover a completed ordinary result before resolving a model binding,
  // decrypting credentials, or performing any provider egress. A lost HTTP
  // response or browser persistence conflict therefore reuses the exact
  // staged result even if runtime provider configuration changed afterward.
  if (!frameworkAuthorization) {
    const pending = await resumeSourcingRunResult({
      workspaceId,
      actorId: user.id,
      campaignId,
      campaignFingerprint,
      count,
    });
    if (pending.status === "result_ready") {
      const recovered = parseSourcingAgentSuccessResponse({
        ...(pending.resultPayload as Record<string, unknown>),
        sourcingResultSha256: pending.resultSha256,
      }, campaignId, pending.requestedCount);
      return recovered && recovered.sourcingRunId === pending.runId
        ? noStoreJson(recovered)
        : fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
    }
    if (
      pending.status === "in_progress" ||
      pending.status === "pending_conflict" ||
      pending.status === "already_consumed" ||
      pending.status === "result_expired"
    ) {
      return fail(409, "SOURCING_AGENT_REPLAY_BLOCKED", "A sourcing result is already pending for this campaign.");
    }
    if (pending.status === "not_found") {
      return fail(403, "INSUFFICIENT_PERMISSIONS", "Live sourcing authority is unavailable.");
    }
    if (pending.status !== "no_pending") {
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing-result recovery is unavailable.");
    }
  }
  // Mutable workspace_state AI provider settings are never execution authority:
  // only the database-approved runtime binding may select a cloud provider,
  // model, or key. The framework path is always deterministic already and
  // never needs a binding.
  let binding: ActiveAiRuntimeBinding | null = null;
  let tavilyCredentialId: string | null = null;
  if (!frameworkAuthorization) {
    const service = getServiceSupabase();
    if (!service) {
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing-agent runtime authority is unavailable.");
    }
    const bindingResult = await resolveActiveAiRuntimeBinding(service, workspaceId, "sourcing");
    if (bindingResult.ok) {
      binding = bindingResult.binding;
    } else if (bindingResult.code !== "not_configured") {
      // credential_unavailable, authority_invalid, backend_error: fail closed
      // before any provider egress rather than falling back to a stale or
      // fabricated cloud configuration.
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing-agent runtime authority is unavailable.");
    }
  }
  const deterministic = Boolean(frameworkAuthorization) || !binding;
  if (deterministic && configuredQueries.length === 0) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign has no reviewed real-sourcing query.");
  }
  let cloudSlug: AiProviderSlug | null = null;
  let toolModel: string | null = null;
  if (binding) {
    cloudSlug = binding.provider;
    toolModel = binding.model;
  }
  // Binds this sourcing run's configuration fingerprint to the exact binding
  // set/config in effect, so a later replay or comparison can detect a
  // provider/model/key change even though the workspace-state fingerprint
  // above never reflects the binding.
  const configurationFingerprintHash = createHash("sha256")
    .update(initial.value.configurationFingerprint, "utf8")
    .update("\0", "utf8");
  if (binding) {
    configurationFingerprintHash
      .update(binding.setSha256, "utf8")
      .update("\0", "utf8")
      .update(binding.configSha256, "utf8");
  }
  const configurationFingerprint = configurationFingerprintHash.digest("hex");
  const beginInput: {
    workspaceId: string;
    actorId: string;
    campaignId: string;
    roleBasis: typeof roleBasis;
    configurationFingerprint: string;
    mode: "deterministic" | "cloud";
    provider: AiProviderSlug | null;
    model: string | null;
    idempotencyKey: string;
    requestId: string;
    count: number;
    campaignFingerprint: string;
  } = {
    workspaceId,
    actorId: user.id,
    campaignId,
    roleBasis,
    configurationFingerprint,
    mode: deterministic ? "deterministic" : "cloud",
    provider: cloudSlug,
    model: toolModel,
    idempotencyKey,
    requestId: correlationId,
    count,
    campaignFingerprint,
  };
  const begun = frameworkAuthorization
    ? await beginAgentFrameworkSourcingRun({
        ...beginInput,
        sourceQuery: frameworkAuthorization.query,
        frameworkRunId: frameworkAuthorization.runId,
        capabilityToken: frameworkAuthorization.capabilityToken,
      })
    : await beginSourcingRun(beginInput);
  if (begun.status === "quota_exceeded") {
    return fail(429, "SOURCING_AGENT_RATE_LIMITED", "Daily live-sourcing limit reached.");
  }
  if (begun.status === "result_ready") {
    const recoveredCount = frameworkAuthorization
      ? count
      : "requestedCount" in begun && typeof begun.requestedCount === "number"
        ? begun.requestedCount
        : 0;
    if (recoveredCount < 1 || recoveredCount > 8) {
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
    }
    const recovered = parseSourcingAgentSuccessResponse({
      ...(begun.resultPayload as Record<string, unknown>),
      ...(frameworkAuthorization
        ? { agentFrameworkResultSha256: begun.resultSha256 }
        : { sourcingResultSha256: begun.resultSha256 }),
    }, campaignId, recoveredCount, frameworkAuthorization?.runId);
    return recovered && recovered.sourcingRunId === begun.runId
      ? noStoreJson(recovered)
      : fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
  }
  if (
    begun.status === "in_progress" ||
    begun.status === "idempotency_conflict" ||
    begun.status === "pending_conflict" ||
    begun.status === "already_consumed" ||
    begun.status === "result_expired" ||
    begun.status === "authorization_expired"
    || begun.status === "framework_disabled"
  ) {
    return fail(409, "SOURCING_AGENT_REPLAY_BLOCKED", "This sourcing request was already claimed.");
  }
  if (begun.status === "not_found") {
    return fail(403, "INSUFFICIENT_PERMISSIONS", "Live sourcing authority is unavailable.");
  }
  if (begun.status !== "claimed") {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing-run authority is unavailable.");
  }

  const recordClaimFailure = async (code: ErrorCode | "RUN_COMPLETION_FAILED" | "UNHANDLED_EXECUTION_FAILURE") => {
    if (frameworkAuthorization) {
      return failAgentFrameworkSourcingEffect({
        workspaceId,
        actorId: user.id,
        frameworkRunId: frameworkAuthorization.runId,
        sourcingRunId: begun.runId,
        errorCode: code,
      });
    }
    return failSourcingRun({
      workspaceId,
      actorId: user.id,
      runId: begun.runId,
      errorCode: code,
    });
  };

  const failClaimed = async (
    status: number,
    code: ErrorCode,
    message: string,
  ) => {
    await recordClaimFailure(code);
    return fail(status, code, message);
  };

  const currentAuthority = async (): Promise<
    | { ok: true; workspace: Awaited<ReturnType<typeof readWorkspace>> & { status: "ok" } }
    | { ok: false; status: number; code: ErrorCode; message: string }
  > => {
    const [{ data: latestRole }, { data: latestWorkspaceId }] = await Promise.all([
      session.rpc("current_profile_role"),
      session.rpc("current_workspace_id"),
    ]);
    if (!can(latestRole as Role, "source")) {
      return {
        ok: false,
        status: 403,
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Sourcing authority changed during the operation.",
      };
    }
    if (latestWorkspaceId !== workspaceId) {
      return {
        ok: false,
        status: 409,
        code: "CAMPAIGN_CHANGED",
        message: "Workspace authority changed during the operation.",
      };
    }
    const latest = await readWorkspace(session, workspaceId, campaignId);
    if (
      latest.status !== "ok" ||
      !campaignAllowsSourcing(latest.value.campaign) ||
      latest.value.fingerprint !== initial.value.fingerprint ||
      latest.value.configurationFingerprint !== initial.value.configurationFingerprint
    ) {
      return {
        ok: false,
        status: 409,
        code: "CAMPAIGN_CHANGED",
        message: "Campaign authority changed during the operation.",
      };
    }
    if (frameworkAuthorization && !await checkAgentFrameworkSourcingExecution({
      workspaceId,
      actorId: user.id,
      frameworkRunId: frameworkAuthorization.runId,
      sourcingRunId: begun.runId,
    })) {
      return {
        ok: false,
        status: 409,
        code: "CAMPAIGN_CHANGED",
        message: "Agent framework execution authority changed during the operation.",
      };
    }
    // Re-resolves the runtime binding itself (not just the workspace-state
    // fingerprint, which never reflects it) so a mid-run activation or
    // revocation of the binding stops egress before the next secret
    // resolution or external call.
    if (binding) {
      const service = getServiceSupabase();
      const recheck = service
        ? await resolveActiveAiRuntimeBinding(service, workspaceId, "sourcing")
        : ({ ok: false, code: "backend_error" } as const);
      if (
        !recheck.ok ||
        recheck.binding.bindingId !== binding.bindingId ||
        recheck.binding.setSha256 !== binding.setSha256 ||
        recheck.binding.configSha256 !== binding.configSha256
      ) {
        return {
          ok: false,
          status: 409,
          code: "CAMPAIGN_CHANGED",
          message: "Sourcing-agent runtime authority changed during the operation.",
        };
      }
    }
    if (tavilyCredentialId) {
      const service = getServiceSupabase();
      if (
        !service ||
        !await isStoredTavilyCredentialAuthorized(
          service,
          workspaceId,
          tavilyCredentialId,
        )
      ) {
        return {
          ok: false,
          status: 409,
          code: "CAMPAIGN_CHANGED",
          message: "Sourcing search credential authority changed during the operation.",
        };
      }
    }
    return { ok: true, workspace: latest };
  };

  const failIfAuthorityChanged = async () => {
    const authority = await currentAuthority();
    if (authority.ok) return null;
    return failClaimed(authority.status, authority.code, authority.message);
  };

  try {
    const beforeSecrets = await failIfAuthorityChanged();
    if (beforeSecrets) return await beforeSecrets;
    let vaultKey: string | null = null;
    if (binding && cloudSlug) {
      vaultKey = await resolveVaultSecret(binding.apiKeyId, binding.credentialProvider, workspaceId);
      if (!vaultKey) {
        return await failClaimed(
          503,
          "SOURCING_AGENT_UNAVAILABLE",
          "Sourcing-agent runtime authority is unavailable.",
        );
      }
    }
    const tavilyCredential = deterministic
      ? null
      : await resolveStoredTavilyCredential(session);
    tavilyCredentialId = tavilyCredential?.apiKeyId ?? null;
    const tavilyKey = tavilyCredential?.key ?? null;
    const beforeExecution = await failIfAuthorityChanged();
    if (beforeExecution) return await beforeExecution;

    let promotedLessons: SourcingLearningLesson[] = [];
    if (begun.lessonsEnabled) {
      const listed = await listPromotedSourcingLessons({
        workspaceId,
        actorId: user.id,
        roleBasis,
        limit: 10,
      });
      if (listed.status === "ready") {
        if (listed.roleFingerprint !== begun.roleFingerprint) {
          return await failClaimed(
            503,
            "SOURCING_AGENT_UNAVAILABLE",
            "Sourcing-learning authority is unavailable.",
          );
        }
        promotedLessons = listed.lessons.filter((lesson) => {
          const valid = validateSourcingQuery(
            lesson.platform,
            lesson.query,
            initial.value.campaign,
          ).ok;
          return valid && (!frameworkAuthorization || (
            lesson.platform === "GitHub" &&
            lesson.query === frameworkAuthorization.query &&
            configuredQueries.includes(lesson.query)
          ));
        });
      } else if (listed.status !== "learning_disabled") {
        return await failClaimed(
          listed.status === "not_found" ? 403 : 503,
          listed.status === "not_found"
            ? "INSUFFICIENT_PERMISSIONS"
            : "SOURCING_AGENT_UNAVAILABLE",
          "Sourcing-learning authority is unavailable.",
        );
      }
    }

    const githubToken = process.env.GITHUB_TOKEN ?? "";
    let foundByExecution: Candidate[] = [];
    let executions: SourcingQueryExecution[] = [];
    let drafts: BoundSourcingDraft[] = [];
    if (deterministic) {
      const runner = makeSourcingToolRunner(
        initial.value.campaign,
        initial.value.existing,
        initial.value.campaign.scoringWeights,
        githubToken,
        tavilyKey,
        undefined,
        async () => (await currentAuthority()).ok,
      );
      const searchSignal = AbortSignal.timeout(45_000);
      const queries = frameworkAuthorization
        ? [frameworkAuthorization.query]
        : [
            ...promotedLessons
              .filter((lesson) => lesson.platform === "GitHub")
              .map((lesson) => lesson.query),
            ...configuredQueries,
          ]
            .filter((query, index, all) => all.indexOf(query) === index)
            .slice(0, 3);
      let successfulQuery = false;
      for (const query of queries) {
        const remaining = count - runner.getFound().length;
        if (remaining <= 0) break;
        const result = await runner.run(
          "search_candidates",
          { platform: "GitHub", query, count: remaining },
          searchSignal,
        );
        successfulQuery = successfulQuery || result.ok;
        const afterQuery = await readWorkspace(session, workspaceId, campaignId);
        if (
          afterQuery.status !== "ok" ||
          !campaignAllowsSourcing(afterQuery.value.campaign) ||
          afterQuery.value.fingerprint !== initial.value.fingerprint ||
          afterQuery.value.configurationFingerprint !== initial.value.configurationFingerprint
        ) {
          return await failClaimed(
            409,
            "CAMPAIGN_CHANGED",
            "Campaign authority changed during the operation.",
          );
        }
      }
      if (!successfulQuery) {
        return await failClaimed(
          502,
          "SOURCING_AGENT_UPSTREAM_FAILED",
          "Real candidate search did not complete.",
        );
      }
      foundByExecution = runner.getFound();
      executions = runner.getExecutions();
    } else {
      const result = await executeBoundSourcingPipeline({
        workspaceId,
        campaign: initial.value.campaign,
        existing: initial.value.existing,
        count,
        binding,
        apiKey: vaultKey ?? "",
        githubToken,
        tavilyKey,
        promotedLessons,
        beforeExternalCall: async () => (await currentAuthority()).ok,
      });
      if (!result.ok && result.code === "authority_changed") {
        const authorityFailure = await failIfAuthorityChanged();
        if (authorityFailure) return await authorityFailure;
      }
      if (!result.ok && result.code === "not_configured") {
        return await failClaimed(
          503,
          "SOURCING_AGENT_NOT_CONFIGURED",
          "The selected provider is unavailable.",
        );
      }
      if (!result.ok && result.code === "response_invalid") {
        return await failClaimed(
          502,
          "SOURCING_AGENT_RESPONSE_INVALID",
          "The sourcing-agent response was invalid.",
        );
      }
      if (!result.ok) {
        return await failClaimed(
          502,
          "SOURCING_AGENT_UPSTREAM_FAILED",
          "The sourcing agent did not complete.",
        );
      }
      foundByExecution = result.found;
      executions = result.executions;
      drafts = result.drafts;
    }

    if (executions.length === 0 || !executions.some((execution) => execution.ok)) {
      return await failClaimed(
        502,
        "SOURCING_AGENT_UPSTREAM_FAILED",
        "The sourcing agent completed without a real search.",
      );
    }
    const finalAuthority = await currentAuthority();
    if (!finalAuthority.ok) {
      return await failClaimed(
        finalAuthority.status,
        finalAuthority.code,
        finalAuthority.message,
      );
    }
    const latest = finalAuthority.workspace;

    const found = dedupeCandidates(foundByExecution, latest.value.existing, {
      excludedCompanies: latest.value.campaign.sourcingStrategy.excludedCompanies,
    }).accepted;
    const byId = new Map(found.map((candidate) => [candidate.id, candidate]));
    const selected = deterministic
      ? found.slice(0, count).map((candidate) => ({ candidate, draft: null }))
      : (drafts ?? []).map((draft) => ({
          candidate: byId.get(draft.candidateId) ?? null,
          draft,
        }));
    const candidates = selected
      .map(({ candidate, draft }) => {
        if (!candidate) return null;
        const forbidden = [
          latest.value.campaign.jobAnalysis.department,
          latest.value.campaign.jobAnalysis.teamSize,
          latest.value.campaign.jobAnalysis.reportingTo,
          latest.value.campaign.jobAnalysis.currency,
        ];
        if (draft) {
          const subjectDisclosure = validateCandidateBoundText(draft.subject, {
            salaryMin: latest.value.campaign.jobAnalysis.salaryMin,
            salaryMax: latest.value.campaign.jobAnalysis.salaryMax,
            forbidden,
          });
          const bodyDisclosure = validateCandidateBoundText(draft.body, {
            salaryMin: latest.value.campaign.jobAnalysis.salaryMin,
            salaryMax: latest.value.campaign.jobAnalysis.salaryMax,
            forbidden,
          });
          if (!subjectDisclosure.safe || !bodyDisclosure.safe) return null;
        }
        return {
          id: candidate.id,
          campaignId,
          name: candidate.name,
          currentTitle: candidate.currentTitle,
          currentCompany: candidate.currentCompany,
          location: candidate.location,
          linkedinUrl: candidate.linkedinUrl,
          githubUrl: candidate.githubUrl,
          ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
          sourcePlatform: candidate.sourcePlatform,
          sourceQuery: candidate.sourceQuery,
          matchScore: candidate.matchScore,
          matchBreakdown: candidate.matchBreakdown,
          techStack: candidate.techStack,
          recentActivity: candidate.recentActivity,
          createdAt: candidate.createdAt,
          ...(draft ? { draftSubject: draft.subject, draftBody: draft.body } : {}),
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .slice(0, count);
    const projected = parseSourcingAgentCandidates(candidates, campaignId, count);
    if (!projected) {
      return await failClaimed(
        502,
        "SOURCING_AGENT_RESPONSE_INVALID",
        "The sourcing-agent result was invalid.",
      );
    }

    const executed = new Set(
      executions.map((execution) => lessonExecutionKey(execution.platform, execution.query)),
    );
    const appliedLessonIds = frameworkAuthorization
      ? appliedPromotedLessonIds(
          frameworkAuthorization.query,
          configuredQueries,
          promotedLessons,
        )
      : promotedLessons
          .filter((lesson) => executed.has(lessonExecutionKey(lesson.platform, lesson.query)))
          .map((lesson) => lesson.lessonId);
    const resultPayload = {
      ok: true,
      mode: deterministic ? "deterministic" : "cloud",
      campaignId,
      campaignFingerprint: sourcingAgentCampaignFingerprint(latest.value.campaign),
      candidates: projected,
      totalFound: found.length,
      requestId: correlationId,
      idempotencyKey,
      sourcingRunId: begun.runId,
      ...(frameworkAuthorization ? { agentFrameworkRunId: frameworkAuthorization.runId } : {}),
      appliedLessonIds,
    };
    if (frameworkAuthorization) {
      const completion = await completeAgentFrameworkSourcingEffect({
        workspaceId,
        actorId: user.id,
        frameworkRunId: frameworkAuthorization.runId,
        sourcingRunId: begun.runId,
        queryReceipts: executions,
        resultPayload,
      });
      if (completion.status !== "result_ready" || completion.runId !== begun.runId) {
        await recordClaimFailure("RUN_COMPLETION_FAILED");
        return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing result staging could not be recorded.");
      }
      const staged = parseSourcingAgentSuccessResponse({
        ...(completion.resultPayload as Record<string, unknown>),
        agentFrameworkResultSha256: completion.resultSha256,
      }, campaignId, count, frameworkAuthorization.runId);
      return staged
        ? noStoreJson(staged)
        : fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
    }
    const completion = await completeSourcingRun({
      workspaceId,
      actorId: user.id,
      runId: begun.runId,
      queryReceipts: executions,
      resultPayload,
    });
    if (completion.status !== "result_ready" || completion.runId !== begun.runId) {
      await recordClaimFailure("RUN_COMPLETION_FAILED");
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing result staging could not be recorded.");
    }
    const staged = parseSourcingAgentSuccessResponse({
      ...(completion.resultPayload as Record<string, unknown>),
      sourcingResultSha256: completion.resultSha256,
    }, campaignId, count);
    return staged && staged.sourcingRunId === begun.runId
      ? noStoreJson(staged)
      : fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
  } catch {
    await recordClaimFailure("UNHANDLED_EXECUTION_FAILURE");
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing-agent authority is unavailable.",
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = requestId(req);
  try {
    return await handlePost(req, correlationId);
  } catch {
    return errorResponse(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing-agent authority is unavailable.",
      correlationId,
    );
  }
}
