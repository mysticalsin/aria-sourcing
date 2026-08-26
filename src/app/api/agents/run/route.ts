import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { detectInjection } from "@/lib/agent-disclosure-policy";
import { executeAgentFrameworkRun } from "@/lib/agents/framework/execution";
import { agentFrameworkRuntimeFromEnvironment } from "@/lib/agents/framework/runtime-config";
import { loadAgentFrameworkMemoryContext } from "@/lib/agents/memory";
import {
  AgentFrameworkNeedSchema,
  AgentFrameworkRunSuccessResponseSchema,
  assessAgentFrameworkRuntime,
  normalizeAgentRoleTitle,
} from "@/lib/agents/framework/contracts";
import { resolveStoredAgentRuntimePolicy, SupportedAgentRoleBriefSchema } from "@/lib/agents/runtime-policy";
import { validateBody } from "@/lib/api/validate";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { campaignAllowsLiveSourcing } from "@/lib/sourcing/campaign-lifecycle";
import { prioritizeReviewedGithubQueries } from "@/lib/sourcing/framework-learning-selection";
import { listPromotedSourcingLessons } from "@/lib/sourcing/learning-authority";
import { sourcingRoleBasisForCampaign } from "@/lib/sourcing/role-basis";
import {
  projectSourcingAgentWorkspace,
  type SourcingAgentCampaign,
} from "@/lib/sourcing/sourcing-agent-contract";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import { isTrustedBrowserOrigin } from "@/lib/api/same-origin-json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AgentFrameworkRunSchema = z.object({
  campaignId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
  specId: z.string().uuid(),
  workflowVersionId: z.string().uuid(),
  count: z.number().int().min(1).max(8).default(5),
}).strict();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function unsafeCampaignInput(campaign: SourcingAgentCampaign): boolean {
  const job = campaign.jobAnalysis;
  return [
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
  ].some((value) => detectInjection(value).flagged);
}

function stableCampaignSha256(fingerprint: string): string {
  return createHash("sha256").update(fingerprint, "utf8").digest("hex");
}

function executionFailure(code: string, requestId: string) {
  const status = code === "idempotency_conflict" || code === "in_progress" || code === "already_completed" ||
      code === "authority_changed" || code === "workflow_unavailable"
    ? 409
    : code === "proposal_invalid"
      ? 502
      : 503;
  return noStoreJson({ ok: false, code: `agent_${code}`, requestId }, status);
}

/**
 * Executes only an approved Flowise IR through the private DeerFlow adapter.
 * The framework can propose the exact persisted GitHub query; the browser must
 * then call the canonical campaign sourcing action, which rechecks authority,
 * performs the real provider search, and persists candidates before success.
 */
export async function POST(req: NextRequest) {
  const correlationId = /^[A-Za-z0-9._:-]{1,100}$/.test(req.headers.get("x-request-id") ?? "")
    ? req.headers.get("x-request-id") as string
    : randomUUID();
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0]?.trim() !== "application/json") {
    return noStoreJson({ ok: false, code: "invalid_request", requestId: correlationId }, 415);
  }
  const origin = req.headers.get("origin");
  if (!isTrustedBrowserOrigin(origin, req.nextUrl.origin)) {
    return noStoreJson({ ok: false, code: "cross_origin_request", requestId: correlationId }, 403);
  }
  if (!supabaseEnabled) {
    return executionFailure("authority_unavailable", correlationId);
  }

  const runtimeConfig = agentFrameworkRuntimeFromEnvironment();
  if (!assessAgentFrameworkRuntime(runtimeConfig.config).ready) {
    return executionFailure("framework_unavailable", correlationId);
  }
  const session = await getServerSupabase();
  if (!session) return executionFailure("authority_unavailable", correlationId);
  const { data: { user } } = await session.auth.getUser();
  if (!user) return noStoreJson({ ok: false, code: "not_authenticated", requestId: correlationId }, 401);

  const [{ data: role }, { data: workspaceId }] = await Promise.all([
    session.rpc("current_profile_role"),
    session.rpc("current_workspace_id"),
  ]);
  if (!can(role as Role, "source")) {
    return noStoreJson({ ok: false, code: "insufficient_permissions", requestId: correlationId }, 403);
  }
  if (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)) {
    return executionFailure("authority_unavailable", correlationId);
  }

  const limited = checkRateLimit(rateLimitKey(req, "agent-framework-run", user.id), {
    windowMs: 60_000,
    max: 5,
  });
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
  const validated = await validateBody(req, AgentFrameworkRunSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!UUID_RE.test(idempotencyKey)) {
    return noStoreJson({ ok: false, code: "invalid_request", requestId: correlationId }, 400);
  }

  const readWorkspace = async () => {
    const { data, error } = await session
      .from("workspace_state")
      .select("state")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { status: "unavailable" as const };
    return projectSourcingAgentWorkspace(data?.state, validated.data.campaignId);
  };

  const initial = await readWorkspace();
  if (initial.status !== "ok") {
    return noStoreJson({ ok: false, code: "campaign_not_found", requestId: correlationId }, initial.status === "campaign_not_found" ? 404 : 503);
  }
  const campaign = initial.value.campaign;
  if (!campaignAllowsLiveSourcing(campaign.status)) {
    return noStoreJson({ ok: false, code: "campaign_not_active", requestId: correlationId }, 409);
  }
  if (!evaluateNeedReadiness(campaign.jobAnalysis).ready || unsafeCampaignInput(campaign)) {
    return noStoreJson({ ok: false, code: "campaign_not_ready", requestId: correlationId }, 409);
  }
  const reviewedGithubQueries = campaign.sourcingStrategy.githubQueries
    .map((query) => query.query.trim())
    .filter(Boolean)
    .slice(0, 20);
  const frameworkNeed = AgentFrameworkNeedSchema.safeParse({
    title: campaign.jobAnalysis.title,
    seniority: campaign.jobAnalysis.seniority,
    employmentType: campaign.jobAnalysis.employmentType,
    locationType: campaign.jobAnalysis.locationType,
    ...(campaign.jobAnalysis.location ? { location: campaign.jobAnalysis.location } : {}),
    regions: campaign.jobAnalysis.regions,
    requiredSkills: campaign.jobAnalysis.requiredSkills,
    niceToHaveSkills: campaign.jobAnalysis.niceToHaveSkills,
    minYearsExperience: campaign.jobAnalysis.minYearsExperience,
    maxYearsExperience: campaign.jobAnalysis.maxYearsExperience,
    industryExperience: campaign.jobAnalysis.industryExperience,
  });
  if (
    reviewedGithubQueries.length === 0 ||
    reviewedGithubQueries.some((query) => query.length < 3 || query.length > 256) ||
    !frameworkNeed.success
  ) {
    return noStoreJson({ ok: false, code: "campaign_not_ready", requestId: correlationId }, 409);
  }

  const { data: spec, error: specError } = await session
    .from("agent_specs")
    .select("id,owner_id,role_brief,channels,guardrails,status")
    .eq("id", validated.data.specId)
    .maybeSingle();
  const roleBrief = SupportedAgentRoleBriefSchema.safeParse(spec?.role_brief);
  const policy = resolveStoredAgentRuntimePolicy(spec?.channels, spec?.guardrails);
  if (
    specError || !spec || spec.owner_id !== user.id || spec.status !== "active" ||
    !roleBrief.success || !policy.ok ||
    normalizeAgentRoleTitle(roleBrief.data.title) !== normalizeAgentRoleTitle(campaign.jobAnalysis.title)
  ) {
    return noStoreJson({ ok: false, code: "agent_spec_unavailable", requestId: correlationId }, 409);
  }

  const service = getServiceSupabase();
  if (!service) return executionFailure("authority_unavailable", correlationId);

  const roleBasis = sourcingRoleBasisForCampaign(campaign);
  const listedLessons = await listPromotedSourcingLessons({
    workspaceId,
    actorId: user.id,
    roleBasis,
    limit: 10,
  }, service);
  if (listedLessons.status !== "ready" && listedLessons.status !== "learning_disabled") {
    return executionFailure("authority_unavailable", correlationId);
  }
  const governedGithubQueries = prioritizeReviewedGithubQueries(
    reviewedGithubQueries,
    listedLessons.status === "ready" ? listedLessons.lessons : [],
  );

  const initialFingerprint = initial.value.fingerprint;
  const result = await executeAgentFrameworkRun({
    client: service,
    runtime: runtimeConfig.config,
    deerflowToken: runtimeConfig.tokens.deerflowToken,
    capabilitySecret: process.env.AGENT_FRAMEWORK_CAPABILITY_SECRET ?? "",
    workspaceId,
    ownerId: user.id,
    actorId: user.id,
    specId: spec.id,
    campaignId: campaign.id,
    campaignFingerprint: stableCampaignSha256(initialFingerprint),
    workflowVersionId: validated.data.workflowVersionId,
    idempotencyKey,
    reviewedGithubQueries: governedGithubQueries,
    need: frameworkNeed.data,
    sourcingCount: validated.data.count ?? 5,
    loadMemoryContext: (scope, runId) => loadAgentFrameworkMemoryContext(service, scope, runId),
    revalidateAuthority: async () => {
      const [{ data: latestRole }, { data: latestWorkspaceId }, latest, latestSpec] = await Promise.all([
        session.rpc("current_profile_role"),
        session.rpc("current_workspace_id"),
        readWorkspace(),
        session.from("agent_specs")
          .select("owner_id,status,role_brief,channels,guardrails")
          .eq("id", spec.id)
          .maybeSingle(),
      ]);
      const latestRoleBrief = SupportedAgentRoleBriefSchema.safeParse(latestSpec.data?.role_brief);
      return can(latestRole as Role, "source") &&
        latestWorkspaceId === workspaceId &&
        latest.status === "ok" &&
        latest.value.fingerprint === initialFingerprint &&
        campaignAllowsLiveSourcing(latest.value.campaign.status) &&
        !latestSpec.error &&
        latestSpec.data?.owner_id === user.id &&
        latestSpec.data?.status === "active" &&
        latestRoleBrief.success &&
        normalizeAgentRoleTitle(latestRoleBrief.data.title) ===
          normalizeAgentRoleTitle(latest.value.campaign.jobAnalysis.title) &&
        resolveStoredAgentRuntimePolicy(latestSpec.data?.channels, latestSpec.data?.guardrails).ok;
    },
  });
  if (!result.ok) return executionFailure(result.code, correlationId);

  const response = AgentFrameworkRunSuccessResponseSchema.safeParse({
    ok: true,
    runId: result.runId,
    reports: result.reports,
    command: {
      kind: "source_reviewed_campaign",
      campaignId: campaign.id,
      count: validated.data.count ?? 5,
      query: result.sourceQuery,
      capabilityToken: result.sourcingCapabilityToken,
    },
    requestId: correlationId,
  });
  return response.success
    ? noStoreJson(response.data)
    : executionFailure("proposal_invalid", correlationId);
}
