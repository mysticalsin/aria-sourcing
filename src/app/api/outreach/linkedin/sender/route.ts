import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { linkedInSendingEnabled } from "@/lib/server/linkedin-sender";
import { LINKEDIN_VENDOR_PROVIDER } from "@/lib/linkedin-channel";
import { safeLog } from "@/lib/log-redact";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The LinkedIn sender behind the Connect LinkedIn card (S4).
 *
 * GET answers one question the browser cannot answer for itself: is LinkedIn
 * sending enabled on this deployment? True only when the delivery adapter has
 * its endpoint and key and the LinkedIn sign-in app is registered. The answer
 * carries no seat data and no secret. Without it the card shows "not enabled".
 *
 * DELETE disconnects the seat: clears the signed-in account and the sender
 * ref and sets provider_state back to 'disconnected', so every claim holds
 * from the next dispatch on. Fleet managers only. Nothing here can set
 * 'connected'; that is the sender attach, which needs the vendor probe (S0).
 */
const NOT_ENABLED = { ok: true, enabled: false };

export async function GET() {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  if (!supabaseEnabled) return NextResponse.json(NOT_ENABLED);
  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json(NOT_ENABLED);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  return NextResponse.json({ ok: true, enabled: linkedInSendingEnabled() });
}

const DisconnectSchema = z.object({ seatId: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;
  const rl = checkRateLimit(rateLimitKey(req, "linkedin-sender-disconnect"), { windowMs: 60_000, max: 30 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const validated = await validateBody(req, DisconnectSchema, { maxBytes: 1_000 });
  if (!validated.ok) return validated.response;
  if (!supabaseEnabled) return NextResponse.json({ ok: true, demo: true, changed: false });

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "manage_fleet")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }
  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", changed: false, detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  // RLS scopes the update to the caller's workspace; the provider filter keeps
  // this route away from mailbox seats, which have their own disconnect.
  const { data, error } = await supabase
    .from("agent_seats")
    .update({ connected_account: "", provider_sender_ref: null, provider_state: "disconnected" })
    .eq("id", validated.data.seatId)
    .eq("provider", LINKEDIN_VENDOR_PROVIDER)
    .select("id");
  if (error) {
    safeLog("linkedin sender disconnect error", { message: error.message, code: error.code });
    return NextResponse.json({ ok: false, error: "Could not disconnect LinkedIn." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: Array.isArray(data) && data.length > 0 });
}
