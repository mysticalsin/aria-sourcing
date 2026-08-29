import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  defaultLinkedInSeatName,
  isLinkedInSeatProvider,
  linkedInProviderReadiness,
  linkedInSeatCanGoLive,
  pickLinkedInSeat,
  type LinkedInSeatProvider,
} from "@/lib/linkedin-connections";
import { AGENT_SEAT_SELECT, type AgentSeatRow } from "@/lib/fleet-seats";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase, requireAdmin } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { safeLog } from "@/lib/log-redact";
import { linkedInAdapterForProvider } from "@/lib/linkedin-channel";

export const dynamic = "force-dynamic";

const EnsureSchema = z.object({
  action: z.literal("ensure_connect"),
  provider: z.enum(["LinkedIn Assisted Manual", "LinkedIn Vendor API", "HeyReach"]).default("LinkedIn Assisted Manual"),
  operatorLabel: z.string().max(200).optional(),
  goLive: z.boolean().optional().default(true),
});

const EnsureOAuthSchema = z.object({
  action: z.literal("ensure_oauth"),
  goLive: z.boolean().optional().default(true),
});

const BodySchema = z.discriminatedUnion("action", [EnsureSchema, EnsureOAuthSchema]);

/**
 * List LinkedIn messaging seats + readiness. POST ensure_connect creates/picks
 * an assisted-manual (or vendor) seat, registers inbound route_key, optionally goes live.
 * Never asks for LinkedIn passwords or cookies.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      providers: linkedInProviderReadiness(),
      seats: [],
      detail: "Live LinkedIn messaging seats require Supabase.",
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
  if (!can(role as Role, "manage_fleet") && !can(role as Role, "source")) {
    return NextResponse.json({ ok: false, error: "Insufficient permissions." }, { status: 403 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-connections-get", user.id), {
    windowMs: 60_000,
    max: 60,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  const { data: seatRows, error: seatErr } = await supabase
    .from("agent_seats")
    .select(AGENT_SEAT_SELECT)
    .eq("workspace_id", wid)
    .order("created_at", { ascending: true });
  if (seatErr) {
    safeLog("linkedin-connections seats error", { message: seatErr.message, code: seatErr.code });
    return NextResponse.json({ ok: false, error: "Failed to load seats." }, { status: 500 });
  }

  const seats = ((seatRows ?? []) as AgentSeatRow[]).filter((s) => isLinkedInSeatProvider(s.provider));

  const { data: routes } = await supabase
    .from("linkedin_inbound_routes")
    .select("seat_id, route_key, operator_label, active")
    .eq("workspace_id", wid);

  const routeBySeat = new Map(
    ((routes ?? []) as { seat_id: string; route_key: string; operator_label: string; active: boolean }[]).map(
      (r) => [r.seat_id, r],
    ),
  );

  const { data: oauthRows } = await supabase
    .from("linkedin_oauth_connections")
    .select("id, seat_id, linkedin_sub, display_name, email, picture_url, scope, connected_at, updated_at, expires_at")
    .eq("workspace_id", wid);

  const oauthBySeat = new Map(
    (
      (oauthRows ?? []) as {
        id: string;
        seat_id: string;
        linkedin_sub: string;
        display_name: string;
        email: string | null;
        picture_url: string | null;
        scope: string;
        connected_at: string;
        updated_at: string;
        expires_at: string | null;
      }[]
    ).map((o) => [o.seat_id, o]),
  );

  return NextResponse.json({
    ok: true,
    providers: linkedInProviderReadiness(),
    oauthConnections: Array.from(oauthBySeat.values()).map((o) => ({
      id: o.id,
      seatId: o.seat_id,
      linkedinSub: o.linkedin_sub,
      displayName: o.display_name,
      email: o.email,
      pictureUrl: o.picture_url,
      scope: o.scope,
      connectedAt: o.connected_at,
      updatedAt: o.updated_at,
      expiresAt: o.expires_at,
    })),
    seats: seats.map((s) => {
      const route = routeBySeat.get(s.id);
      const adapter = linkedInAdapterForProvider(s.provider);
      const oauth = oauthBySeat.get(s.id);
      return {
        id: s.id,
        name: s.name,
        provider: s.provider,
        status: s.status,
        mode: s.mode,
        operatorEmail: s.operator_email,
        connectedAccount: s.connected_account || null,
        adapterConfigured: adapter?.configured() ?? false,
        oauthConnected: Boolean(oauth),
        oauthProfile: oauth
          ? {
              displayName: oauth.display_name,
              email: oauth.email,
              pictureUrl: oauth.picture_url,
              connectedAt: oauth.connected_at,
            }
          : null,
        inboundRoute: route
          ? { routeKey: route.route_key, operatorLabel: route.operator_label, active: route.active }
          : null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      status: "dry-run",
      detail: "Demo mode: local LinkedIn seat only — Supabase required for durable route_key.",
      demo: true,
    });
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "No Supabase client." }, { status: 500 });
  }

  const admin = await requireAdmin(supabase);
  if (!admin.ok) return admin.response;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-connections-post", user.id), {
    windowMs: 60_000,
    max: 30,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, BodySchema, { maxBytes: 4_096 });
  if (!validated.ok) return validated.response;
  const body = validated.data;

  const { data: wid } = await supabase.rpc("ensure_workspace");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Could not resolve workspace." }, { status: 403 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({ ok: true, status: "dry-run", detail: PUBLIC_DEMO_DRY_RUN_DETAIL });
  }

  if (body.action === "ensure_oauth") {
    const readiness = linkedInProviderReadiness();
    if (!readiness.oauthConfigured) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET from the LinkedIn Developer Portal (Sign In with LinkedIn using OpenID Connect).",
        },
        { status: 503 },
      );
    }
    if (!readiness.encryptionReady) {
      return NextResponse.json(
        { ok: false, error: "DATA_ENCRYPTION_KEY is required before storing LinkedIn tokens." },
        { status: 503 },
      );
    }
    const ensured = await ensureConnect(
      supabase,
      wid as string,
      "LinkedIn Assisted Manual",
      user.email || "operator@aria.local",
      body.goLive !== false,
    );
    const payload = await ensured.json().catch(() => null);
    if (!ensured.ok || !payload?.ok || !payload.seatId) {
      return ensured;
    }
    return NextResponse.json({
      ok: true,
      seatId: payload.seatId,
      authorizeUrl: `/auth/linkedin?seat_id=${encodeURIComponent(payload.seatId)}`,
      detail: "Redirecting to LinkedIn Sign In…",
    });
  }

  return ensureConnect(
    supabase,
    wid as string,
    body.provider ?? "LinkedIn Assisted Manual",
    body.operatorLabel?.trim() || user.email || "operator@aria.local",
    body.goLive !== false,
  );
}

async function ensureConnect(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  workspaceId: string,
  provider: LinkedInSeatProvider,
  operatorLabel: string,
  goLive: boolean,
) {
  const readiness = linkedInProviderReadiness();
  if (provider === "LinkedIn Vendor API" && !readiness.vendorApiConfigured) {
    return NextResponse.json(
      {
        ok: false,
        error: "LINKEDIN_VENDOR_API_URL / LINKEDIN_VENDOR_API_KEY are not configured.",
      },
      { status: 503 },
    );
  }
  if (provider === "HeyReach" && !readiness.heyReachConfigured) {
    return NextResponse.json(
      {
        ok: false,
        error: "HEYREACH_API_KEY / HEYREACH_CAMPAIGN_ID are not configured on the server.",
      },
      { status: 503 },
    );
  }

  const { data: seatRows, error: seatErr } = await supabase
    .from("agent_seats")
    .select(AGENT_SEAT_SELECT)
    .eq("workspace_id", workspaceId);
  if (seatErr) {
    return NextResponse.json({ ok: false, error: "Failed to load seats." }, { status: 500 });
  }

  const seats = (seatRows ?? []) as AgentSeatRow[];
  let seat = pickLinkedInSeat(
    seats.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      status: s.status,
      mode: s.mode,
      connectedAccount: s.connected_account,
      operatorEmail: s.operator_email,
    })),
    provider,
  );

  if (!seat || seat.provider !== provider) {
    const { data: created, error: createErr } = await supabase
      .from("agent_seats")
      .insert({
        workspace_id: workspaceId,
        name: defaultLinkedInSeatName(provider),
        operator_email: operatorLabel.includes("@") ? operatorLabel : `${operatorLabel.replace(/\s+/g, ".").toLowerCase()}@linkedin.aria`,
        provider,
        mode: goLive ? "live" : "mock",
        daily_limit: 20,
        warmup: false,
        warmup_start_cap: 5,
        warmup_step_per_day: 2,
        min_gap_minutes: 30,
        persona: "Warm, specific LinkedIn outreach. One genuine compliment, soft ask. No automation language.",
        signature: "",
        connected_account: operatorLabel,
      })
      .select(AGENT_SEAT_SELECT)
      .single();
    if (createErr || !created) {
      safeLog("linkedin ensure seat error", { message: createErr?.message, code: createErr?.code });
      return NextResponse.json({ ok: false, error: "Could not create LinkedIn seat." }, { status: 403 });
    }
    seat = {
      id: created.id,
      name: created.name,
      provider: created.provider,
      status: created.status,
      mode: created.mode,
      connectedAccount: created.connected_account,
      operatorEmail: created.operator_email,
    };
  } else if (goLive && seat.mode !== "live") {
    const canLive = linkedInSeatCanGoLive(seat);
    if (!canLive.ok) {
      return NextResponse.json({ ok: false, error: canLive.reason }, { status: 400 });
    }
    const { error: liveErr } = await supabase
      .from("agent_seats")
      .update({ mode: "live", connected_account: operatorLabel })
      .eq("id", seat.id);
    if (liveErr) {
      return NextResponse.json({ ok: false, error: "Could not set LinkedIn seat live." }, { status: 500 });
    }
    seat = { ...seat, mode: "live", connectedAccount: operatorLabel };
  } else {
    await supabase.from("agent_seats").update({ connected_account: operatorLabel }).eq("id", seat.id);
  }

  const { data: routeResult, error: routeErr } = await supabase.rpc("upsert_linkedin_inbound_route", {
    p_seat_id: seat.id,
    p_operator_label: operatorLabel,
    p_workspace_id: null,
  });
  if (routeErr) {
    safeLog("upsert_linkedin_inbound_route error", { message: routeErr.message, code: routeErr.code });
    return NextResponse.json({ ok: false, error: "Seat ready but inbound route registration failed. Apply migration 0058." }, { status: 500 });
  }
  const route = routeResult as { ok?: boolean; route_key?: string; reason?: string } | null;
  if (!route?.ok) {
    return NextResponse.json(
      { ok: false, error: route?.reason ?? "Inbound route registration failed." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    seatId: seat.id,
    seatName: seat.name,
    provider,
    mode: seat.mode,
    routeKey: route.route_key,
    detail:
      provider === "LinkedIn Assisted Manual"
        ? "Assisted-manual LinkedIn connected. Draft → copy/paste in LinkedIn → Confirm in Aria."
        : "Vendor LinkedIn seat live. Outbound uses LINKEDIN_VENDOR_* APIs.",
  });
}
