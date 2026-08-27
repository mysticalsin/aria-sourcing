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

export async function fetchGraphMessageForIngest(input: {
  workspaceId: string;
  connectionId: string;
  messageId: string;
}): Promise<NormalizedGraphMessage | null> {
  const connection = await loadConnection(input.connectionId, input.workspaceId);
  if (!connection) return null;
  const token = await getAccessTokenForReading(connection);
  if (!token) return null;
  await persistRefreshedTokens(connection);

  const select =
    "id,internetMessageId,subject,body,from,receivedDateTime,internetMessageHeaders";
  const res = await fetch(
    `${GRAPH}/me/messages/${encodeURIComponent(input.messageId)}?$select=${select}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) return null;
  const msg = (await res.json().catch(() => null)) as GraphMessageJson | null;
  if (!msg?.id) return null;

  const fromAddr =
    msg.from?.emailAddress?.address?.trim() ||
    msg.from?.emailAddress?.name?.trim() ||
    "";
  if (!fromAddr) return null;

  let bodyText = "";
  if (msg.body?.content) {
    bodyText =
      msg.body.contentType === "html"
        ? msg.body.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : msg.body.content.trim();
  }

  const headers = Array.isArray(msg.internetMessageHeaders) ? msg.internetMessageHeaders : [];
  const inReplyTo =
    headers.find((h) => h.name?.toLowerCase() === "in-reply-to")?.value?.trim() || undefined;

  return {
    providerId: msg.internetMessageId?.trim() || msg.id,
    from: fromAddr,
    subject: msg.subject ?? "",
    body: bodyText,
    inReplyTo,
    mailbox: connection.accountEmail,
  };
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
