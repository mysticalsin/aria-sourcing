import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { DEMO_COOKIE_NAME, demoLoginEnabled, prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { demoAuthConfigured, verifyDemoToken } from "@/lib/demo-auth";
import { aiUsageReport } from "@/lib/ai/usage";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Month-to-date Claude spend for the Settings usage panel: totals, caps and a
 * per task + model breakdown. Aggregates only, never prompts or answers.
 * Admin-only in a live workspace; the open demo requires its signed session.
 */
export async function GET(req: NextRequest) {
  const blocked = prodFailClosed();
  if (blocked) return blocked;
  if (supabaseEnabled) {
    const authority = await requireAdmin(await getServerSupabase());
    if (!authority.ok) return authority.response;
  } else if (demoLoginEnabled && (!demoAuthConfigured() || !verifyDemoToken(req.cookies.get(DEMO_COOKIE_NAME)?.value))) {
    return NextResponse.json({ error: "Sign in to view AI usage." }, { status: 401 });
  }
  const limit = checkRateLimit(rateLimitKey(req, "ai-usage"), { windowMs: 60_000, max: 30 });
  if (!limit.ok) return tooManyRequests(limit.retryAfterSec);
  return NextResponse.json(aiUsageReport(), { headers: { "Cache-Control": "no-store" } });
}
