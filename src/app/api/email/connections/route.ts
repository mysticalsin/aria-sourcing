import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  defaultSeatNameFor,
  emailProviderReadiness,
  normalizeMailboxAddress,
  oauthAuthorizePath,
  oauthConfiguredFor,
  pickSeatForConnect,
  type MailboxOAuthProvider,
} from "@/lib/email-connections";
import { listGraphSubscriptionsForWorkspace, ensureGraphMailSubscription } from "@/lib/email-graph-subscriptions";
import { AGENT_SEAT_SELECT, type AgentSeatRow } from "@/lib/fleet-seats";
import {
  assertMicrosoftGraphSeatLiveReady,
  promoteMicrosoftGraphSeatLive,
} from "@/lib/microsoft-seat-live";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase, getServiceSupabase, requireAdmin } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { Role } from "@/lib/types";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { safeLog } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

const EnsureConnectSchema = z.object({
  action: z.literal("ensure_connect"),
  provider: z.enum(["Gmail API", "Microsoft Graph"]),
});

const RegisterInboundSchema = z.object({
  action: z.literal("register_inbound"),
  seatId: z.string().uuid(),
  purpose: z.enum(["reply", "intake"]).default("reply"),
});

const RegisterHmacMailboxSchema = z.object({
  action: z.literal("register_hmac_mailbox"),
  mailbox: z.string().min(3).max(320),
  purpose: z.enum(["reply", "intake"]).default("intake"),
});

const EnsureGraphWebhookSchema = z.object({
  action: z.literal("ensure_graph_webhook"),
  connectionId: z.string().uuid(),
});

const BodySchema = z.discriminatedUnion("action", [
  EnsureConnectSchema,
  RegisterInboundSchema,
  RegisterHmacMailboxSchema,
  EnsureGraphWebhookSchema,
]);

type ConnRow = {
  id: string;
  seat_id: string;
  provider: string;
  account_email: string;
  expires_at: string | null;
  refresh_token: string | null;
  scope: string | null;
  updated_at: string | null;
};

type RouteRow = {
  mailbox_address: string;
  connection_id: string | null;
  purpose: string;
  active: boolean;
};

/**
 * List mailbox connections + provider readiness (no tokens).
 * POST ensure_connect creates/picks a seat and returns the OAuth authorize URL.
 * POST register_inbound upserts inbound_mailbox_routes for a connected seat.
 * POST register_hmac_mailbox registers HMAC intake/reply routing without OAuth.
 * POST ensure_graph_webhook creates or renews a Microsoft Graph mail push subscription.
 */
export async function GET(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json({
      ok: true,
      demo: true,
      providers: emailProviderReadiness(),
      connections: [],
      seats: [],
      detail: "Live email connections require Supabase.",
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

  const rl = checkRateLimit(rateLimitKey(req, "email-connections-get", user.id), {
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
    safeLog("email-connections seats error", { message: seatErr.message, code: seatErr.code });
    return NextResponse.json({ ok: false, error: "Failed to load seats." }, { status: 500 });
  }

  const seats = (seatRows ?? []) as AgentSeatRow[];

  // Connections hold secrets — service role select, strip tokens before response.
  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 500 });
  }

  const { data: connRows, error: connErr } = await svc
    .from("email_connections")
    .select("id, seat_id, provider, account_email, expires_at, refresh_token, scope, updated_at")
    .eq("workspace_id", wid);
  if (connErr) {
    safeLog("email-connections query error", { message: connErr.message, code: connErr.code });
    return NextResponse.json({ ok: false, error: "Failed to load email connections." }, { status: 500 });
  }

  const { data: routeRows } = await supabase
    .from("inbound_mailbox_routes")
    .select("mailbox_address, connection_id, purpose, active")
    .eq("workspace_id", wid);

  const routes = (routeRows ?? []) as RouteRow[];
  const seatsById = new Map(seats.map((s) => [s.id, s]));
  const graphSubs = await listGraphSubscriptionsForWorkspace(wid);
  const graphByConnection = new Map(graphSubs.map((s) => [s.connectionId, s]));

  const connections = ((connRows ?? []) as ConnRow[]).map((c) => {
    const seat = seatsById.get(c.seat_id);
    const route =
      routes.find((r) => r.connection_id === c.id) ??
      routes.find((r) => r.mailbox_address === normalizeMailboxAddress(c.account_email));
    const graphSubscription = graphByConnection.get(c.id) ?? null;
    return {
      id: c.id,
      seatId: c.seat_id,
      seatName: seat?.name ?? null,
      seatMode: seat?.mode ?? null,
      provider: c.provider,
      accountEmail: c.account_email,
      expiresAt: c.expires_at,
      hasRefreshToken: Boolean(c.refresh_token),
      scope: c.scope ?? "",
      updatedAt: c.updated_at,
      inboundRoute: route
        ? { mailbox: route.mailbox_address, purpose: route.purpose, active: route.active }
        : null,
      graphSubscription: graphSubscription
        ? {
            status: graphSubscription.status,
            expiresAt: graphSubscription.expiresAt,
            lastNotificationAt: graphSubscription.lastNotificationAt,
            active: graphSubscription.status === "active",
          }
        : null,
    };
  });

  const oauthConnectionIds = new Set(((connRows ?? []) as ConnRow[]).map((c) => c.id));
  const hmacRoutes = routes
    .filter((r) => r.active && (!r.connection_id || !oauthConnectionIds.has(r.connection_id)))
    .filter((r) => !connections.some((c) => c.inboundRoute?.mailbox === r.mailbox_address))
    .map((r) => ({
      mailbox: r.mailbox_address,
      purpose: r.purpose,
      active: r.active,
      hmacOnly: !r.connection_id,
    }));

  return NextResponse.json({
    ok: true,
    providers: emailProviderReadiness(),
    connections,
    hmacRoutes,
    seats: seats.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      connectedAccount: s.connected_account || null,
      mode: s.mode,
      status: s.status,
    })),
  });
}

export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json(
      { ok: false, error: "Email connections require Supabase (live mode)." },
      { status: 503 },
    );
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

  const rl = checkRateLimit(rateLimitKey(req, "email-connections-post", user.id), {
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
    return NextResponse.json({
      ok: true,
      status: "dry-run",
      detail: PUBLIC_DEMO_DRY_RUN_DETAIL,
    });
  }

  if (body.action === "ensure_connect") {
    return ensureConnect(supabase, wid as string, body.provider, user.email ?? "operator@aria.local");
  }
  if (body.action === "ensure_graph_webhook") {
    return ensureGraphWebhook(wid as string, body.connectionId);
  }
  if (body.action === "register_hmac_mailbox") {
    return registerHmacMailbox(supabase, wid as string, body.mailbox, body.purpose ?? "intake");
  }
  return registerInbound(supabase, wid as string, body.seatId, body.purpose ?? "reply");
}

async function ensureConnect(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  workspaceId: string,
  provider: MailboxOAuthProvider,
  operatorEmail: string,
) {
  const readiness = emailProviderReadiness();
  if (!oauthConfiguredFor(provider, readiness)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          provider === "Gmail API"
            ? "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."
            : "Microsoft OAuth is not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI).",
      },
      { status: 503 },
    );
  }
  if (!readiness.encryptionReady) {
    return NextResponse.json(
      { ok: false, error: "DATA_ENCRYPTION_KEY is required before connecting a mailbox." },
      { status: 503 },
    );
  }

  const { data: seatRows, error: seatErr } = await supabase
    .from("agent_seats")
    .select(AGENT_SEAT_SELECT)
    .eq("workspace_id", workspaceId);
  if (seatErr) {
    safeLog("email-connections ensure seats error", { message: seatErr.message, code: seatErr.code });
    return NextResponse.json({ ok: false, error: "Failed to load seats." }, { status: 500 });
  }

  const seats = (seatRows ?? []) as AgentSeatRow[];
  let seat = pickSeatForConnect(
    seats.map((s) => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      connectedAccount: s.connected_account,
    })),
    provider,
  );

  if (!seat) {
    const { data: created, error: createErr } = await supabase
      .from("agent_seats")
      .insert({
        workspace_id: workspaceId,
        name: defaultSeatNameFor(provider),
        operator_email: operatorEmail,
        provider,
        mode: "mock",
        daily_limit: 40,
        warmup: true,
        warmup_start_cap: 10,
        warmup_step_per_day: 4,
        min_gap_minutes: 12,
        persona: "",
        signature: "",
      })
      .select(AGENT_SEAT_SELECT)
      .single();
    if (createErr || !created) {
      safeLog("email-connections create seat error", {
        message: createErr?.message,
        code: createErr?.code,
      });
      return NextResponse.json({ ok: false, error: "Could not create a mailbox seat." }, { status: 403 });
    }
    seat = {
      id: created.id,
      name: created.name,
      provider: created.provider,
      connectedAccount: created.connected_account,
    };
  }

  const path = oauthAuthorizePath(provider);
  const authorizeUrl = `${path}?seat_id=${encodeURIComponent(seat.id)}`;
  return NextResponse.json({
    ok: true,
    seatId: seat.id,
    seatName: seat.name,
    provider,
    authorizeUrl,
  });
}

async function registerInbound(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  workspaceId: string,
  seatId: string,
  purpose: "reply" | "intake",
) {
  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 500 });
  }

  const { data: conn, error: connErr } = await svc
    .from("email_connections")
    .select("id, account_email, workspace_id")
    .eq("seat_id", seatId)
    .maybeSingle();
  if (connErr) {
    return NextResponse.json({ ok: false, error: "Failed to look up email connection." }, { status: 500 });
  }
  if (!conn || conn.workspace_id !== workspaceId) {
    return NextResponse.json({ ok: false, error: "No mailbox connected on this seat." }, { status: 404 });
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc("upsert_inbound_mailbox_route", {
    p_mailbox: normalizeMailboxAddress(conn.account_email),
    p_connection_id: conn.id,
    p_purpose: purpose,
    p_workspace_id: null,
  });
  if (rpcErr) {
    safeLog("upsert_inbound_mailbox_route error", { message: rpcErr.message, code: rpcErr.code });
    return NextResponse.json({ ok: false, error: "Failed to register inbound route." }, { status: 500 });
  }
  const result = rpcResult as { ok?: boolean; reason?: string; route_id?: string } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { ok: false, error: result?.reason ?? "Failed to register inbound route." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, routeId: result.route_id, purpose });
}

async function registerHmacMailbox(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  workspaceId: string,
  mailboxRaw: string,
  purpose: "reply" | "intake",
) {
  const mailbox = normalizeMailboxAddress(mailboxRaw);
  if (!mailbox || !mailbox.includes("@") || mailbox.length < 3) {
    return NextResponse.json({ ok: false, error: "Enter a valid mailbox address." }, { status: 400 });
  }

  const { data: rpcResult, error: rpcErr } = await supabase.rpc("upsert_hmac_inbound_mailbox_route", {
    p_mailbox: mailbox,
    p_purpose: purpose,
    p_workspace_id: null,
  });
  if (rpcErr) {
    safeLog("upsert_hmac_inbound_mailbox_route error", {
      message: rpcErr.message,
      code: rpcErr.code,
      workspaceId,
    });
    const missingFn =
      /upsert_hmac_inbound_mailbox_route|function .* does not exist|42883/i.test(rpcErr.message ?? "")
      || rpcErr.code === "42883";
    return NextResponse.json(
      {
        ok: false,
        error: missingFn
          ? "HMAC mailbox registration requires migration 0073 on this database."
          : "Failed to register HMAC inbound route.",
      },
      { status: missingFn ? 503 : 500 },
    );
  }
  const result = rpcResult as { ok?: boolean; reason?: string; route_id?: string } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { ok: false, error: result?.reason ?? "Failed to register HMAC inbound route." },
      { status: 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    routeId: result.route_id,
    purpose,
    mailbox,
    hmacOnly: true,
  });
}

async function ensureGraphWebhook(workspaceId: string, connectionId: string) {
  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 500 });
  }

  const { data: conn, error: connErr } = await svc
    .from("email_connections")
    .select("id, provider, workspace_id, seat_id, account_email")
    .eq("id", connectionId)
    .maybeSingle();
  if (connErr) {
    return NextResponse.json({ ok: false, error: "Failed to look up email connection." }, { status: 500 });
  }
  if (!conn || conn.workspace_id !== workspaceId) {
    return NextResponse.json({ ok: false, error: "Connection not found in this workspace." }, { status: 404 });
  }
  if (conn.provider !== "Microsoft Graph") {
    return NextResponse.json(
      { ok: false, error: "Graph webhook push applies to Microsoft Graph (Outlook) mailboxes only." },
      { status: 400 },
    );
  }

  // Repair inbound route first so a partial OAuth (token saved, route failed) can
  // still become webhook-ready without a full reconnect.
  const mailbox = normalizeMailboxAddress(String(conn.account_email ?? ""));
  if (!mailbox || !conn.seat_id) {
    return NextResponse.json(
      { ok: false, error: "Outlook connection is missing mailbox or seat — reconnect Outlook." },
      { status: 409 },
    );
  }
  const { data: rpcResult, error: rpcErr } = await svc.rpc("upsert_inbound_mailbox_route", {
    p_mailbox: mailbox,
    p_connection_id: conn.id,
    p_purpose: "reply",
    p_workspace_id: workspaceId,
  });
  if (rpcErr || !(rpcResult as { ok?: boolean } | null)?.ok) {
    const reason =
      rpcErr?.message ?? (rpcResult as { reason?: string } | null)?.reason ?? "unknown";
    safeLog("ensure_graph_webhook inbound route error", { message: reason });
    return NextResponse.json(
      { ok: false, error: `Inbound mailbox route failed (${reason}). Reconnect Outlook.` },
      { status: 503 },
    );
  }

  const result = await ensureGraphMailSubscription({ workspaceId, connectionId });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 503 });
  }

  const ready = await assertMicrosoftGraphSeatLiveReady(svc, {
    workspaceId,
    seatId: conn.seat_id,
    provider: "Microsoft Graph",
  });
  if (!ready.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: ready.reason,
        mode: result.mode,
        expiresAt: result.expiresAt,
      },
      { status: 503 },
    );
  }

  let seatMode: "live" | "mock" = "mock";
  if (!ready.skipped) {
    const promoted = await promoteMicrosoftGraphSeatLive(svc, {
      seatId: conn.seat_id,
      accountEmail: conn.account_email,
    });
    if (!promoted.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Graph webhook ready but failed to promote seat to live (${promoted.reason}).`,
          mode: result.mode,
          expiresAt: result.expiresAt,
        },
        { status: 503 },
      );
    }
    seatMode = "live";
  }

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    seatMode,
    expiresAt: result.expiresAt,
    detail:
      result.mode === "unchanged"
        ? "Graph webhook subscription is already active; seat promoted to live."
        : result.mode === "created"
          ? "Graph webhook subscription created; seat promoted to live."
          : result.mode === "recreated"
            ? "Graph webhook subscription recreated; seat promoted to live."
            : "Graph webhook subscription renewed; seat promoted to live.",
  });
}
