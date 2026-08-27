import "server-only";

/**
 * Microsoft Graph (Outlook) seats may only be `mode=live` after:
 *   1) durable inbound mailbox route, and
 *   2) active Graph mail push subscription.
 *
 * This matches the OAuth callback promote gate and keeps fleet PATCH /
 * Enable-webhook repair from claiming live without webhook intake.
 */

import { normalizeMailboxAddress } from "@/lib/email-connections";

/** Minimal service-role client surface used by readiness / promote helpers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = { from: (table: string) => any };

export type MicrosoftSeatLiveReady =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; connectionId: string; accountEmail: string; seatId: string }
  | { ok: false; reason: string };

/** Returns readiness for promoting / keeping a seat live. Non-Graph providers skip. */
export async function assertMicrosoftGraphSeatLiveReady(
  svc: ServiceClient,
  input: { workspaceId: string; seatId: string; provider?: string },
): Promise<MicrosoftSeatLiveReady> {
  let provider = input.provider;
  if (!provider) {
    const { data: seat, error } = await svc
      .from("agent_seats")
      .select("id, provider, workspace_id")
      .eq("id", input.seatId)
      .maybeSingle();
    if (error || !seat || seat.workspace_id !== input.workspaceId) {
      return { ok: false, reason: "Seat not found in your workspace." };
    }
    provider = String(seat.provider ?? "");
  }

  if (provider !== "Microsoft Graph") {
    return { ok: true, skipped: true };
  }

  const { data: conn, error: connErr } = await svc
    .from("email_connections")
    .select("id, account_email, refresh_token")
    .eq("seat_id", input.seatId)
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "Microsoft Graph")
    .maybeSingle();
  if (connErr) {
    return { ok: false, reason: "Failed to look up Outlook connection." };
  }
  if (!conn?.id || !conn.refresh_token) {
    return {
      ok: false,
      reason: "Connect Outlook (Microsoft Graph) before setting this seat live.",
    };
  }

  const mailbox = normalizeMailboxAddress(String(conn.account_email ?? ""));
  const { data: routeRows, error: routeErr } = await svc
    .from("inbound_mailbox_routes")
    .select("id, connection_id, mailbox_address, active")
    .eq("workspace_id", input.workspaceId)
    .eq("active", true);
  if (routeErr) {
    return { ok: false, reason: "Failed to look up inbound mailbox route." };
  }
  const routes = Array.isArray(routeRows) ? routeRows : routeRows ? [routeRows] : [];
  const routeOk = routes.some(
    (r: { connection_id?: string | null; mailbox_address?: string | null }) =>
      r.connection_id === conn.id ||
      (mailbox.length > 0 && normalizeMailboxAddress(String(r.mailbox_address ?? "")) === mailbox),
  );
  if (!routeOk) {
    return {
      ok: false,
      reason:
        "Inbound mailbox route is missing. Reconnect Outlook or register the inbound route before going live.",
    };
  }

  const { data: sub, error: subErr } = await svc
    .from("graph_mail_subscriptions")
    .select("id, status")
    .eq("workspace_id", input.workspaceId)
    .eq("connection_id", conn.id)
    .eq("status", "active")
    .maybeSingle();
  if (subErr) {
    return { ok: false, reason: "Failed to look up Graph webhook subscription." };
  }
  if (!sub?.id) {
    return {
      ok: false,
      reason:
        "Microsoft Graph webhook subscription is not active. Connect Outlook or use Enable webhook before going live.",
    };
  }

  return {
    ok: true,
    skipped: false,
    connectionId: conn.id,
    accountEmail: String(conn.account_email ?? ""),
    seatId: input.seatId,
  };
}

/** Promote seat to live after inbound route + Graph subscription are durable. */
export async function promoteMicrosoftGraphSeatLive(
  svc: ServiceClient,
  input: { seatId: string; accountEmail?: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const patch: Record<string, string> = { mode: "live", status: "active" };
  const email = input.accountEmail?.trim();
  if (email) patch.connected_account = email;

  const { error } = await svc.from("agent_seats").update(patch).eq("id", input.seatId);
  if (error) {
    return { ok: false, reason: error.message || "Failed to promote seat to live." };
  }
  return { ok: true };
}
