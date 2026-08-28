import "server-only";

/**
 * Microsoft Graph mail change-notification subscriptions (Outlook Inbox).
 * Creates / renews / deletes Graph subscriptions so Aria receives webhook
 * pushes instead of polling mailboxes.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { encryptSecret, decryptSecret } from "@/lib/crypto-secrets";
import { getAccessTokenForReading } from "@/lib/email-oauth";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { EmailConnection } from "@/lib/types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const INBOX_RESOURCE = "/me/mailFolders('inbox')/messages";
/** Graph max subscription lifetime for mail is ~4230 minutes; renew at ~2.5 days. */
const SUBSCRIPTION_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export type GraphSubscriptionRow = {
  id: string;
  workspace_id: string;
  connection_id: string;
  graph_subscription_id: string;
  notification_url: string;
  client_state_hash: string;
  expires_at: string;
  status: string;
};

function hashClientState(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyGraphClientState(presented: string, expectedHash: string): boolean {
  if (!presented || !expectedHash) return false;
  const a = Buffer.from(hashClientState(presented), "utf8");
  const b = Buffer.from(expectedHash, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function notificationUrl(): string | null {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!base.startsWith("https://")) return null;
  return `${base}/api/webhooks/microsoft-graph`;
}

async function loadConnection(connectionId: string, workspaceId: string): Promise<EmailConnection | null> {
  const svc = getServiceSupabase();
  if (!svc) return null;
  const { data } = await svc
    .from("email_connections")
    .select("id, workspace_id, seat_id, provider, account_email, access_token, refresh_token, expires_at, scope, created_at, updated_at")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data || data.provider !== "Microsoft Graph") return null;
  return {
    id: data.id,
    seatId: data.seat_id,
    provider: "Microsoft Graph",
    accountEmail: data.account_email ?? "",
    accessToken: data.access_token ? decryptSecret(data.access_token) : "",
    refreshToken: data.refresh_token ? decryptSecret(data.refresh_token) : null,
    expiresAt: data.expires_at,
    scope: data.scope ?? "",
    connectedAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}

async function persistRefreshedTokens(connection: EmailConnection): Promise<void> {
  const svc = getServiceSupabase();
  if (!svc || !connection.accessToken) return;
  await svc
    .from("email_connections")
    .update({
      access_token: encryptSecret(connection.accessToken),
      refresh_token: connection.refreshToken ? encryptSecret(connection.refreshToken) : null,
      expires_at: connection.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
}

export async function createGraphMailSubscription(input: {
  workspaceId: string;
  connectionId: string;
}): Promise<{ ok: true; subscriptionId: string; expiresAt: string } | { ok: false; reason: string }> {
  const url = notificationUrl();
  if (!url) return { ok: false, reason: "NEXT_PUBLIC_SITE_URL must be https for Graph webhooks." };

  const connection = await loadConnection(input.connectionId, input.workspaceId);
  if (!connection) return { ok: false, reason: "Microsoft Graph connection not found." };

  const token = await getAccessTokenForReading(connection);
  if (!token) return { ok: false, reason: "Could not refresh Microsoft Graph token." };
  await persistRefreshedTokens(connection);

  const clientState = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString();

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/subscriptions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: url,
        resource: INBOX_RESOURCE,
        expirationDateTime: expiresAt,
        clientState,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, reason: "Graph subscription create unreachable." };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: `Graph subscription create failed (${res.status}): ${detail.slice(0, 200)}` };
  }

  const body = (await res.json().catch(() => null)) as {
    id?: string;
    expirationDateTime?: string;
  } | null;
  if (!body?.id) return { ok: false, reason: "Graph subscription response missing id." };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, reason: "Service client unavailable." };

  const { error } = await svc.from("graph_mail_subscriptions").upsert(
    {
      workspace_id: input.workspaceId,
      connection_id: input.connectionId,
      graph_subscription_id: body.id,
      resource: INBOX_RESOURCE,
      change_types: "created",
      notification_url: url,
      client_state_hash: hashClientState(clientState),
      expires_at: body.expirationDateTime ?? expiresAt,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (error) return { ok: false, reason: `Failed to persist subscription: ${error.message}` };

  return {
    ok: true,
    subscriptionId: body.id,
    expiresAt: body.expirationDateTime ?? expiresAt,
  };
}

export async function deleteGraphMailSubscription(input: {
  workspaceId: string;
  connectionId: string;
}): Promise<void> {
  const svc = getServiceSupabase();
  if (!svc) return;
  const { data: row } = await svc
    .from("graph_mail_subscriptions")
    .select("graph_subscription_id")
    .eq("workspace_id", input.workspaceId)
    .eq("connection_id", input.connectionId)
    .maybeSingle();
  if (!row?.graph_subscription_id) return;

  const connection = await loadConnection(input.connectionId, input.workspaceId);
  if (connection) {
    const token = await getAccessTokenForReading(connection);
    if (token) {
      await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(row.graph_subscription_id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
      await persistRefreshedTokens(connection);
    }
  }

  await svc
    .from("graph_mail_subscriptions")
    .update({ status: "deleted", updated_at: new Date().toISOString() })
    .eq("connection_id", input.connectionId);
}

export async function lookupGraphSubscription(graphSubscriptionId: string): Promise<GraphSubscriptionRow | null> {
  const svc = getServiceSupabase();
  if (!svc) return null;
  const { data } = await svc
    .from("graph_mail_subscriptions")
    .select("id, workspace_id, connection_id, graph_subscription_id, notification_url, client_state_hash, expires_at, status")
    .eq("graph_subscription_id", graphSubscriptionId)
    .eq("status", "active")
    .maybeSingle();
  return (data as GraphSubscriptionRow | null) ?? null;
}

/** True when an active subscription should be renewed before Graph expires it. */
export function subscriptionNeedsRenewal(
  expiresAt: string,
  now = Date.now(),
  withinMs = 12 * 60 * 60 * 1000,
): boolean {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires - now <= withinMs;
}

/**
 * Renew one Graph mail subscription via PATCH. Recreates when Graph returns 404.
 */
export async function renewGraphMailSubscription(input: {
  workspaceId: string;
  connectionId: string;
  graphSubscriptionId: string;
}): Promise<{ ok: true; expiresAt: string; mode: "renewed" | "recreated" } | { ok: false; reason: string }> {
  const connection = await loadConnection(input.connectionId, input.workspaceId);
  if (!connection) return { ok: false, reason: "Microsoft Graph connection not found." };

  const token = await getAccessTokenForReading(connection);
  if (!token) return { ok: false, reason: "Could not refresh Microsoft Graph token." };
  await persistRefreshedTokens(connection);

  const expiresAt = new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString();
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(input.graphSubscriptionId)}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expirationDateTime: expiresAt }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, reason: "Graph subscription renew unreachable." };
  }

  if (res.status === 404) {
    const created = await createGraphMailSubscription({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
    });
    if (!created.ok) return created;
    return { ok: true, expiresAt: created.expiresAt, mode: "recreated" };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const svc = getServiceSupabase();
    if (svc) {
      await svc
        .from("graph_mail_subscriptions")
        .update({
          status: "error",
          last_error: `renew_http_${res.status}:${detail.slice(0, 180)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("connection_id", input.connectionId);
    }
    return { ok: false, reason: `Graph subscription renew failed (${res.status}): ${detail.slice(0, 200)}` };
  }

  const body = (await res.json().catch(() => null)) as { expirationDateTime?: string } | null;
  const nextExpiry = body?.expirationDateTime ?? expiresAt;
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, reason: "Service client unavailable." };
  await svc
    .from("graph_mail_subscriptions")
    .update({
      expires_at: nextExpiry,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", input.connectionId);

  return { ok: true, expiresAt: nextExpiry, mode: "renewed" };
}

/** Renew all active subscriptions nearing expiry (default: within 12 hours). */
export async function renewExpiringGraphMailSubscriptions(input?: {
  withinHours?: number;
  limit?: number;
}): Promise<{ scanned: number; renewed: number; recreated: number; failed: number }> {
  const svc = getServiceSupabase();
  if (!svc) return { scanned: 0, renewed: 0, recreated: 0, failed: 0 };

  const withinHours = Math.min(48, Math.max(1, input?.withinHours ?? 12));
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const horizon = new Date(Date.now() + withinHours * 60 * 60 * 1000).toISOString();

  const { data: rows } = await svc
    .from("graph_mail_subscriptions")
    .select("workspace_id, connection_id, graph_subscription_id, expires_at")
    .eq("status", "active")
    .lte("expires_at", horizon)
    .order("expires_at", { ascending: true })
    .limit(limit);

  let renewed = 0;
  let recreated = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const result = await renewGraphMailSubscription({
      workspaceId: row.workspace_id,
      connectionId: row.connection_id,
      graphSubscriptionId: row.graph_subscription_id,
    });
    if (!result.ok) {
      failed += 1;
      continue;
    }
    if (result.mode === "recreated") recreated += 1;
    else renewed += 1;
  }

  return { scanned: rows?.length ?? 0, renewed, recreated, failed };
}

export async function ensureGraphMailSubscription(input: {
  workspaceId: string;
  connectionId: string;
}): Promise<
  | { ok: true; expiresAt: string; mode: "created" | "renewed" | "recreated" | "unchanged" }
  | { ok: false; reason: string }
> {
  const subs = await listGraphSubscriptionsForWorkspace(input.workspaceId);
  const existing = subs.find((s) => s.connectionId === input.connectionId);

  if (existing?.status === "active" && !subscriptionNeedsRenewal(existing.expiresAt)) {
    // Do not trust DB alone — Graph may have deleted/expired the subscription.
    const connection = await loadConnection(input.connectionId, input.workspaceId);
    if (!connection) return { ok: false, reason: "Microsoft Graph connection not found." };
    const token = await getAccessTokenForReading(connection);
    if (!token) return { ok: false, reason: "Could not refresh Microsoft Graph token." };
    await persistRefreshedTokens(connection);
    let probe: Response;
    try {
      probe = await fetch(
        `${GRAPH}/subscriptions/${encodeURIComponent(existing.graphSubscriptionId)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      return { ok: false, reason: "Graph subscription probe unreachable." };
    }
    if (probe.status === 404) {
      const created = await createGraphMailSubscription(input);
      if (!created.ok) return created;
      return { ok: true, expiresAt: created.expiresAt, mode: "recreated" };
    }
    if (!probe.ok) {
      const detail = await probe.text().catch(() => "");
      return {
        ok: false,
        reason: `Graph subscription probe failed (${probe.status}): ${detail.slice(0, 200)}`,
      };
    }
    return { ok: true, expiresAt: existing.expiresAt, mode: "unchanged" };
  }

  if (existing?.status === "active" && subscriptionNeedsRenewal(existing.expiresAt)) {
    const renewed = await renewGraphMailSubscription({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      graphSubscriptionId: existing.graphSubscriptionId,
    });
    if (!renewed.ok) return renewed;
    return {
      ok: true,
      expiresAt: renewed.expiresAt,
      mode: renewed.mode === "recreated" ? "recreated" : "renewed",
    };
  }

  const created = await createGraphMailSubscription(input);
  if (!created.ok) return created;
  return { ok: true, expiresAt: created.expiresAt, mode: "created" };
}

export async function listGraphSubscriptionsForWorkspace(
  workspaceId: string,
): Promise<
  Array<{
    connectionId: string;
    graphSubscriptionId: string;
    expiresAt: string;
    status: string;
    lastNotificationAt: string | null;
  }>
> {
  const svc = getServiceSupabase();
  if (!svc) return [];
  const { data } = await svc
    .from("graph_mail_subscriptions")
    .select("connection_id, graph_subscription_id, expires_at, status, last_notification_at")
    .eq("workspace_id", workspaceId);
  return (data ?? []).map((row) => ({
    connectionId: row.connection_id,
    graphSubscriptionId: row.graph_subscription_id,
    expiresAt: row.expires_at,
    status: row.status,
    lastNotificationAt: row.last_notification_at ?? null,
  }));
}

type GraphMessageJson = {
  id?: string;
  internetMessageId?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
};

export type NormalizedGraphMessage = {
  providerId: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  mailbox: string;
};

/**
 * Fetch a Graph inbox message for hiring-need / reply ingest.
 * Fail-closed when Graph is absent: never invents a message. Distinguishes
 * non-retryable credential/connection gaps from transient Graph fetch errors.
 */
export type GraphMessageFetchResult =
  | { ok: true; message: NormalizedGraphMessage }
  | {
      ok: false;
      reason:
        | "connection_missing"
        | "token_unavailable"
        | "message_fetch_failed"
        | "message_incomplete";
    };

export async function fetchGraphMessageForIngest(input: {
  workspaceId: string;
  connectionId: string;
  messageId: string;
}): Promise<GraphMessageFetchResult> {
  const connection = await loadConnection(input.connectionId, input.workspaceId);
  if (!connection) return { ok: false, reason: "connection_missing" };
  const token = await getAccessTokenForReading(connection);
  if (!token) return { ok: false, reason: "token_unavailable" };
  await persistRefreshedTokens(connection);

  const select =
    "id,internetMessageId,subject,body,from,receivedDateTime,internetMessageHeaders";
  // Prefer plain text so Mantu "Recruiter:" / "Skills:" lines survive for hiring-need routing.
  let res: Response;
  try {
    res = await fetch(
      `${GRAPH}/me/messages/${encodeURIComponent(input.messageId)}?$select=${select}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          Prefer: 'outlook.body-content-type="text"',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    return { ok: false, reason: "message_fetch_failed" };
  }
  if (!res.ok) return { ok: false, reason: "message_fetch_failed" };
  const msg = (await res.json().catch(() => null)) as GraphMessageJson | null;
  if (!msg?.id) return { ok: false, reason: "message_incomplete" };

  const fromAddr =
    msg.from?.emailAddress?.address?.trim() ||
    msg.from?.emailAddress?.name?.trim() ||
    "";
  if (!fromAddr) return { ok: false, reason: "message_incomplete" };

  const bodyText = normalizeGraphMessageBody(msg.body);

  const headers = Array.isArray(msg.internetMessageHeaders) ? msg.internetMessageHeaders : [];
  const inReplyTo =
    headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value?.trim() || undefined;

  return {
    ok: true,
    message: {
      providerId: msg.internetMessageId?.trim() || msg.id,
      from: fromAddr,
      subject: msg.subject ?? "",
      body: bodyText,
      inReplyTo,
      mailbox: connection.accountEmail,
    },
  };
}

/** Decode common HTML entities left after tag strip (Graph often returns HTML bodies). */
function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * Normalize Graph message body for hiring-need / reply classification.
 * Prefer text content; if Graph returns HTML, preserve line breaks so Mantu
 * field lines (`Recruiter:`, `Skills:`, `Type:`, `Location:`) stay matchable.
 */
export function normalizeGraphMessageBody(
  body: { contentType?: string; content?: string } | undefined,
): string {
  const raw = body?.content?.trim() ?? "";
  if (!raw) return "";
  const declaredHtml = (body?.contentType ?? "").toLowerCase() === "html";
  // Only treat as HTML when Graph declared it — plain "Name <email@host>" must stay text.
  if (!declaredHtml) return raw;
  const withBreaks = raw
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*tr\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n");
  const stripped = decodeBasicHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return stripped
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
