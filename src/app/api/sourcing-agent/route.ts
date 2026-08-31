import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  DISCLOSURE_SYSTEM,
  candidateDisclosureContextForCampaignLike,
  detectInjection,
  validateCandidateBoundText,
} from "@/lib/agent-disclosure-policy";
import { DEFAULT_MODEL, VAULT_PROVIDER, resolveAiProvider, type AiProviderSlug } from "@/lib/ai/provider";
import { SOURCING_TOOL_DEFS, makeSourcingToolRunner } from "@/lib/ai/sourcing-tools";
import { runAnthropicWithTools, runOpenAiWithTools, type ResolvedMcpServer } from "@/lib/ai/tool-loop";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { validateBody } from "@/lib/api/validate";
import { requestSameOrigin } from "@/lib/api/same-origin-json";
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
import { resolveStoredTavilyKey } from "@/lib/sourcing/tavily";
import { resolveStoredApifyKey } from "@/lib/sourcing/apify";
import { runMultiProviderSourcing } from "@/lib/sourcing/orchestrator";
import {
  isLinkedInFirstPlatform,
  LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF,
  MISSING_PLUGIN_CODE,
  MISSING_PLUGIN_MESSAGE,
} from "@/lib/sourcing/missing-plugin";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Candidate, Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You are Aria's autonomous sourcing agent. You have a search_candidates tool that returns real, " +
  "already-scored people found through live search. Never invent a candidate, score, company, or URL. " +
  "Search only relevant platforms and stop when enough strong matches exist. Respond with only strict " +
  "JSON: {\"drafts\":[{\"candidateId\":\"<tool result id>\",\"subject\":\"<email subject>\",\"body\":\"<first-touch outreach under 120 words>\"}]}. " +
  "Every candidateId must come from a tool result. Drafts lead with specific verified work, give one " +
  "genuine reason for contact, use a low-pressure ask, and contain no fabricated facts. " +
  DISCLOSURE_SYSTEM;

const DraftSchema = z
  .object({
    candidateId: z.string().min(1).max(100),
    subject: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1).max(5_000),
  })
  .strict();

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
  | "MISSING_PLUGIN"
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
  extra?: { settingsHref?: string },
): NextResponse {
  const response = noStoreJson(
    {
      ok: false,
      code,
      error,
      requestId: correlationId,
      ...(extra?.settingsHref ? { settingsHref: extra.settingsHref } : {}),
    },
    status,
  );
  if (retryAfter !== undefined) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function buildPrompt(
  campaign: SourcingAgentCampaign,
  count: number,
  lessons: SourcingLearningLesson[],
): string {
  const promotedQueries = lessons.length
    ? [
        "Human-promoted search lessons for this exact role are optional suggestions:",
        ...lessons.map((lesson) => `- ${lesson.platform}: ${lesson.query}`),
        "Use a suggestion only when it remains relevant. The search tool policy is authoritative.",
      ]
    : [];
  return [
    candidateDisclosureContextForCampaignLike(campaign),
    "",
    `Find and draft outreach for ${count} real candidates for this role.`,
    ...promotedQueries,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDrafts(text: string, maxCount: number) {
  let json: unknown;
  try {
    json = JSON.parse(text.trim());
  } catch {
    return null;
  }
  const parsed = z
    .object({ drafts: z.array(DraftSchema).max(maxCount) })
    .strict()
    .safeParse(json);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  for (const draft of parsed.data.drafts) {
    if (ids.has(draft.candidateId)) return null;
    if (draft.body.split(/\s+/).filter(Boolean).length > 120) return null;
    if (/[\u0000-\u001f\u007f]/.test(draft.subject)) return null;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(draft.body)) return null;
    ids.add(draft.candidateId);
  }
  return parsed.data.drafts;
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
    extra?: { settingsHref?: string },
  ) => errorResponse(status, code, error, correlationId, retryAfter, extra);

  if (prodFailClosed() || !supabaseEnabled) {
    return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Live sourcing authority is unavailable.");
  }
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  if (!requestSameOrigin(req)) {
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
  const cloudConfig = resolveAiProvider(initial.value.aiSettings, "sourcing");
  const deterministic = Boolean(frameworkAuthorization) || !cloudConfig;
  const primaryPlatform = initial.value.campaign.sourcingStrategy.primaryPlatforms[0] ?? "GitHub";
  const linkedInFirst = isLinkedInFirstPlatform(primaryPlatform);

  // Fail closed before claiming a run: LinkedIn-first roles need the profile
  // search connector. GitHub Live alone cannot fill Calypso BA / consulting needs.
  if (linkedInFirst && !frameworkAuthorization) {
    const linkedInProfileTokenEarly = await resolveStoredApifyKey(session);
    if (!linkedInProfileTokenEarly?.trim()) {
      return fail(
        409,
        MISSING_PLUGIN_CODE,
        MISSING_PLUGIN_MESSAGE,
        undefined,
        { settingsHref: LINKEDIN_PROFILE_SEARCH_SETTINGS_HREF },
      );
    }
  }

  if (deterministic && !frameworkAuthorization && !linkedInFirst && configuredQueries.length === 0) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign has no reviewed real-sourcing query.");
  }
  const roleBasis: SourcingRoleBasis = sourcingRoleBasisForCampaign(initial.value.campaign);
  if (roleBasis.skills.length === 0) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign brief requires a reviewed role skill.");
  }

  let cloudSlug: AiProviderSlug | null = null;
  let toolModel: string | null = null;
  if (!frameworkAuthorization && cloudConfig) {
    cloudSlug = cloudConfig.provider as AiProviderSlug;
    toolModel = cloudConfig.model || DEFAULT_MODEL[cloudSlug];
    if (!cloudConfig.apiKeyId) {
      return fail(503, "SOURCING_AGENT_NOT_CONFIGURED", "The selected provider has no workspace key.");
    }
  }
  const configurationFingerprint = createHash("sha256")
    .update(initial.value.configurationFingerprint)
    .digest("hex");
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
  };
  const begun = frameworkAuthorization
    ? await beginAgentFrameworkSourcingRun({
        ...beginInput,
        count,
        campaignFingerprint: createHash("sha256")
          .update(initial.value.fingerprint, "utf8")
          .digest("hex"),
        sourceQuery: frameworkAuthorization.query,
        frameworkRunId: frameworkAuthorization.runId,
        capabilityToken: frameworkAuthorization.capabilityToken,
      })
    : await beginSourcingRun(beginInput);
  if (begun.status === "quota_exceeded") {
    return fail(429, "SOURCING_AGENT_RATE_LIMITED", "Daily live-sourcing limit reached.");
  }
  if (begun.status === "result_ready" && frameworkAuthorization) {
    const recovered = parseSourcingAgentSuccessResponse({
      ...(begun.resultPayload as Record<string, unknown>),
      agentFrameworkResultSha256: begun.resultSha256,
    }, campaignId, count, frameworkAuthorization.runId);
    return recovered && recovered.sourcingRunId === begun.runId
      ? noStoreJson(recovered)
      : fail(503, "SOURCING_AGENT_UNAVAILABLE", "The staged sourcing result is invalid.");
  }
  if (
    begun.status === "in_progress" ||
    begun.status === "completed" ||
    begun.status === "failed" ||
    begun.status === "idempotency_conflict" ||
    begun.status === "already_consumed" ||
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
    if (cloudConfig && cloudSlug) {
      vaultKey = await resolveVaultSecret(cloudConfig.apiKeyId, VAULT_PROVIDER[cloudSlug]);
      if (!vaultKey) {
        return await failClaimed(
          403,
          "SOURCING_AGENT_NOT_CONFIGURED",
          "The selected provider key is unavailable.",
        );
      }
    }
    const githubToken = process.env.GITHUB_TOKEN ?? "";
    // Prefer a stored vault key; fall back to the deployment env so LinkedIn-first
    // roles can still run a real site-scoped web search when no vault row exists.
    const storedTavily = await resolveStoredTavilyKey(session);
    const tavilyKey = storedTavily || process.env.TAVILY_API_KEY || null;
    const linkedInProfileToken = await resolveStoredApifyKey(session);
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

    const runner = makeSourcingToolRunner(
      initial.value.campaign,
      initial.value.existing,
      initial.value.campaign.scoringWeights,
      githubToken,
      {
        tavilyKey: tavilyKey ?? undefined,
        linkedInProfileToken,
        beforeExternalCall: async () => (await currentAuthority()).ok,
      },
    );
    const servers: ResolvedMcpServer[] = [
      {
        url: "builtin:sourcing-agent",
        token: "",
        tools: SOURCING_TOOL_DEFS,
        run: runner.run,
      },
    ];
    let drafts: ReturnType<typeof parseDrafts> = [];
    if (deterministic) {
      const searchSignal = AbortSignal.timeout(120_000);
      const forcedQueries = frameworkAuthorization
        ? [{ platform: "GitHub" as const, query: frameworkAuthorization.query }]
        : undefined;
      const multi = await runMultiProviderSourcing({
        campaign: initial.value.campaign,
        existing: initial.value.existing,
        weights: initial.value.campaign.scoringWeights,
        count,
        githubToken,
        tavilyKey: tavilyKey ?? undefined,
        linkedInProfileToken,
        signal: searchSignal,
        beforeExternalCall: async () => (await currentAuthority()).ok,
        forcedQueries,
      });
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
      if (!multi.executions.some((execution) => execution.ok)) {
        return await failClaimed(
          502,
          "SOURCING_AGENT_UPSTREAM_FAILED",
          "Real candidate search did not complete.",
        );
      }
      runner.seedFromOrchestrator(multi);
    } else {
      if (!cloudSlug || !toolModel || !vaultKey) {
        return await failClaimed(
          503,
          "SOURCING_AGENT_NOT_CONFIGURED",
          "The selected provider is unavailable.",
        );
      }
      const prompt = buildPrompt(initial.value.campaign, count, promotedLessons);
      const result =
        cloudSlug === "anthropic"
          ? await runAnthropicWithTools({
              model: toolModel,
              system: SYSTEM_PROMPT,
              prompt,
              key: vaultKey,
              servers,
              maxRounds: 6,
              beforeExternalCall: async () => (await currentAuthority()).ok,
            })
          : await runOpenAiWithTools({
              provider: cloudSlug,
              model: toolModel,
              system: SYSTEM_PROMPT,
              prompt,
              key: vaultKey,
              servers,
              maxRounds: 6,
              beforeExternalCall: async () => (await currentAuthority()).ok,
            });
      if (!result.ok) {
        const authorityFailure = await failIfAuthorityChanged();
        if (authorityFailure) return await authorityFailure;
        return await failClaimed(
          502,
          "SOURCING_AGENT_UPSTREAM_FAILED",
          "The sourcing agent did not complete.",
        );
      }
      drafts = parseDrafts(result.text ?? "", count);
      if (!drafts) {
        return await failClaimed(
          502,
          "SOURCING_AGENT_RESPONSE_INVALID",
          "The sourcing-agent response was invalid.",
        );
      }
    }

    const executions = runner.getExecutions();
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

    const found = dedupeCandidates(runner.getFound(), latest.value.existing, {
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
    // Prefer all-or-nothing parse; soft-filter to schema-valid DTOs so a single
    // malformed lead cannot turn a successful search into a non-JSON / invalid
    // envelope for the workspace client.
    let projected = parseSourcingAgentCandidates(candidates, campaignId, count);
    if (!projected) {
      const kept: NonNullable<ReturnType<typeof parseSourcingAgentCandidates>> = [];
      for (const candidate of candidates) {
        const one = parseSourcingAgentCandidates([candidate], campaignId, 1);
        if (one?.[0]) kept.push(one[0]);
      }
      projected = kept.slice(0, count);
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
    });
    if (completion.status !== "completed" || completion.runId !== begun.runId) {
      await recordClaimFailure("RUN_COMPLETION_FAILED");
      return fail(503, "SOURCING_AGENT_UNAVAILABLE", "Sourcing-run completion could not be recorded.");
    }
    return noStoreJson({ ...resultPayload, feedbackReceipts: completion.receipts });
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
