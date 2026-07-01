import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Campaign, Candidate, Role, ScoringWeights } from "@/lib/types";
import { DEFAULT_MODEL, PROVIDER_ENV, type AiProviderSlug } from "@/lib/ai/provider";
import { resolveVaultSecret } from "@/lib/ai/vault-secret";
import { runAnthropicWithTools, runOpenAiWithTools, type ResolvedMcpServer } from "@/lib/ai/tool-loop";
import { SOURCING_TOOL_DEFS, makeSourcingToolRunner } from "@/lib/ai/sourcing-tools";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Agentic sourcing: one tool-calling loop that searches real platforms, scores
 * real candidates (deterministic — see sourcing-tools.ts), and drafts outreach
 * for the best matches, instead of the client stitching separate calls one at
 * a time. TEXT + TOOL CALLS ONLY — like /api/hermes/chat, this never sends
 * anything; drafts still go through the same human approval gate as any other
 * outreach message.
 *
 * Only providers with real function-calling get this (no "hermes"/"kimi" — the
 * hermes runtime path and Kimi Code don't support the tools param).
 */
const AGENT_PROVIDERS = ["anthropic", "openai", "groq", "xai", "mistral"] as const;

const SourcingAgentSchema = z.object({
  // Full client-owned objects, passed through — the client already has these
  // in its local state; this route is stateless per-request, same posture as
  // /api/source (which receives a client-built query string rather than
  // looking up campaign data server-side).
  campaign: z.record(z.string(), z.unknown()),
  existing: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  count: z.number().int().min(1).max(8).default(5),
  provider: z.enum(AGENT_PROVIDERS),
  apiKeyId: z.string().uuid().optional(),
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),
});

const SYSTEM_PROMPT =
  "You are Aria's autonomous sourcing agent. You have a search_candidates tool that returns REAL, " +
  "already-scored people found via real platform search — you never invent a candidate, a score, a " +
  "company, or a URL. Call it across the platforms that make sense for this role (skip ones with no " +
  "real fit — e.g. don't search Dribbble for a backend engineer). Call it more than once per platform " +
  "with a different query if the first pass returns too few strong matches. Once you've gathered enough " +
  "real, well-scored candidates, stop calling tools and respond with ONLY this JSON (no prose, no markdown " +
  "fences): {\"drafts\": [{\"candidateId\": \"<id from a tool result>\", \"subject\": \"<email subject>\", " +
  "\"body\": \"<first-touch outreach, under 120 words, leads with their specific real work, one genuine " +
  "reason for reaching out, soft low-pressure ask, no AI slop, no corporate filler, no em-dashes>\"}]}. " +
  "Draft for the requested number of candidates, choosing the best-scored real matches you found. Every " +
  "candidateId MUST be one that a search_candidates result actually returned.";

function buildPrompt(campaign: Campaign, count: number): string {
  const jd = campaign.jobAnalysis;
  return [
    `Role: ${jd.title} (${jd.seniority}, ${jd.department})`,
    `Location: ${jd.locationType}${jd.regions.length ? ` — ${jd.regions.join("/")}` : ""}`,
    `Required skills: ${jd.requiredSkills.join(", ") || "n/a"}`,
    `Nice-to-have: ${jd.niceToHaveSkills.join(", ") || "n/a"}`,
    jd.minYearsExperience != null ? `Minimum experience: ${jd.minYearsExperience} years` : "",
    jd.companyStageTarget.length ? `Target company stage: ${jd.companyStageTarget.join(", ")}` : "",
    jd.industryExperience.length ? `Industry experience: ${jd.industryExperience.join(", ")}` : "",
    "",
    `Find and draft outreach for ${count} real candidates for this role.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Parse the model's final JSON, tolerant of stray text/markdown fences around it. */
function parseDrafts(text: string): { candidateId: string; subject: string; body: string }[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { drafts?: unknown };
    if (!Array.isArray(parsed.drafts)) return [];
    return parsed.drafts
      .filter(
        (d): d is { candidateId: string; subject: string; body: string } =>
          !!d &&
          typeof d === "object" &&
          typeof (d as Record<string, unknown>).candidateId === "string" &&
          typeof (d as Record<string, unknown>).subject === "string" &&
          typeof (d as Record<string, unknown>).body === "string",
      )
      .map((d) => ({ candidateId: d.candidateId, subject: d.subject.slice(0, 255), body: d.body.slice(0, 5_000) }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const supabase = supabaseEnabled ? getServerSupabase() : null;
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
  } else if (demoLoginEnabled) {
    // Same open-demo cost gate as /api/hermes/chat: env-resident provider keys
    // are spendable only by a caller holding a valid demo session.
    if (!demoAuthConfigured() || !verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) {
      return NextResponse.json({ ok: false, reason: "Sign in to use the sourcing agent." }, { status: 401 });
    }
  }

  const rl = checkRateLimit(rateLimitKey(req, "sourcing-agent", userId), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, SourcingAgentSchema, { maxBytes: 200_000 });
  if (!validated.ok) return validated.response;
  const { count = 5, provider, apiKeyId, model } = validated.data;
  const campaign = validated.data.campaign as unknown as Campaign;
  const existing = validated.data.existing as unknown as Candidate[];
  const weights: ScoringWeights = campaign?.scoringWeights;

  if (!campaign?.jobAnalysis || !weights) {
    return NextResponse.json({ ok: false, reason: "Malformed campaign payload." }, { status: 400 });
  }

  const slug = provider as AiProviderSlug;
  const vaultKey = await resolveVaultSecret(apiKeyId);
  const key = vaultKey || process.env[PROVIDER_ENV[slug]] || "";
  if (!key) {
    return NextResponse.json({ ok: false, reason: `No API key configured for ${provider}.` });
  }

  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const runner = makeSourcingToolRunner(campaign, existing, weights, githubToken);
  const servers: ResolvedMcpServer[] = [
    { url: "builtin:sourcing-agent", token: "", tools: SOURCING_TOOL_DEFS, run: runner.run },
  ];

  const toolModel = model || DEFAULT_MODEL[slug];
  const prompt = buildPrompt(campaign, count);
  const result =
    slug === "anthropic"
      ? await runAnthropicWithTools({ model: toolModel, system: SYSTEM_PROMPT, prompt, key, servers, maxRounds: 6 })
      : await runOpenAiWithTools({ provider: slug, model: toolModel, system: SYSTEM_PROMPT, prompt, key, servers, maxRounds: 6 });

  const foundCandidates = runner.getFound();
  if (!result.ok) {
    // Even on a loop failure, return whatever real candidates were actually
    // found before it failed — the search itself is real and useful even
    // without a draft, same "don't throw away real work" posture as the rest
    // of this app's real-sourcing paths.
    return NextResponse.json({
      ok: foundCandidates.length > 0,
      reason: result.reason ?? "Agent loop failed.",
      candidates: foundCandidates.map((c) => ({ ...c, matchScore: c.matchScore })),
    });
  }

  const drafts = parseDrafts(result.text ?? "");
  const byId = new Map(foundCandidates.map((c) => [c.id, c]));
  // Only ever attach a draft to a candidate the tool loop actually surfaced —
  // never trust a candidateId the model invented that wasn't in a real result.
  const candidates = drafts
    .map((d) => {
      const cand = byId.get(d.candidateId);
      if (!cand) return null;
      return { ...cand, draftSubject: d.subject, draftBody: d.body };
    })
    .filter((c): c is Candidate & { draftSubject: string; draftBody: string } => c !== null);

  return NextResponse.json({ ok: true, candidates, totalFound: foundCandidates.length });
}
