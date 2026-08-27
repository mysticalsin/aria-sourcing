import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  emailProviderReadiness,
  summarizeEmailValidation,
  type EmailValidationCheck,
} from "@/lib/email-connections";
import { getAccessTokenForReading } from "@/lib/email-oauth";
import { checkRateLimit, rateLimitKey, tooManyRequests } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import type { EmailConnection, Role } from "@/lib/types";
import { decryptSecret } from "@/lib/crypto-secrets";
import { PUBLIC_DEMO_DRY_RUN_DETAIL, publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";

export const dynamic = "force-dynamic";

const TestSchema = z.object({
  seatId: z.string().uuid(),
});

/**
 * Validate a connected mailbox: refresh token, probe provider profile, confirm
 * inbound route + webhook secret readiness. Never returns tokens.
 */
export async function POST(req: NextRequest) {
  const prodBlock = prodFailClosed();
  if (prodBlock) return prodBlock;

  if (!supabaseEnabled) {
    return NextResponse.json(
      { ok: false, error: "Authentication backend not configured." },
      { status: 503 },
    );
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

  const rl = checkRateLimit(rateLimitKey(req, "email-test", user.id), { windowMs: 60_000, max: 20 });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const validated = await validateBody(req, TestSchema, { maxBytes: 2_048 });
  if (!validated.ok) return validated.response;
  const { seatId } = validated.data;

  const { data: wid } = await supabase.rpc("current_workspace_id");
  if (!wid) {
    return NextResponse.json({ ok: false, error: "Workspace not found." }, { status: 400 });
  }

  if (publicDemoSideEffectsDisabled()) {
    return NextResponse.json({
      ok: true,
      status: "dry-run",
      detail: PUBLIC_DEMO_DRY_RUN_DETAIL,
      checks: [],
    });
  }

  const svc = getServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "Service client unavailable." }, { status: 500 });
  }

  const { data: row, error: connErr } = await svc
    .from("email_connections")
    .select(
      "id, workspace_id, seat_id, provider, account_email, access_token, refresh_token, expires_at, scope, updated_at",
    )
    .eq("seat_id", seatId)
    .maybeSingle();

  if (connErr) {
    return NextResponse.json({ ok: false, error: "Failed to load email connection." }, { status: 500 });
  }
  if (!row || row.workspace_id !== wid) {
    return NextResponse.json({ ok: false, error: "No mailbox connected on this seat." }, { status: 404 });
  }

  const readiness = emailProviderReadiness();
  const checks: EmailValidationCheck[] = [];

  checks.push({
    id: "encryption",
    ok: readiness.encryptionReady,
    detail: readiness.encryptionReady
      ? "Token encryption configured."
      : "DATA_ENCRYPTION_KEY missing in production.",
  });

  checks.push({
    id: "refresh_token",
    ok: Boolean(row.refresh_token),
    detail: row.refresh_token
      ? "Refresh token present."
      : "Missing refresh token — reconnect with offline consent.",
  });

  const connection: EmailConnection = {
    id: row.id,
    seatId: row.seat_id,
    provider: row.provider as EmailConnection["provider"],
    accountEmail: row.account_email,
    accessToken: decryptSecret(row.access_token),
    refreshToken: row.refresh_token ? decryptSecret(row.refresh_token) : null,
    expiresAt: row.expires_at,
    scope: row.scope ?? "",
    connectedAt: row.updated_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };

  const t0 = Date.now();
  const token = await getAccessTokenForReading(connection);
  checks.push({
    id: "access_token",
    ok: Boolean(token),
    detail: token ? "Access token valid (refreshed if needed)." : "Could not refresh access token.",
  });

  let profileOk = false;
  let profileDetail = "Skipped profile probe (no access token).";
  if (token) {
    try {
      if (connection.provider === "Gmail API") {
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json().catch(() => ({}))) as { emailAddress?: string };
        profileOk = res.ok && Boolean(json.emailAddress);
        profileDetail = profileOk
          ? `Gmail profile OK (${json.emailAddress}).`
          : `Gmail profile probe failed (${res.status}).`;
      } else {
        const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json().catch(() => ({}))) as {
          mail?: string;
          userPrincipalName?: string;
        };
        const addr = json.mail || json.userPrincipalName;
        profileOk = res.ok && Boolean(addr);
        profileDetail = profileOk
          ? `Microsoft Graph profile OK (${addr}).`
          : `Graph profile probe failed (${res.status}).`;
      }
    } catch {
      profileOk = false;
      profileDetail = "Provider profile probe timed out or network failed.";
    }
  }
  checks.push({ id: "provider_profile", ok: profileOk, detail: profileDetail });

  const { data: route } = await supabase
    .from("inbound_mailbox_routes")
    .select("id, active, purpose, mailbox_address")
    .eq("workspace_id", wid)
    .eq("connection_id", row.id)
    .maybeSingle();

  const routeActive = Boolean(route?.active);
  checks.push({
    id: "inbound_route",
    ok: routeActive,
    detail: routeActive
      ? `Inbound route active (${route?.mailbox_address}, ${route?.purpose}).`
      : "No active inbound_mailbox_routes row — register from Settings or reconnect.",
  });

  if (connection.provider === "Microsoft Graph") {
    const { data: graphSub } = await supabase
      .from("graph_mail_subscriptions")
      .select("status, expires_at")
      .eq("workspace_id", wid)
      .eq("connection_id", row.id)
      .maybeSingle();
    const subActive = graphSub?.status === "active";
    checks.push({
      id: "graph_subscription",
      ok: subActive,
      detail: subActive
        ? `Graph webhook subscription active (expires ${graphSub?.expires_at ?? "unknown"}).`
        : "Graph webhook subscription not active — Enable webhook or reconnect Outlook (no inbox polling).",
    });
  }

  checks.push({
    id: "inbound_webhook_secret",
    ok: readiness.inboundWebhookSecret,
    detail: readiness.inboundWebhookSecret
      ? "EMAIL_INBOUND_WEBHOOK_SECRET is set."
      : "EMAIL_INBOUND_WEBHOOK_SECRET not set — webhook will reject inbound replies.",
  });

  const summary = summarizeEmailValidation(checks);
  return NextResponse.json({
    ok: summary.ok,
    latencyMs: Date.now() - t0,
    message: summary.message,
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    checks: summary.checks,
  });
}
