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
import { SOURCING_TOOL_DEFS, makeSourcingToolRunner, peopleFirstEnrichmentClearance } from "@/lib/ai/sourcing-tools";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { classifySameOriginJsonRequest } from "@/lib/api/same-origin-json";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { dedupeCandidates } from "@/lib/rules";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { MISSING_PEOPLE_PLUGINS_TOAST } from "@/lib/sourcing/people-plugins";
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
import {
  resolveStoredApifyKey,
  runGithubProfileScraperAndWait,
  runLinkedinProfileScraperAndWait,
} from "@/lib/sourcing/apify";
import {
  formatHarvestEvidenceError,
  HARVEST_ACTOR,
  logAriaHarvest,
  PEOPLE_FIRST_HARVEST_CONTINUE,
  PEOPLE_FIRST_HARVEST_EMPTY,
  PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS,
  PEOPLE_FIRST_HARVEST_MOCK,
  PEOPLE_FIRST_HARVEST_NOT_STARTED,
  PEOPLE_FIRST_HARVEST_STILL_RUNNING,
  type HarvestEvidence,
} from "@/lib/sourcing/harvest-evidence";
import { workspaceApifyIsMock } from "@/lib/sourcing/people-connect";
import { isPeopleFirstContactComplete } from "@/lib/sourcing/people-first-contact";
import {
  apifyHarvestQueryFromBrief,
  PEOPLE_FIRST_ATTEMPT_WAIT_MS,
  PEOPLE_FIRST_CHAIN_BUDGET_MS,
  PEOPLE_FIRST_MAX_ATTEMPTS,
  peopleFirstHarvestQueue,
  peopleFirstSearchKey,
  plannedSourcingSearches,
  type PlannedSearch,
} from "@/lib/sourcing/multi-source-plan";
import {
  peopleFirstAlternateQuery,
  runPeopleFirstEmptyFallthrough,
  type PeopleFirstFallthroughResult,
} from "@/lib/sourcing/people-first-fallthrough";
import { roleProfile } from "@/lib/roles";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Candidate, Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 360;

/** Bound key lookup so a hung vault/Supabase read cannot stall before request_entry. */
const APIFY_KEY_RESOLVE_MS = 8_000;

const SYSTEM_PROMPT =
  "You are Aria's autonomous sourcing agent. You have a search_candidates tool that returns real, " +
  "already-scored people found through live search. Never invent a candidate, score, company, or URL. " +
  "Search LinkedIn and Apify first for people who have the required skills; GitHub only for real " +
  "programming-language queries, never language:Calypso or a concatenated skill blob. " +
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
  | "SOURCING_AGENT_RATE_LIMITED"
  | "SOURCING_AGENT_REPLAY_BLOCKED"
  | "SOURCING_AGENT_NOT_CONFIGURED"
  | "MISSING_PLUGIN"
  | "SOURCING_AGENT_UPSTREAM_FAILED"
  | "SOURCING_AGENT_RESPONSE_INVALID"
  | "SOURCING_AGENT_UNAVAILABLE"
  | "PEOPLE_FIRST_HARVEST_NOT_STARTED"
  | "PEOPLE_FIRST_HARVEST_STILL_RUNNING"
  | "PEOPLE_FIRST_HARVEST_EMPTY"
  | "PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS"
  | "PEOPLE_FIRST_HARVEST_CONTINUE"
  | "PEOPLE_FIRST_HARVEST_MOCK";

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
  extra?: Record<string, unknown>,
): NextResponse {
  const response = noStoreJson(
    { ok: false, code, error, requestId: correlationId, ...(extra ?? {}) },
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
  const projected = projectSourcingAgentWorkspace(data?.state, campaignId);
  if (projected.status !== "ok") return projected;
  return {
    status: "ok" as const,
    value: projected.value,
    apifyMock: workspaceApifyIsMock(data?.state),
  };
}

async function resolveApifyKeyBounded(
  session: Session,
): Promise<string | null> {
  try {
    return await Promise.race([
      resolveStoredApifyKey(session),
      new Promise<string | null>((resolve) => {
        setTimeout(() => resolve(null), APIFY_KEY_RESOLVE_MS).unref?.();
      }),
    ]);
  } catch {
    return null;
  }
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
  let harvestQuery = "";
  const fail = (
    status: number,
    code: ErrorCode,
    error: string,
    retryAfter?: number,
    reason?: string,
    extra?: Record<string, unknown>,
  ) => {
    logAriaHarvest("request_exit", {
      query: harvestQuery || undefined,
      started: false,
      detail: reason ? `${code}:${reason}` : code,
    });
    return errorResponse(status, code, error, correlationId, retryAfter, extra);
  };

  if (prodFailClosed()) {
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing authority is unavailable.",
      undefined,
      "prod_fail_closed",
    );
  }
  if (!supabaseEnabled) {
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing authority is unavailable.",
      undefined,
      "supabase_disabled",
    );
  }
  const sameOrigin = classifySameOriginJsonRequest(req);
  if (sameOrigin === "unsupported_media_type") {
    return fail(415, "INVALID_REQUEST", "Expected a JSON request.");
  }
  if (sameOrigin === "cross_origin_request") {
    return fail(403, "CROSS_ORIGIN_REQUEST", "Cross-origin sourcing is not allowed.");
  }

  const session = await getServerSupabase();
  if (!session) {
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing authority is unavailable.",
      undefined,
      "session_null",
    );
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
  if (initial.status === "unavailable") {
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Campaign authority is unavailable.",
      undefined,
      "workspace_read_error",
    );
  }
  if (initial.status === "invalid_state") {
    const codes = (initial.issueCodes ?? [])
      .filter((code) => /^[A-Za-z0-9._-]{1,40}$/.test(code))
      .slice(0, 12)
      .join(",");
    return fail(
      409,
      "CAMPAIGN_NOT_READY",
      "Campaign brief requires review before sourcing.",
      undefined,
      codes ? `campaign_invalid_state codes=${codes}` : "campaign_invalid_state",
    );
  }
  if (initial.status !== "ok") {
    return fail(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Campaign authority is unavailable.",
      undefined,
      "unhandled",
    );
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
  const multiSourcePlan = plannedSourcingSearches(initial.value.campaign);
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
  const peopleFirst = roleProfile(initial.value.campaign.jobAnalysis).queryStyle === "linkedin";
  const deterministic = Boolean(frameworkAuthorization) || !cloudConfig || peopleFirst;
  if (deterministic && (frameworkAuthorization ? configuredQueries.length === 0 : multiSourcePlan.length === 0)) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign has no reviewed real-sourcing query.");
  }
  const roleBasis: SourcingRoleBasis = sourcingRoleBasisForCampaign(initial.value.campaign);
  if (roleBasis.skills.length === 0) {
    return fail(409, "CAMPAIGN_NOT_READY", "Campaign brief requires a reviewed role skill.");
  }

  let cloudSlug: AiProviderSlug | null = null;
  let toolModel: string | null = null;
  if (!frameworkAuthorization && cloudConfig && !peopleFirst) {
    cloudSlug = cloudConfig.provider as AiProviderSlug;
    toolModel = cloudConfig.model || DEFAULT_MODEL[cloudSlug];
    if (!cloudConfig.apiKeyId) {
      return fail(503, "SOURCING_AGENT_NOT_CONFIGURED", "The selected provider has no workspace key.");
    }
  }
  harvestQuery = apifyHarvestQueryFromBrief(initial.value.campaign.jobAnalysis);
  const apifyMock = initial.apifyMock;
  // Mock is not a live key. Do not decrypt or hang on vault before evidence.
  const apifyToken = apifyMock ? null : await resolveApifyKeyBounded(session);
  const plannedPeopleFirstHarvests = peopleFirst
    ? peopleFirstHarvestQueue(initial.value.campaign.jobAnalysis)
    : [];
  logAriaHarvest("request_entry", {
    query: harvestQuery,
    campaign: initial.value.campaign.jobAnalysis.title,
    apifyKeyPresent: !apifyMock && Boolean(apifyToken),
    started: false,
    detail: peopleFirst
      ? `plannedHarvests=${plannedPeopleFirstHarvests.length}`
      : undefined,
  });
  // Fail before claiming a run. Tavily is not LinkedIn. GitHub Live-unconfigured
  // is not a people source. Name the plugins and the connect action.
  if (peopleFirst && apifyMock) {
    return fail(
      503,
      PEOPLE_FIRST_HARVEST_MOCK,
      formatHarvestEvidenceError("mock", { query: harvestQuery }),
    );
  }
  if (peopleFirst && !apifyToken) {
    return fail(503, "MISSING_PLUGIN", MISSING_PEOPLE_PLUGINS_TOAST);
  }
  // Tavily after request_entry. People-first harvest stays harvestapi Full.
  // Tavily is only used after the harvest queue is exhausted (LinkedIn web).
  const tavilyKey = await resolveStoredTavilyKey(session);
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
    extra?: Record<string, unknown>,
  ) => {
    await recordClaimFailure(code);
    return fail(status, code, message, undefined, undefined, extra);
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

  /** People-first next-search must not die on leftover-strip fingerprint drift. */
  const peopleFirstContinueAuthority = async (): Promise<
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
    if (latest.status !== "ok" || !campaignAllowsSourcing(latest.value.campaign)) {
      return {
        ok: false,
        status: 409,
        code: "CAMPAIGN_CHANGED",
        message: "Campaign authority changed during the operation.",
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
    if (!deterministic && cloudConfig && cloudSlug) {
      vaultKey = await resolveVaultSecret(cloudConfig.apiKeyId, VAULT_PROVIDER[cloudSlug]);
      if (!vaultKey) {
        return await failClaimed(
          403,
          "SOURCING_AGENT_NOT_CONFIGURED",
          "The selected provider key is unavailable.",
        );
      }
    }
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
    let peopleFirstHarvestsStarted = 0;
    const runner = makeSourcingToolRunner(
      initial.value.campaign,
      initial.value.existing,
      initial.value.campaign.scoringWeights,
      githubToken,
      tavilyKey ?? undefined,
      undefined,
      async () => {
        if (peopleFirst && !frameworkAuthorization) {
          const allow =
            peopleFirstHarvestsStarted === 0
              ? (await peopleFirstContinueAuthority()).ok
              : true;
          peopleFirstHarvestsStarted += 1;
          return allow;
        }
        return (await currentAuthority()).ok;
      },
      apifyToken ?? undefined,
    );
    const servers = [
      {
        url: "builtin:sourcing-agent",
        token: "",
        tools: SOURCING_TOOL_DEFS,
        run: runner.run,
      },
    ];
    let drafts: ReturnType<typeof parseDrafts> = [];
    if (deterministic && peopleFirst && !frameworkAuthorization) {
      // ONE durable chain per click, server-owned: every planned harvest
      // (fresh 90s each), then LinkedIn web, enrich, and GitHub merge. A
      // reviewed `harvestQuery` only says where to resume after
      // PEOPLE_FIRST_HARVEST_CONTINUE. Never 0 people as success. Do not
      // invent people.
      const peopleFirstJob = initial.value.campaign.jobAnalysis;
      const queue = peopleFirstHarvestQueue(peopleFirstJob).slice(0, PEOPLE_FIRST_MAX_ATTEMPTS);
      const plannedQuery = apifyHarvestQueryFromBrief(peopleFirstJob);
      const requestedHarvest = validated.data.harvestQuery?.trim() ?? "";
      let resumeIndex = 0;
      if (requestedHarvest) {
        const requestedTitles = (validated.data.currentJobTitles ?? [])
          .map((title) => title.trim())
          .filter(Boolean)
          .slice(0, 8);
        const requested = {
          query: requestedHarvest,
          ...(requestedTitles.length ? { currentJobTitles: requestedTitles } : {}),
        };
        resumeIndex = queue.findIndex(
          (step) => peopleFirstSearchKey(step) === peopleFirstSearchKey(requested),
        );
        if (resumeIndex < 0) {
          return await failClaimed(
            409,
            "CAMPAIGN_CHANGED",
            "Harvest step is not on the reviewed plan.",
          );
        }
      }
      if (queue.length === 0) {
        return await failClaimed(
          502,
          PEOPLE_FIRST_HARVEST_NOT_STARTED,
          formatHarvestEvidenceError("not_started", { query: plannedQuery }),
        );
      }
      const chainStart = Date.now();
      let continueAt: PlannedSearch | null = null;
      for (let index = resumeIndex; index < queue.length; index += 1) {
        if (runner.getFound().length > 0) break;
        if (index > resumeIndex && Date.now() - chainStart >= PEOPLE_FIRST_CHAIN_BUDGET_MS) {
          continueAt = queue[index] ?? null;
          break;
        }
        const step = queue[index];
        if (!step) break;
        harvestQuery = step.query;
        const nextStep = queue[index + 1] ?? null;
        if (index > resumeIndex) {
          logAriaHarvest("next_search_start", {
            query: step.query,
            started: false,
            nextQuery: step.query,
            detail: `attempt=${index + 1}/${queue.length}`,
          });
        }
        // Fresh 90s per harvest. Never one shared abort across the plan.
        const stepAbort = new AbortController();
        const stepTimer = setTimeout(() => stepAbort.abort(), PEOPLE_FIRST_ATTEMPT_WAIT_MS);
        try {
          await runner.run(
            "search_candidates",
            {
              platform: step.platform,
              query: step.query,
              count,
              ...(step.currentJobTitles?.length ? { currentJobTitles: step.currentJobTitles } : {}),
            },
            stepAbort.signal,
          );
        } finally {
          clearTimeout(stepTimer);
        }
        const harvest = runner.getExecutions().at(-1)?.harvest;
        if (!harvest?.started) {
          return await failClaimed(
            502,
            PEOPLE_FIRST_HARVEST_NOT_STARTED,
            formatHarvestEvidenceError("not_started", {
              query: step.query,
              runId: harvest?.runId,
              status: harvest?.status,
            }),
          );
        }
        const harvestStatus = harvest.status.toUpperCase();
        const terminalFail =
          harvestStatus === "FAILED" ||
          harvestStatus === "ABORTED" ||
          harvestStatus === "TIMED-OUT" ||
          harvestStatus === "TIMED_OUT";
        if (harvestStatus !== "SUCCEEDED" && !terminalFail) {
          if (runner.getFound().length > 0) break;
          return await failClaimed(
            502,
            PEOPLE_FIRST_HARVEST_STILL_RUNNING,
            formatHarvestEvidenceError("still_running", harvest),
          );
        }
        if (runner.getFound().length === 0 && nextStep) {
          logAriaHarvest("empty_next_search", {
            query: harvest.query || step.query,
            runId: harvest.runId,
            status: harvest.status,
            itemCount: Math.max(harvest.itemCount, 0),
            started: true,
            nextQuery: nextStep.query,
            detail: `nextQuery=${nextStep.query}`,
          });
        }
      }

      let foundCount = runner.getFound().length;
      if (foundCount === 0 && continueAt) {
        // Chain budget ran out with planned harvests left. The same click
        // re-POSTs from this step. Not a result, not 0 people.
        return await failClaimed(
          502,
          PEOPLE_FIRST_HARVEST_CONTINUE,
          formatHarvestEvidenceError("continue", { query: continueAt.query }),
          {
            resume: {
              query: continueAt.query,
              ...(continueAt.currentJobTitles?.length
                ? { currentJobTitles: continueAt.currentJobTitles }
                : {}),
            },
          },
        );
      }

      let fallthrough: PeopleFirstFallthroughResult | null = null;
      if (foundCount === 0) {
        // Empty LinkedIn search is not terminal: LinkedIn web (role + geo),
        // then enrich every URL we hold, then GitHub merge onto accepted people.
        const alternateQuery = peopleFirstAlternateQuery(peopleFirstJob) || plannedQuery;
        const clearance = peopleFirstEnrichmentClearance(initial.value.campaign, alternateQuery);
        const notStarted = (detail: string) => ({
          ok: false,
          runId: "",
          status: "NOT_STARTED",
          itemCount: -1,
          started: false,
          acceptedCount: 0,
          detail,
        });
        fallthrough = await runPeopleFirstEmptyFallthrough({
          job: peopleFirstJob,
          poolUrls: runner.getIncompleteLinkedinUrls(),
          discoverLinkedin: (query) => runner.discoverLinkedinUrls(query, count),
          enrichProfiles: async (urls) => {
            if (!clearance.ok) return notStarted(clearance.error);
            if (!apifyToken) return notStarted("no Apify key");
            const run = await runLinkedinProfileScraperAndWait(clearance.clearance, apifyToken, urls);
            if (!run.ok) {
              return {
                ok: false,
                runId: run.harvest.runId,
                status: run.harvest.status,
                itemCount: run.harvest.itemCount,
                started: run.harvest.started,
                acceptedCount: 0,
                detail: run.title,
              };
            }
            const accepted = runner.acceptEnrichedProfiles(run.data, alternateQuery, run.harvest);
            return {
              ok: true,
              runId: run.harvest.runId,
              status: run.harvest.status,
              itemCount: run.harvest.itemCount,
              started: true,
              acceptedCount: accepted.acceptedCount,
            };
          },
          githubHandles: () =>
            runner
              .getFound()
              .map((person) => person.githubUrl?.trim() ?? "")
              .filter(Boolean),
          mergeGithub: async (handles) => {
            if (!clearance.ok) return notStarted(clearance.error);
            if (!apifyToken) return notStarted("no Apify key");
            const run = await runGithubProfileScraperAndWait(clearance.clearance, apifyToken, handles);
            if (!run.ok) {
              return {
                ok: false,
                runId: run.harvest.runId,
                status: run.harvest.status,
                itemCount: run.harvest.itemCount,
                started: run.harvest.started,
                detail: run.title,
              };
            }
            const merged = runner.mergeGithubStack(run.data);
            return {
              ok: true,
              runId: run.harvest.runId,
              status: run.harvest.status,
              itemCount: run.harvest.itemCount,
              started: true,
              detail: `merged=${merged}`,
            };
          },
        });
        foundCount = runner.getFound().length;
      }

      if (foundCount === 0) {
        const searchHarvests = runner
          .getExecutions()
          .filter((execution) => execution.platform === "Apify")
          .map((execution) => execution.harvest)
          .filter(
            (harvest): harvest is HarvestEvidence =>
              Boolean(harvest) && harvest?.actor === HARVEST_ACTOR,
          );
        const primaryHarvest =
          searchHarvests.find((harvest) => harvest.query === plannedQuery) ?? searchHarvests[0];
        if (!primaryHarvest) {
          return await failClaimed(
            502,
            PEOPLE_FIRST_HARVEST_NOT_STARTED,
            formatHarvestEvidenceError("not_started", { query: plannedQuery }),
          );
        }
        const startedSearches = new Set(
          searchHarvests
            .filter((harvest) => harvest.started)
            .map((harvest) => `${harvest.runId}|${harvest.query.trim().toLowerCase()}`),
        ).size;
        const suffix = fallthrough ? ` ${fallthrough.logged}` : "";
        const succeeded = searchHarvests.filter((harvest) => harvest.status.toUpperCase() === "SUCCEEDED");
        if (succeeded.length === 0) {
          return await failClaimed(
            502,
            "SOURCING_AGENT_UPSTREAM_FAILED",
            `${formatHarvestEvidenceError("empty", { ...primaryHarvest, itemCount: 0 }, { startedSearches })}${suffix}`,
          );
        }
        const withPeople = succeeded.filter((harvest) => harvest.itemCount > 0);
        const contactCompleteCount = runner
          .getExecutions()
          .reduce((sum, execution) => sum + (execution.contactCompleteCount ?? 0), 0);
        if (withPeople.length > 0 && contactCompleteCount === 0) {
          return await failClaimed(
            502,
            PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS,
            `${formatHarvestEvidenceError("incomplete_contacts", withPeople[0] ?? primaryHarvest)}${suffix}`,
          );
        }
        if (withPeople.length > 0) {
          return await failClaimed(
            502,
            PEOPLE_FIRST_HARVEST_EMPTY,
            `${formatHarvestEvidenceError("gated_empty", withPeople[0] ?? primaryHarvest, { startedSearches })}${suffix}`,
          );
        }
        const emptyHarvest = succeeded.find((harvest) => harvest.itemCount === 0) ?? primaryHarvest;
        return await failClaimed(
          502,
          PEOPLE_FIRST_HARVEST_EMPTY,
          `${formatHarvestEvidenceError("empty", emptyHarvest, { startedSearches })}${suffix}`,
        );
      }
    } else if (deterministic) {
      const searchAbort = new AbortController();
      const searchBudgetMs = 45_000;
      const searchBudget = setTimeout(() => searchAbort.abort(), searchBudgetMs);
      const searchSignal = searchAbort.signal;
      try {
        const searches = frameworkAuthorization
          ? [{ platform: "GitHub" as const, query: frameworkAuthorization.query }]
          : [
              ...promotedLessons
                .filter(
                  (lesson) => lesson.platform === "LinkedIn" || lesson.platform === "GitHub",
                )
                .map((lesson) => ({ platform: lesson.platform, query: lesson.query })),
              ...multiSourcePlan,
            ]
              .filter(
                (step, index, all) =>
                  all.findIndex((other) => other.platform === step.platform && other.query === step.query) === index,
              )
              .slice(0, 5);
        let successfulQuery = false;
        for (const step of searches) {
          const remaining = count - runner.getFound().length;
          if (remaining <= 0) break;
          const stepAbort = new AbortController();
          const stepTimer = setTimeout(() => stepAbort.abort(), searchBudgetMs);
          if (searchSignal.aborted) stepAbort.abort();
          else {
            searchSignal.addEventListener("abort", () => stepAbort.abort(), { once: true });
          }
          let result: { ok: boolean } = { ok: false };
          try {
            result = await runner.run(
              "search_candidates",
              { platform: step.platform, query: step.query, count: remaining },
              stepAbort.signal,
            );
          } finally {
            clearTimeout(stepTimer);
          }
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
      } finally {
        clearTimeout(searchBudget);
      }
    } else {
      if (!cloudSlug || !toolModel || !vaultKey) {
        return await failClaimed(
          503,
          "SOURCING_AGENT_NOT_CONFIGURED",
          "The selected provider is unavailable.",
        );
      }
      const prompt = buildPrompt(initial.value.campaign, count, promotedLessons);
      const { runAnthropicWithTools, runOpenAiWithTools } = await import("@/lib/ai/tool-loop");
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
    const finalAuthority =
      peopleFirst && !frameworkAuthorization
        ? await peopleFirstContinueAuthority()
        : await currentAuthority();
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
        if (peopleFirst && !isPeopleFirstContactComplete(candidate)) return null;
        return {
          id: candidate.id,
          campaignId,
          name: candidate.name,
          ...(peopleFirst && candidate.email ? { email: candidate.email } : {}),
          ...(peopleFirst && candidate.phone ? { phone: candidate.phone } : {}),
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

    const learningReceipts = executions
      .filter((execution) => !peopleFirst || (execution.ok && execution.candidateCount > 0))
      .map((execution) => ({
        platform: execution.platform === "Apify" ? ("LinkedIn" as const) : execution.platform,
        query: execution.query,
        ok: execution.ok,
        candidateCount: execution.candidateCount,
        skippedCount: execution.skippedCount,
      }));
    if (peopleFirst && learningReceipts.length === 0) {
      return await failClaimed(
        502,
        "SOURCING_AGENT_UPSTREAM_FAILED",
        "The sourcing agent completed without a real search.",
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
        queryReceipts: learningReceipts,
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
      queryReceipts: learningReceipts,
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
  logAriaHarvest("request_received", { started: false });
  try {
    return await handlePost(req, correlationId);
  } catch {
    logAriaHarvest("request_exit", {
      started: false,
      detail: "SOURCING_AGENT_UNAVAILABLE:unhandled",
    });
    return errorResponse(
      503,
      "SOURCING_AGENT_UNAVAILABLE",
      "Live sourcing-agent authority is unavailable.",
      correlationId,
    );
  }
}
