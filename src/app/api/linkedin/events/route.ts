import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * List recent LinkedIn channel events for the LinkedIn inbox (HeyReach-parity).
 * Member-readable via RLS on linkedin_channel_events.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      events: [],
      detail: "Live LinkedIn inbox requires Supabase.",
    });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "manage_fleet") && !can(role as Role, "source") && !can(role as Role, "reply")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-events-get", user.id), {
    windowMs: 60_000,
    max: 60,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : 40;

  const { data, error } = await supabase
    .from("linkedin_channel_events")
    .select(
      "id, event_id, event_type, profile_url, body, candidate_id, inbound_id, conversation_id, occurred_at, created_at, payload",
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
  }

  return NextResponse.json({ ok: true, events: data ?? [] });
}
