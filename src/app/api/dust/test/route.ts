import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { listDustAgents } from "@/lib/dust/client";

// Auth-gated, never cacheable — without this Next tries to prerender the route at
// build time (calling requireAdmin() before it touches any request API Next would
// otherwise auto-detect as dynamic), which throws the production fail-closed guard
// as a build error when Supabase isn't configured. (Same fix already applied to
// /auth/google and /auth/microsoft.)
export const dynamic = "force-dynamic";

const DustTestSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(2000),
});

/**
 * Test a just-entered Dust workspace id + API key by listing the workspace's
 * agent configurations. Never persists anything and never echoes the API key
 * back — the Settings "Configure" modal saves the key to the vault separately
 * (via the existing /api/keys route) only after this succeeds.
 */
export async function POST(req: NextRequest) {
  // Fail closed in production (middleware doesn't cover /api/*).
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  // Auth-first: resolve and authorise the caller BEFORE parsing the body or
  // spending a call against the caller's Dust workspace.
  if (supabaseEnabled) {
    const supabase = getServerSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const admin = await requireAdmin(supabase);
    if (!admin.ok) return admin.response;
  }

  // Throttle: this calls out to a third-party API with a shared daily quota.
  const limit = checkRateLimit(rateLimitKey(req, "dust-test"), { windowMs: 60_000, max: 10 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);

  const validated = await validateBody(req, DustTestSchema, { maxBytes: 4_000 });
  if (!validated.ok) return validated.response;
  const { workspaceId, apiKey } = validated.data;

  try {
    const agents = await listDustAgents(workspaceId, apiKey);
    return NextResponse.json({ ok: true, agents });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Failed to connect to Dust.";
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }
}
