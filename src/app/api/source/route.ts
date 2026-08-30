import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed, demoLoginEnabled, DEMO_COOKIE_NAME } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { validateBody } from "@/lib/api/validate";
import { requestSameOrigin } from "@/lib/api/same-origin-json";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import {
  GITHUB_USERNAME_RE,
  getGithubAuthenticatedUser,
  getGithubRateLimit,
  searchGithubUsers,
  getGithubUser,
  type GithubUser,
} from "@/lib/sourcing/github";
import { SOURCE_PLATFORMS } from "@/lib/types";
import { ensureWebQueryScope, isWebSearchPlatform, extractLead, type WebLead } from "@/lib/sourcing/web-leads";
import { runWebTool } from "@/lib/ai/web-tools";
import { buildSeedState } from "@/lib/seed";
import { clearDiscoveryCriteria, clearIdentityResolution, clearProviderProbe } from "@/lib/sourcing/provider-egress";
import { validateSourcingQuery } from "@/lib/sourcing/query-policy";

export const runtime = "nodejs";

/**
 * Real candidate sourcing.
 *
 * platform "GitHub" (default): searches GitHub for real people via the Users
 * Search API. Runs keyless by default (GitHub's anonymous API quota, 60
 * req/hour/IP) — no signup required. An optional GITHUB_TOKEN, resolved
 * server-side and never returned to the client, raises that ceiling to 5,000
 * req/hour.
 *
 * platform in {LinkedIn, Stack Overflow, Dribbble, Behance}: no free structured
 * search API exists for these, so real candidates are discovered via the
 * existing compliant web_search tool (site:-scoped), same honesty/read-only
 * guarantees as the chat research tools.
 *
 * platform in {Manual, Referral, Talent Pool}: not externally sourceable.
 *
 * Read-only throughout: never writes to GitHub, never logs into or scrapes a
 * platform, never posts a message.
 *
 * `username` (optional): manual single-profile intake. When present, `query`
 * is ignored entirely and the request resolves that one GitHub login via
 * GET /users/{login} instead of running a search.
 */
const SourceSchema = z
  .object({
    query: z.string().min(1).max(256).optional(),
    username: z.string().min(1).max(39).regex(GITHUB_USERNAME_RE, "Not a valid GitHub username.").optional(),
    count: z.number().int().min(1).max(20).default(8),
    platform: z.enum(SOURCE_PLATFORMS).default("GitHub"),
  })
  .refine((data) => Boolean(data.username?.trim()) || Boolean(data.query?.trim()), {
    message: "query or username is required.",
    path: ["query"],
  });

function publicDemoSourceDenied(req: NextRequest): Response | null {
  if (supabaseEnabled || !demoLoginEnabled) return null;
  if (demoAuthConfigured() && verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value)) return null;
  return NextResponse.json({ ok: false, error: "Sign in to use live sourcing." }, { status: 401 });
}

function liveOriginDenied(req: NextRequest): Response | null {
  if (!supabaseEnabled) return null;
  if (requestSameOrigin(req)) return null;
  return NextResponse.json(
    { ok: false, code: "CROSS_ORIGIN_REQUEST", error: "Cross-origin sourcing is not allowed." },
    { status: 403 },
  );
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const demoBlock = publicDemoSourceDenied(req);
  if (demoBlock) return demoBlock;
  const originBlock = liveOriginDenied(req);
  if (originBlock) return originBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // Live mode: require an authenticated user with the `source` permission. Demo
  // mode (no backend) is open but still rate-limited.
  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, SourceSchema, { maxBytes: 10_000 });
  if (!validated.ok) return validated.response;
  const { query, username, count = 8, platform = "GitHub" as const } = validated.data;

  // Manual single-profile intake: resolve exactly the named GitHub login,
  // ignoring `query` and `count` entirely — this is a lookup, not a search.
  if (username) {
    if (platform !== "GitHub") {
      return NextResponse.json(
        { ok: false, error: "GitHub username lookup requires the GitHub platform." },
        { status: 400 },
      );
    }
    const token = process.env.GITHUB_TOKEN ?? "";
    const clearance = clearIdentityResolution("GitHub", { username });
    if (!clearance.ok) return NextResponse.json({ ok: false, error: clearance.error }, { status: 422 });
    try {
      const user = await getGithubUser(clearance.clearance, username, token);
      if (!user) {
        return NextResponse.json({ ok: false, error: "GitHub user not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, source: "github", users: [user] });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "GitHub lookup failed.";
      return NextResponse.json({ ok: false, source: "github", error: detail }, { status: 502 });
    }
  }

  // Live campaign search is intentionally available only through the canonical
  // server-owned campaign route. This endpoint retains exact-profile intake and
  // the explicitly signed demo search path; it cannot bypass campaign readiness,
  // idempotency, learning receipts, or configuration authority in a live tenant.
  if (supabaseEnabled) {
    return NextResponse.json(
      {
        ok: false,
        code: "CAMPAIGN_AUTHORITY_REQUIRED",
        error: "Live search must use the reviewed campaign sourcing authority.",
      },
      { status: 409 },
    );
  }

  // Schema-enforced: username or query is present; username was handled above.
  if (!query) return NextResponse.json({ ok: false, error: "query is required." }, { status: 400 });

  if (platform === "Manual") {
    return NextResponse.json(
      { ok: false, source: "manual", error: "Manual intake must use the candidate intake action." },
      { status: 400 },
    );
  }

  const demoCampaign = buildSeedState().campaigns[0];

  if (platform === "GitHub") {
    const policy = clearDiscoveryCriteria(platform, { query }, demoCampaign);
    if (!policy.ok) return NextResponse.json({ ok: false, error: policy.error }, { status: 422 });
    const token = process.env.GITHUB_TOKEN ?? "";
    try {
      const users = await searchGithubUsers(policy.clearance, query, count, token);
      return NextResponse.json({ ok: true, source: "github", platform, users });
    } catch (err) {
      // GitHub error bodies never contain the token; keep the client message terse.
      const detail = err instanceof Error ? err.message : "GitHub search failed.";
      return NextResponse.json({ ok: false, source: "github", platform, error: detail }, { status: 502 });
    }
  }

  if (isWebSearchPlatform(platform)) {
    const webPolicy = validateSourcingQuery(platform, query, demoCampaign);
    if (!webPolicy.ok) return NextResponse.json({ ok: false, error: webPolicy.error }, { status: 422 });
    const scopedQuery = ensureWebQueryScope(platform, query);
    const result = await runWebTool("web_search", { query: scopedQuery });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, source: "web", platform, error: result.error ?? "Web search failed." },
        { status: 502 },
      );
    }
    const content = result.content as { results?: { title: string; url: string; snippet: string }[] } | undefined;
    const hits = (content?.results ?? []).slice(0, count);
    const leads: WebLead[] = hits.map((h) => extractLead(h, platform));
    return NextResponse.json({ ok: true, source: "web", platform, leads });
  }

  // Referral / Talent Pool: internal-pipeline concepts, no external source to search.
  return NextResponse.json({ ok: true, source: "mock", platform, users: [] as GithubUser[] });
}

/**
 * Real connection test for GitHub sourcing. With a token: pings GET /user and
 * reports the authenticated identity. Without one: pings the keyless GET
 * /rate_limit endpoint (works anonymously) and reports the live 60 req/hour
 * quota, so the UI shows real connectivity rather than "add a token to go live" —
 * a token is an optional upgrade, not a requirement. Never returns the token.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const demoBlock = publicDemoSourceDenied(req);
  if (demoBlock) return demoBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-probe"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  if (supabaseEnabled) {
    const supabase = await getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await supabase.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const token = process.env.GITHUB_TOKEN ?? "";

  if (!token) {
    try {
      const res = await getGithubRateLimit(clearProviderProbe("GitHub"));
      if (!res.ok) {
        return NextResponse.json({ ok: true, connected: false, reason: `GitHub unreachable (${res.status}).` });
      }
      const body = (await res.json().catch(() => ({}))) as {
        resources?: { search?: { remaining?: number; limit?: number } };
      };
      const search = body.resources?.search;
      return NextResponse.json({
        ok: true,
        connected: true,
        login: null,
        name: null,
        anonymous: true,
        rateLimitRemaining: search?.remaining ?? null,
        rateLimitTotal: search?.limit ?? null,
        reason: "Sourcing anonymously (60 req/hour). Add GITHUB_TOKEN for a higher ceiling (5,000 req/hour).",
      });
    } catch {
      return NextResponse.json({ ok: true, connected: false, reason: "GitHub unreachable." });
    }
  }

  try {
    const res = await getGithubAuthenticatedUser(clearProviderProbe("GitHub"), token);
    if (!res.ok) {
      return NextResponse.json({ ok: true, connected: false, reason: `GitHub token rejected (${res.status}).` });
    }
    const u = (await res.json().catch(() => ({}))) as {
      login?: string;
      name?: string;
      public_repos?: number;
    };
    return NextResponse.json({
      ok: true,
      connected: true,
      login: u.login ?? "unknown",
      name: u.name ?? null,
      anonymous: false,
      publicRepos: u.public_repos ?? 0,
    });
  } catch {
    return NextResponse.json({ ok: true, connected: false, reason: "GitHub unreachable." });
  }
}
