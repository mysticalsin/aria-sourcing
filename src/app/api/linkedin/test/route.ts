import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  linkedInProviderReadiness,
  linkedInSeatCanGoLive,
  summarizeLinkedInValidation,
  type LinkedInValidationCheck,
} from "@/lib/linkedin-connections";
import { linkedInAdapterForProvider } from "@/lib/linkedin-channel";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

export const dynamic = "force-dynamic";

const TestSchema = z.object({
  seatId: z.string().uuid(),
});

/** Validate a LinkedIn messaging seat (no call to linkedin.com). */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({ ok: false, error: "Authentication backend not configured." }, { status: 503 });
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
  if (!can(role as Role, "manage_fleet") && !can(role as Role, "source")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-test", user.id), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, TestSchema, { maxBytes: 2_048 });
  if (!validated.ok) return validated.response;
  const { seatId } = validated.data;

  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL, checks: [] });
  }

  const t0 = Date.now();
  const { data: seat, error } = await supabase
    .from("agent_seats")
    .select("id, name, provider, status, mode, connected_account")
    .eq("id", seatId)
    .eq("workspace_id", wid)
    .maybeSingle();

  if (error || !seat) {
    return NextResponse.json({ ok: false, error: "LinkedIn seat not found." }, { status: 404 });
  }

  const readiness = linkedInProviderReadiness();
  const checks: LinkedInValidationCheck[] = [];

  const canLive = linkedInSeatCanGoLive(seat);
  checks.push({
    id: "seat_provider",
    ok: canLive.ok,
    detail: canLive.ok ? `Provider ${seat.provider}.` : canLive.reason,
  });

  checks.push({
    id: "seat_active",
    ok: seat.status === "active",
    detail: seat.status === "active" ? "Seat is active." : `Seat status is ${seat.status}.`,
  });

  checks.push({
    id: "seat_live",
    ok: seat.mode === "live",
    detail: seat.mode === "live" ? "Seat is live." : "Seat is mock — enable live from Connect.",
  });

  const adapter = linkedInAdapterForProvider(seat.provider);
  checks.push({
    id: "adapter",
    ok: Boolean(adapter?.configured()),
    detail: adapter?.configured()
      ? `Adapter ${adapter.kind} configured.`
      : "Vendor API keys missing (LINKEDIN_VENDOR_*).",
  });

  const { data: route } = await supabase
    .from("linkedin_inbound_routes")
    .select("route_key, active")
    .eq("workspace_id", wid)
    .eq("seat_id", seatId)
    .maybeSingle();

  checks.push({
    id: "inbound_route",
    ok: Boolean(route?.active && route.route_key),
    detail: route?.active
      ? "Inbound route registered (vendor webhook route_key ready)."
      : "No inbound route — reconnect LinkedIn in Settings.",
  });

  checks.push({
    id: "inbound_webhook_secret",
    ok: readiness.inboundWebhookSecret,
    detail: readiness.inboundWebhookSecret
      ? "Inbound webhook secret configured."
      : "Set LINKEDIN_INBOUND_WEBHOOK_SECRET (or EMAIL_INBOUND_WEBHOOK_SECRET).",
  });

  const summary = summarizeLinkedInValidation(checks);
  return NextResponse.json({
    ok: summary.ok,
    latencyMs: Date.now() - t0,
    message: summary.message,
    provider: seat.provider,
    seatName: seat.name,
    checks: summary.checks,
  });
}
