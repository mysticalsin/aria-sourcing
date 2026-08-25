import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { normalizeLinkedInProfileUrl } from "@/lib/linkedin-connections";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

const ConfirmSchema = z.object({
  messageId: z.string().min(1).max(120),
  candidateId: z.string().min(1).max(120),
  candidateProfileUrl: z.string().min(8).max(500),
  campaignId: z.string().min(1).max(120),
  seatId: z.string().uuid(),
});

/**
 * Durable confirmation that an operator pasted/sent a LinkedIn draft outside Aria.
 * Writes outreach_ledger via record_linkedin_assisted_manual_send (migration 0058).
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: true, synced: false, detail: "Demo mode: local confirm only." });
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
  if (!can(role as Role, "outreach") && !can(role as Role, "manage_fleet")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-confirm-manual", user.id), {
    windowMs: 60_000,
    max: 40,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, ConfirmSchema, { maxBytes: 4_096 });
  if (!validated.ok) return validated.response;
  const body = validated.data;

  const profile = normalizeLinkedInProfileUrl(body.candidateProfileUrl);
  if (!profile) {
    return NextResponse.json({ ok: false, error: "Invalid LinkedIn profile URL." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({
      ok: true,
      status: "dry-run",
      changed: false,
      detail: PUBLIC_DEMO_DRY_RUN_DETAIL,
    });
  }

  const { data, error } = await supabase.rpc("record_linkedin_assisted_manual_send", {
    p_message_id: body.messageId,
    p_candidate_id: body.candidateId,
    p_candidate_profile: profile,
    p_campaign_id: body.campaignId,
    p_seat_id: body.seatId,
  });

  if (error) {
    safeLog("confirm-manual LinkedIn RPC error", { message: error.message, code: error.code });
    return NextResponse.json(
      { ok: false, error: "Could not record LinkedIn send. Apply migration 0058." },
      { status: 500 },
    );
  }

  const result = data as { ok?: boolean; reason?: string; duplicate?: boolean; ledger_id?: string } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { ok: false, error: result?.reason ?? "Confirm refused." },
      { status: result?.reason === "suppressed" ? 409 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    synced: true,
    duplicate: Boolean(result.duplicate),
    ledgerId: result.ledger_id ?? null,
  });
}
