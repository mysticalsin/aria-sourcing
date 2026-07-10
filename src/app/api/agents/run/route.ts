import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Campaign, Candidate, Role, ScoringWeights } from "@/lib/types";
import { DEFAULT_MODEL, PROVIDER_ENV, buildCloudRequest, parseCloudResponse, type AiProviderSlug } from "@/lib/ai/provider";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { makeSourcingToolRunner } from "@/lib/ai/sourcing-tools";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { initialState, runGraph, type CandidateLite, type GraphDeps } from "@/lib/agents/graph";
import { resolveStoredTavilyKey } from "@/lib/sourcing/tavily";

export const dynamic = "force-dynamic";

/**
 * On-demand sourcing agent run — the deer-flow-style graph
 * (planner → sourcer → screener → outreach → reporter) over the same real
 * search + deterministic scoring the single-shot /api/sourcing-agent uses.
 *
 * Same posture as that route: TEXT + SEARCH ONLY — this never sends anything;
 * gate-passing drafts still require the human approval gate (or gated
 * autopilot's system approval) before /api/outreach/send will touch the wire.
 *
 * With Supabase configured, every node persists to agent_runs (resumable) and
 * narrates to agent_events (append-only, no send path). In demo mode the run
 * executes statelessly and just returns its result.
 */
const AGENT_PROVIDERS = ["anthropic", "openai", "groq", "xai", "mistral"] as const;

const AgentRunSchema = z.object({
  campaign: z.record(z.string(), z.unknown()),
  existing: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  count: z.number().int().min(1).max(8).default(5),
  provider: z.enum(AGENT_PROVIDERS),
  apiKeyId: z.string().uuid().optional(),
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),
  specId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const supabase = supabaseEnabled ? await getServerSupabase() : null;
  let workspaceId: string | null = null;
  let userId: string | null = null;
  if (supabaseEnabled) {
    if (!supabase) return NextResponse.json({ ok: false, reason: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, reason: "Not authenticated." }, { status: 401 });
    userId = user.id;
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, reason: "Insufficient permissions." }, { status: 403 });
    }
    const { data: wid } = await supabase.rpc("current_workspace_id");
    workspaceId = (wid as string) ?? null;
  } else if (demoLoginEnabled) {
    if (!demoAuthConfigured() || !verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) {
      return NextResponse.json({ ok: false, reason: "Sign in to run agents." }, { status: 401 });
    }
  }

  const rl = checkRateLimit(rateLimitKey(req, "agents-run", userId), { windowMs: 60_000, max: 6 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, AgentRunSchema, { maxBytes: 200_000 });
  if (!validated.ok) return validated.response;
  const { count = 5, provider, apiKeyId, model, specId } = validated.data;
  const campaign = validated.data.campaign as unknown as Campaign;
  const existing = validated.data.existing as unknown as Candidate[];
  const weights: ScoringWeights = campaign?.scoringWeights;
  if (!campaign?.jobAnalysis || !weights) {
    return NextResponse.json({ ok: false, reason: "Malformed campaign payload." }, { status: 400 });
  }

  const slug = provider as AiProviderSlug;
  const vaultKey = await resolveVaultSecret(apiKeyId);
  const key = vaultKey || process.env[PROVIDER_ENV[slug]] || "";
  if (!key) return NextResponse.json({ ok: false, reason: `No API key configured for ${provider}.` });
  const llmModel = model || DEFAULT_MODEL[slug];

  const tavilyKey = supabase ? await resolveStoredTavilyKey(supabase) : null;
  const runner = makeSourcingToolRunner(campaign, existing, weights, process.env.GITHUB_TOKEN ?? "", tavilyKey ?? undefined);
  const deps: GraphDeps = {
    async generate(system, prompt) {
      const reqSpec = buildCloudRequest(slug, llmModel, system, prompt, key, 1024);
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

  // Persistent run row (when the backend exists) — resumable + auditable.
  let runId: string | null = null;
  if (supabase && workspaceId) {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({ spec_id: specId ?? null, workspace_id: workspaceId, state_json: {}, node: "planner" })
      .select("id")
      .maybeSingle();
    runId = run?.id ?? null;
  }

  // stepGraph applies candidateDisclosureContextForCampaignLike before any
  // candidate-facing model prompt; the raw brief remains server-side for sink scans.
  const state = initialState(campaign.jobAnalysis as unknown as Record<string, unknown>, count);
  const result = await runGraph(state, deps, async (node, s, event) => {
    if (!supabase || !workspaceId || !runId) return;
    await supabase
      .from("agent_runs")
      .update({
        node,
        state_json: s as unknown as Record<string, unknown>,
        step_count: s.drafts.length + s.planCursor,
        status: node === "done" ? "done" : "running",
        ...(node === "done" ? { finished_at: new Date().toISOString() } : {}),
      })
      .eq("id", runId);
    await supabase
      .from("agent_events")
      .insert({ run_id: runId, workspace_id: workspaceId, type: event.type, payload: event.payload });
  });

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
    errors: result.state.errors,
  });
}
