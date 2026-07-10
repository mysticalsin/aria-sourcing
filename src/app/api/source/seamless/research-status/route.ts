import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { supabaseEnabled, prodFailClosed } from "@/lib/supabase/config";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { pollSeamlessResearch, resolveStoredSeamlessKey } from "@/lib/sourcing/seamless";

/**
 * Poll a Seamless contact-research (reveal) job. While in progress ("queued" /
 * "researching"): {status:"processing"}. On "done": returns the enriched
 * contact (email/phone). Any other terminal Seamless status ("error",
 * "missing", "duplicate", "not found", "contact-already-researched", "No
 * license or credits available") is a real failure — surfaced verbatim so the
 * UI shows the actual reason, never a generic message.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  const rl = checkRateLimit(rateLimitKey(req, "source-seamless-research-status"), { windowMs: 60_000, max: 30 });
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

  const requestId = new URL(req.url).searchParams.get("requestId");
  if (!requestId) return NextResponse.json({ ok: false, error: "requestId is required." }, { status: 400 });

  const apiKey = session ? await resolveStoredSeamlessKey(session) : null;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Connect a Seamless key in Settings first." });
  }

  const res = await pollSeamlessResearch(apiKey, requestId);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, status: res.status, error: res.detail || res.title },
      { status: res.status || 502 },
    );
  }

  const { status, message, contact } = res.data;
  if (status === "queued" || status === "researching") {
    return NextResponse.json({ ok: true, status: "processing" });
  }
  if (status === "done" && contact) {
    return NextResponse.json({ ok: true, status: "completed", contact });
  }
  // Any other terminal status is a real failure — surface Seamless's own message.
  return NextResponse.json({
    ok: false,
    status: "failed",
    error: message || `Seamless research did not complete (status: ${status || "unknown"}).`,
  });
}
