import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { searchGithubUsers, type GithubUser } from "@/lib/sourcing/github";

/**
 * Real candidate sourcing. Searches GitHub for real people matching a query and
 * returns their public profiles. The GitHub token is resolved server-side from the
 * environment and never returned to the client. When no token is configured the
 * route responds `source: "mock"` so the caller falls back to synthetic sourcing —
 * the app stays fully functional in demo mode, and goes live the moment a token is
 * set. Read-only: it never writes to GitHub.
 */
const SourceSchema = z.object({
  query: z.string().min(1).max(256),
  count: z.number().int().min(1).max(20).default(8),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source"), { windowMs: 60_000, max: 10 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  // Live mode: require an authenticated user with the `source` permission. Demo
  // mode (no backend) is open but still rate-limited.
  if (supabaseEnabled) {
    const supabase = getServerSupabase();
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
  const { query, count = 8 } = validated.data;

  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) {
    return NextResponse.json({ ok: true, source: "mock", users: [] as GithubUser[] });
  }

  try {
    const users = await searchGithubUsers(query, count, token);
    return NextResponse.json({ ok: true, source: "github", users });
  } catch (err) {
    // GitHub error bodies never contain the token; keep the client message terse.
    const detail = err instanceof Error ? err.message : "GitHub search failed.";
    return NextResponse.json({ ok: false, source: "github", error: detail }, { status: 502 });
  }
}

/**
 * Real connection test for GitHub sourcing: pings GET /user with the configured
 * token and reports the authenticated identity. Never returns the token. Reports
 * connected:false (not an error) when no token is set, so the UI can say "add a
 * token to go live" rather than showing a failure.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-probe"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  if (supabaseEnabled) {
    const supabase = getServerSupabase();
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
    return NextResponse.json({
      ok: true,
      connected: false,
      reason: "No GITHUB_TOKEN set. Add one to source real candidates from GitHub.",
    });
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "aria-sourcing",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: true, connected: false, reason: `GitHub token rejected (${res.status}).` });
    }
    const u = (await res.json().catch(() => ({}))) as { login?: string; name?: string; public_repos?: number };
    return NextResponse.json({
      ok: true,
      connected: true,
      login: u.login ?? "unknown",
      name: u.name ?? null,
      publicRepos: u.public_repos ?? 0,
    });
  } catch {
    return NextResponse.json({ ok: true, connected: false, reason: "GitHub unreachable." });
  }
}
