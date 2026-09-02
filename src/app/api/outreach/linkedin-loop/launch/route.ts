import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";

/**
 * Campaign launch: the ONE human tap that lets the LinkedIn reply loop answer
 * on its own. POST records a launch grant (0055 launch_linkedin_reply_loop),
 * DELETE revokes one grant or every grant in the workspace (the per-campaign
 * kill), GET lists the workspace's grants. Without a live grant no inbound is
 * ever answered automatically.
 */
const LaunchSchema = z.object({
  campaignId: z.string().min(1).max(120),
  vendorCampaignId: z.string().max(200).optional(),
  seatId: z.string().uuid(),
  calendarSeatId: z.string().uuid().optional(),
  interviewerEmail: z.string().email().max(255).optional().or(z.literal("")),
  roleTitle: z.string().max(160).optional(),
  dailyCap: z.number().int().min(0).max(200).default(20),
  quietStart: z.number().int().min(0).max(23).default(21),
  quietEnd: z.number().int().min(0).max(23).default(8),
  timezone: z.string().min(1).max(64).default("UTC"),
});

const RevokeSchema = z.object({
  grantId: z.string().uuid().optional(),
  reason: z.string().max(200).optional(),
});

const DRY_RUN = { ok: true, status: "dry-run", persisted: false, detail: "Demo: no launch grant recorded, the loop stays off." };

async function authorize(perm: "outreach") {
  const supabase = await getServerSupabase();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 }) };
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, perm)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 }) };
  }
  return { ok: true as const, supabase };
}

export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return NextResponse.json({ ok: true, grants: [] });
  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from("linkedin_reply_grants")
    .select("id, channel, campaign_id, vendor_campaign_id, seat_id, calendar_seat_id, daily_cap, quiet_start, quiet_end, timezone, granted_at, revoked_at")
    .order("granted_at", { ascending: false })
    .limit(100);
  if (error) {
    safeLog("linkedin loop grants list error", { message: error.message });
    return NextResponse.json({ ok: false, error: "Could not read launch grants." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, grants: data ?? [] });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-loop-launch"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, LaunchSchema, { maxBytes: 10_000 });
  if (!validated.ok) return validated.response;
  const d = validated.data;
  if (!supabaseEnabled) return NextResponse.json(DRY_RUN);

  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc("launch_linkedin_reply_loop", {
    p_campaign_id: d.campaignId,
    p_vendor_campaign_id: d.vendorCampaignId ?? null,
    p_seat_id: d.seatId,
    p_calendar_seat_id: d.calendarSeatId ?? null,
    p_interviewer_email: d.interviewerEmail ?? "",
    p_role_title: d.roleTitle ?? "",
    p_daily_cap: d.dailyCap,
    p_quiet_start: d.quietStart,
    p_quiet_end: d.quietEnd,
    p_timezone: d.timezone,
  });
  const result = (data ?? null) as { ok?: boolean; reason?: string; grant_id?: string } | null;
  if (error || result?.ok !== true) {
    safeLog("linkedin loop launch refused", { message: error?.message ?? result?.reason ?? "unknown" });
    const reason = result?.reason ?? "launch-failed";
    const status = reason === "already-launched" ? 409 : reason === "insufficient-permissions" ? 403 : 400;
    return NextResponse.json({ ok: false, error: reason }, { status });
  }
  return NextResponse.json({ ok: true, status: "launched", persisted: true, grantId: result.grant_id });
}

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-loop-revoke"), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, RevokeSchema, { maxBytes: 5_000 });
  if (!validated.ok) return validated.response;
  if (!supabaseEnabled) return NextResponse.json(DRY_RUN);

  const auth = await authorize("outreach");
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase.rpc("revoke_linkedin_reply_loop", {
    p_grant_id: validated.data.grantId ?? null,
    p_reason: validated.data.reason ?? null,
  });
  const result = (data ?? null) as { ok?: boolean; reason?: string; revoked?: number } | null;
  if (error || result?.ok !== true) {
    safeLog("linkedin loop revoke refused", { message: error?.message ?? result?.reason ?? "unknown" });
    return NextResponse.json({ ok: false, error: result?.reason ?? "revoke-failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: "revoked", persisted: true, revoked: result.revoked ?? 0 });
}
