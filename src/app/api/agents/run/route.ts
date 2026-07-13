import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Campaign, Candidate, JobAnalysis, Role } from "@/lib/types";
import {
  DEFAULT_MODEL,
  PROVIDER_ENV,
  VAULT_PROVIDER,
  buildCloudRequest,
  parseCloudResponse,
  type AiProviderSlug,
} from "@/lib/ai/provider";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { makeSourcingToolRunner } from "@/lib/ai/sourcing-tools";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { initialState, runGraph, type CandidateLite, type GraphDeps } from "@/lib/agents/graph";
import {
  applyAgentMemoryContext,
  createAgentRunWithMemoryContext,
  loadAgentMemoryContext,
} from "@/lib/agents/memory";
import { resolveStoredAgentRuntimePolicy } from "@/lib/agents/runtime-policy";
import { resolveStoredTavilyKey } from "@/lib/sourcing/tavily";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * On-demand sourcing agent run — the deer-flow-style graph
 * (planner → sourcer → screener → outreach → reporter) over the same real
 * search + deterministic scoring the single-shot /api/sourcing-agent uses.
 *
 * Same posture as that route: TEXT + SEARCH ONLY. This never sends anything;
 * gate-passing drafts enter queue-only human review before send. This route
 * never approves or sends candidate communication.
 *
 * Every run is bound to one active stored agent spec. Its approved encrypted
 * memory selection is receipted before model execution, and every graph node
 * persists to agent_runs plus the append-only agent_events narration stream.
 */
const AGENT_PROVIDERS = ["anthropic", "openai", "groq", "xai", "mistral"] as const;

const AgentRunSchema = z.object({
  existing: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  count: z.number().int().min(1).max(8).default(5),
  provider: z.enum(AGENT_PROVIDERS),
  apiKeyId: z.string().uuid().optional(),
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),
  specId: z.string().uuid(),
});

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Legacy specs were accepted as free-form JSON. Normalize only stored fields
 * so old specs remain runnable without restoring caller-controlled authority. */
function normalizeStoredRoleBrief(value: unknown): JobAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const brief = value as Record<string, unknown>;
  const title = typeof brief.title === "string" ? brief.title.trim() : "";
  if (!title) return null;
  const numberOrNull = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;

  return {
    ...brief,
    title,
    department: typeof brief.department === "string" ? brief.department : "",
    seniority: typeof brief.seniority === "string" ? brief.seniority : "Senior",
    employmentType: typeof brief.employmentType === "string" ? brief.employmentType : "Full-time",
    locationType: typeof brief.locationType === "string" ? brief.locationType : "Remote",
    location: typeof brief.location === "string" ? brief.location : "",
    regions: stringArray(brief.regions),
    timezone: typeof brief.timezone === "string" ? brief.timezone : "",
    salaryMin: numberOrNull(brief.salaryMin),
    salaryMax: numberOrNull(brief.salaryMax),
    currency: typeof brief.currency === "string" ? brief.currency : "",
    equity: brief.equity === true,
    requiredSkills: stringArray(brief.requiredSkills).length
      ? stringArray(brief.requiredSkills)
      : stringArray(brief.skills),
    niceToHaveSkills: stringArray(brief.niceToHaveSkills),
    minYearsExperience: numberOrNull(brief.minYearsExperience),
    maxYearsExperience: numberOrNull(brief.maxYearsExperience),
    education: typeof brief.education === "string" ? brief.education : "",
    industryExperience: stringArray(brief.industryExperience),
    companyStageTarget: stringArray(brief.companyStageTarget),
    teamSize: typeof brief.teamSize === "string" ? brief.teamSize : "",
    reportingTo: typeof brief.reportingTo === "string" ? brief.reportingTo : "",
    urgency: typeof brief.urgency === "string" ? brief.urgency : "Standard",
    validationWarnings: [],
  } as JobAnalysis;
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, reason: "Agent authority backend is required." }, { status: 503 });
  }

  const supabase = await getServerSupabase();
  let workspaceId: string | null = null;
  let userId: string | null = null;
  let callerRole: Role | null = null;
  if (!supabase) return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
  userId = user.id;
  const { data: role } = await supabase.rpc("current_profile_role");
  callerRole = role as Role;
  if (!can(callerRole, "source")) {
    return NextResponse.json({ ok: false, reason: "Insufficient permissions." }, { status: 403 });
  }
  if (!can(callerRole, "manage_providers")) {
    return NextResponse.json({ ok: false, reason: "Live cloud agents require admin authority." }, { status: 403 });
  }
  const { data: wid } = await supabase.rpc("current_workspace_id");
  workspaceId = (wid as string) ?? null;
  if (!workspaceId) return NextResponse.json({ ok: false, reason: "Workspace authority is unavailable." }, { status: 403 });

  const rl = checkRateLimit(rateLimitKey(req, "agents-run", userId), { windowMs: 60_000, max: 6 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, AgentRunSchema, { maxBytes: 200_000 });
  if (!validated.ok) return validated.response;
  const { count = 5, provider, apiKeyId, model, specId } = validated.data;
  const existing = validated.data.existing as unknown as Candidate[];

  const { data: spec, error: specError } = await supabase
    .from("agent_specs")
    .select("id,workspace_id,owner_id,role_brief,channels,guardrails,status")
    .eq("id", specId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .maybeSingle();
  if (specError || !spec) {
    return NextResponse.json({ ok: false, reason: "Active agent spec not found." }, { status: 404 });
  }

  const jobAnalysis = normalizeStoredRoleBrief(spec.role_brief);
  if (!jobAnalysis) return NextResponse.json({ ok: false, reason: "Stored agent role brief is invalid." }, { status: 409 });
  const runtimePolicy = resolveStoredAgentRuntimePolicy(spec.channels, spec.guardrails);
  if (!runtimePolicy.ok) {
    return NextResponse.json({ ok: false, reason: runtimePolicy.reason }, { status: 409 });
  }

  const service = getServiceSupabase();
  if (!service) {
    return NextResponse.json({ ok: false, reason: "Agent persistence service is unavailable." }, { status: 503 });
  }
  const memoryScope = {
    workspaceId,
    ownerId: spec.owner_id,
    specId: spec.id,
  };

  let runId: string;
  try {
    runId = await createAgentRunWithMemoryContext(service, memoryScope, userId);
  } catch {
    return NextResponse.json({ ok: false, reason: "Agent run or context persistence failed." }, { status: 503 });
  }

  const failPersistedRun = async () => {
    await service
      .from("agent_runs")
      .update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("workspace_id", workspaceId)
      .eq("owner_id", spec.owner_id)
      .eq("spec_id", spec.id);
  };

  let memoryContext;
  try {
    memoryContext = await loadAgentMemoryContext(service, memoryScope, runId);
  } catch {
    await failPersistedRun();
    return NextResponse.json({ ok: false, reason: "Agent memory retrieval failed." }, { status: 503 });
  }

  const campaign = {
    id: spec.id,
    title: jobAnalysis.title,
    jobAnalysis,
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    sourcingStrategy: { excludedCompanies: [] },
  } as unknown as Campaign;
  const weights = campaign.scoringWeights;

  const slug = provider as AiProviderSlug;
  const vaultKey = apiKeyId ? await resolveVaultSecret(apiKeyId, VAULT_PROVIDER[slug]) : "";
  if (apiKeyId && !vaultKey) {
    await failPersistedRun();
    return NextResponse.json({ ok: false, reason: `No valid API key configured for ${provider}.` }, { status: 403 });
  }
  if (!apiKeyId && supabaseEnabled && !can(callerRole as Role, "manage_providers")) {
    await failPersistedRun();
    return NextResponse.json({ ok: false, reason: "A workspace provider key is required." }, { status: 403 });
  }
  const key = vaultKey || process.env[PROVIDER_ENV[slug]] || "";
  if (!key) {
    await failPersistedRun();
    return NextResponse.json({ ok: false, reason: `No API key configured for ${provider}.` });
  }
  const llmModel = model || DEFAULT_MODEL[slug];

  const tavilyKey = supabase ? await resolveStoredTavilyKey(supabase) : null;
  const runner = makeSourcingToolRunner(campaign, existing, weights, process.env.GITHUB_TOKEN ?? "", tavilyKey ?? undefined);
  const deps: GraphDeps = {
    async generate(system, prompt) {
      const applied = applyAgentMemoryContext(system, prompt, memoryContext);
      const reqSpec = buildCloudRequest(slug, llmModel, applied.system, applied.prompt, key, 1024);
      const res = await fetch(reqSpec.url, {
        method: "POST",
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`${provider} ${res.status}`);
      return parseCloudResponse(slug, await res.json());
    },
    async search(platform, query, searchCount) {
      const before = runner.getFound().length;
      await runner.run("search_candidates", { platform, query, count: searchCount });
      return runner
        .getFound()
        .slice(before)
        .map((c) => ({
          id: c.id,
          name: c.name,
          matchScore: c.matchScore,
          currentTitle: c.currentTitle,
          currentCompany: c.currentCompany,
        })) as CandidateLite[];
    },
  };

  // stepGraph applies candidateDisclosureContextForCampaignLike before any
  // candidate-facing model prompt; the raw brief remains server-side for sink scans.
  const state = initialState(
    campaign.jobAnalysis as unknown as Record<string, unknown>,
    count,
    runtimePolicy.policy,
  );
  let result: Awaited<ReturnType<typeof runGraph>>;
  try {
    result = await runGraph(state, deps, async (node, s, event) => {
      const hasReviewableDrafts = s.drafts.some((draft) => draft.gatePassed);
      const terminalStatus = hasReviewableDrafts ? "awaiting_gate" : "done";
      const { error: runError } = await service
        .from("agent_runs")
        .update({
          node,
          state_json: s as unknown as Record<string, unknown>,
          step_count: s.drafts.length + s.planCursor,
          status: node === "done" ? terminalStatus : "running",
          ...(node === "done" ? { finished_at: new Date().toISOString() } : {}),
        })
        .eq("id", runId)
        .eq("workspace_id", workspaceId)
        .eq("owner_id", spec.owner_id)
        .eq("spec_id", spec.id);
      if (runError) throw new Error("Agent run persistence failed.");

      const { error: eventError } = await service
        .from("agent_events")
        .insert({ run_id: runId, workspace_id: workspaceId, type: event.type, payload: event.payload });
      if (eventError) throw new Error("Agent run persistence failed.");
    }, "planner", 0, async () => {
      const { data: activeSpec, error: activeSpecError } = await supabase
        .from("agent_specs")
        .select("id")
        .eq("id", spec.id)
        .eq("workspace_id", workspaceId)
        .eq("owner_id", spec.owner_id)
        .eq("status", "active")
        .maybeSingle();
      if (activeSpecError || !activeSpec) throw new Error("Agent spec is no longer active.");
    });
  } catch {
    await failPersistedRun();
    return NextResponse.json({ ok: false, reason: "Agent run persistence or execution failed." }, { status: 503 });
  }

  const found = runner.getFound();
  const byId = new Map(found.map((c) => [c.id, c]));
  const candidates = result.state.drafts
    .filter((d) => d.gatePassed)
    .map((d) => {
      const cand = byId.get(d.candidateId);
      return cand ? { ...cand, draftSubject: d.subject, draftBody: d.body } : null;
    })
    .filter((c): c is Candidate & { draftSubject: string; draftBody: string } => c !== null);

  return NextResponse.json({
    ok: true,
    runId,
    report: result.state.report ?? "",
    candidates,
    totalFound: found.length,
    heldByGate: result.state.drafts.filter((d) => !d.gatePassed).length,
    reviewQueueStatus: result.state.drafts.some((d) => d.gatePassed) ? "awaiting_gate" : "empty",
    errors: result.state.errors,
  });
}
