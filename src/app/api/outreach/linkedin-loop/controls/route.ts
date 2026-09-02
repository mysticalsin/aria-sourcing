import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { safeLog } from "@/lib/log-redact";

/**
 * Workspace kill switch for the LinkedIn reply loop. GET reads the switch;
 * POST flips sourcing_loop_controls.linkedin_reply_loop_enabled (admins only,
 * 0055 set_linkedin_reply_loop_enabled). Off is the default and the safe
 * state: nothing auto-sends while it is off, whatever grants exist.
 */
const ControlsSchema = z.object({
  enabled: z.boolean(),
  /** When turning off, also revoke every launch grant in the workspace. */
  revokeAll: z.boolean().default(false),
});

const OFF = { ok: true, killSwitch: true, enabled: false, persisted: false };

export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return NextResponse.json(OFF);
  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json(OFF);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { data, error } = await supabase.rpc("read_linkedin_reply_loop_controls");
  const row = (data ?? null) as { kill_switch?: boolean; enabled?: boolean } | null;
  if (error || !row) return NextResponse.json({ ...OFF, persisted: true });
  return NextResponse.json({ ok: true, killSwitch: row.kill_switch !== false, enabled: row.enabled === true, persisted: true });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-loop-controls"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, ControlsSchema, { maxBytes: 2_000 });
  if (!validated.ok) return validated.response;
  if (!supabaseEnabled) return NextResponse.json(OFF);

  const supabase = await getServerSupabase();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;
  if (!supabase) return NextResponse.json(OFF);

  const { data, error } = await supabase.rpc("set_linkedin_reply_loop_enabled", { p_enabled: validated.data.enabled });
  const result = (data ?? null) as { ok?: boolean; reason?: string } | null;
  if (error || result?.ok !== true) {
    safeLog("linkedin loop controls refused", { message: error?.message ?? result?.reason ?? "unknown" });
    return NextResponse.json({ ok: false, error: result?.reason ?? "controls-update-failed" }, { status: 400 });
  }
  let revoked = 0;
  if (!validated.data.enabled && validated.data.revokeAll) {
    const { data: revokeData, error: revokeErr } = await supabase.rpc("revoke_linkedin_reply_loop", {
      p_grant_id: null,
      p_reason: "kill switch",
    });
    const revokeResult = (revokeData ?? null) as { ok?: boolean; revoked?: number } | null;
    if (revokeErr || revokeResult?.ok !== true) {
      safeLog("linkedin loop kill revoke failed", { message: revokeErr?.message ?? "unknown" });
      return NextResponse.json({ ok: false, error: "loop-disabled-but-grants-not-revoked" }, { status: 500 });
    }
    revoked = revokeResult.revoked ?? 0;
  }
  return NextResponse.json({ ok: true, enabled: validated.data.enabled, revoked, persisted: true });
}
