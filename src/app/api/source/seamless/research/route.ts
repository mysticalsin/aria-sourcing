import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { startSeamlessResearch, resolveStoredSeamlessKey } from "@/lib/sourcing/seamless";

/**
 * Kick off async contact-detail research for one Seamless search result — the
 * explicit, per-candidate reveal step (mirrors Apollo's single-person enrich,
 * but Seamless's reveal is async: this only starts the job, poll
 * /api/source/seamless/research-status for the result). Deliberately separate
 * from /api/source/seamless/search so the UI can only ever fire this on an
 * explicit, confirmed action — never automatically for a whole search batch.
 */
const SeamlessResearchSchema = z.object({
  searchResultId: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-seamless-research"), { windowMs: 60_000, max: 15 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let session: Awaited<ReturnType<typeof getServerSupabase>> = null;
  if (supabaseEnabled) {
    session = await getServerSupabase();
    if (!session) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const { data: role } = await session.rpc("current_profile_role");
    if (!can(role as Role, "source")) {
      return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
    }
  }

  const validated = await validateBody(req, SeamlessResearchSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  const { searchResultId } = validated.data;

  const apiKey = session ? await resolveStoredSeamlessKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect a Seamless key in Settings first." });
  }

  const result = await startSeamlessResearch(apiKey, searchResultId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, status: result.status, error: result.detail || result.title },
      { status: result.status || 502 },
    );
  }
  return NextResponse.json({ ok: true, requestId: result.data.requestId });
}
