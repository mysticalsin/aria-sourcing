/* ============================================================================
   Server side of the experimental LinkedIn bridge: route authentication and
   every database read/write. Service-role client only; each function takes
   the account (or workspace + user) it is scoped to.
   ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { prodFailClosed, supabaseEnabled } from "@/lib/supabase/config";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import type { Role } from "@/lib/types";
import { linkedInBridgeEnabled } from "./policy";
import { bridgeTokenFromHeader, generateBridgeToken, hashBridgeToken } from "./token";
import type { ParsedConversation, ParsedMessage } from "./parse";
import type { CapturedQueries } from "./voyager";

export type Svc = NonNullable<ReturnType<typeof getServiceSupabase>>;

export interface BridgeAccount {
  id: string;
  workspace_id: string;
  user_id: string;
  paired_at: string;
  member_id: string | null;
  display_name: string | null;
  public_identifier: string | null;
  identity_checked_at: string | null;
  query_ids: CapturedQueries;
  extension_version: string | null;
  session_present: boolean;
  last_seen_at: string | null;
  last_inbox_sync_at: string | null;
  backoff_until: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export const ACCOUNT_COLUMNS =
  "id, workspace_id, user_id, paired_at, member_id, display_name, public_identifier, identity_checked_at, query_ids, extension_version, session_present, last_seen_at, last_inbox_sync_at, backoff_until, last_error, last_error_at";

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function bridgeDisabledResponse(): NextResponse {
  return json(404, {
    ok: false,
    error: "linkedin_bridge_disabled",
    detail: "The experimental LinkedIn bridge is off. Set LINKEDIN_BRIDGE_ENABLED=true on the server to try it.",
  });
}

function tooMany(retryAfterSec: number): NextResponse {
  const res = json(429, { ok: false, error: "rate_limited" });
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSec))));
  return res;
}

export interface BridgeUserContext {
  svc: Svc;
  userId: string;
  workspaceId: string;
}

/** A signed-in ARIA user allowed to do outreach, with the service client. */
export async function requireBridgeUser(
  req: NextRequest,
): Promise<{ ok: true; ctx: BridgeUserContext } | { ok: false; response: Response }> {
  if (!linkedInBridgeEnabled()) return { ok: false, response: bridgeDisabledResponse() };
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false, response: prodBlock };
  if (!supabaseEnabled) {
    return {
      ok: false,
      response: json(503, { ok: false, error: "The LinkedIn bridge needs the Supabase backend (docker compose up)." }),
    };
  }
  const supabase = await getServerSupabase();
  if (!supabase) return { ok: false, response: json(503, { ok: false, error: "Authentication unavailable." }) };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: json(401, { ok: false, error: "Not authenticated." }) };

  const rl = checkRateLimit(rateLimitKey(req, "linkedin-bridge-user", user.id), { windowMs: 60_000, max: 120 });
  if (!rl.ok) return { ok: false, response: tooMany(rl.retryAfterSec) };

  const { data: role } = await supabase.rpc("current_profile_role");
  if (!can(role as Role, "outreach")) {
    return { ok: false, response: json(403, { ok: false, error: "Insufficient permissions." }) };
  }
  const { data: workspaceId } = await supabase.rpc("current_workspace_id");
  if (typeof workspaceId !== "string" || !workspaceId) {
    return { ok: false, response: json(400, { ok: false, error: "Workspace not found." }) };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, response: json(503, { ok: false, error: "Service client unavailable." }) };
  return { ok: true, ctx: { svc, userId: user.id, workspaceId } };
}

/** The paired extension, identified by its bearer pairing token. */
export async function requireBridgeExtension(
  req: NextRequest,
  scope: string,
  maxPerMinute: number,
): Promise<{ ok: true; svc: Svc; account: BridgeAccount } | { ok: false; response: Response }> {
  if (!linkedInBridgeEnabled()) return { ok: false, response: bridgeDisabledResponse() };
  const prodBlock = prodFailClosed();
  if (prodBlock) return { ok: false, response: prodBlock };
  const token = bridgeTokenFromHeader(req.headers.get("authorization"));
  if (!token) return { ok: false, response: json(401, { ok: false, error: "pairing_token_required" }) };
  const tokenHash = hashBridgeToken(token);
  const rl = checkRateLimit(`linkedin-bridge:${scope}:${tokenHash}`, { windowMs: 60_000, max: maxPerMinute });
  if (!rl.ok) return { ok: false, response: tooMany(rl.retryAfterSec) };
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, response: json(503, { ok: false, error: "Service client unavailable." }) };
  const { data, error } = await svc
    .from("linkedin_bridge_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) return { ok: false, response: json(500, { ok: false, error: "Account lookup failed." }) };
  if (!data) return { ok: false, response: json(401, { ok: false, error: "pairing_token_unknown" }) };
  // The pairing outlives a role change: re-check that the owner may still do outreach.
  const { data: profile } = await svc
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", (data as BridgeAccount).user_id)
    .maybeSingle();
  const owner = profile as { role?: string; workspace_id?: string } | null;
  if (!owner || owner.workspace_id !== (data as BridgeAccount).workspace_id || !can(owner.role as Role, "outreach")) {
    return { ok: false, response: json(403, { ok: false, error: "account_owner_not_allowed" }) };
  }
  return { ok: true, svc, account: data as BridgeAccount };
}

export function serverError(detail: string): NextResponse {
  return json(500, { ok: false, error: detail });
}

export function okJson(body: Record<string, unknown>): NextResponse {
  return json(200, { ok: true, ...body });
}

export function badRequest(error: string): NextResponse {
  return json(400, { ok: false, error });
}

export function notFound(error = "Not found."): NextResponse {
  return json(404, { ok: false, error });
}

// ── Account ──────────────────────────────────────────────────────────────────

export async function accountForUser(ctx: BridgeUserContext): Promise<BridgeAccount | null> {
  const { data, error } = await ctx.svc
    .from("linkedin_bridge_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error("linkedin_bridge_accounts read failed");
  return (data as BridgeAccount | null) ?? null;
}

/** Pair (or re-pair) the user's extension. Returns the token, shown once. */
export async function pairAccount(ctx: BridgeUserContext): Promise<string> {
  const { token, hash } = generateBridgeToken();
  const { error } = await ctx.svc
    .from("linkedin_bridge_accounts")
    .upsert(
      { workspace_id: ctx.workspaceId, user_id: ctx.userId, token_hash: hash, paired_at: new Date().toISOString() },
      { onConflict: "workspace_id,user_id" },
    );
  if (error) throw new Error("linkedin_bridge_accounts upsert failed");
  return token;
}

/** Unpair and delete everything synced for this user (cascade). */
export async function deleteAccount(ctx: BridgeUserContext): Promise<void> {
  const { error } = await ctx.svc
    .from("linkedin_bridge_accounts")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_id", ctx.userId);
  if (error) throw new Error("linkedin_bridge_accounts delete failed");
}

export async function updateAccount(svc: Svc, accountId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await svc.from("linkedin_bridge_accounts").update(patch).eq("id", accountId);
  if (error) throw new Error("linkedin_bridge_accounts update failed");
}

// ── Inbox ────────────────────────────────────────────────────────────────────

const PREVIEW_CHARS = 200;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

interface StoredConversation {
  id: string;
  conversation_urn: string;
  title: string | null;
  last_activity_at: string | null;
  unread: boolean;
  messages_synced_at: string | null;
  needs_message_sync: boolean;
  last_message_preview: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_message_sender: string | null;
  participants: unknown[];
}

/** Order-stable fingerprint: Postgres jsonb does not keep object key order. */
function participantsKey(list: unknown[]): string {
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return [o.memberId, o.name, o.profileUrl, o.headline].map((v) => (v == null ? "" : String(v))).join("|");
    })
    .join(";");
}

/**
 * Upsert one inbox page and the messages LinkedIn embedded in it. A
 * conversation row is written only when something about it changed, so its
 * updated_at (which drives the live view) moves only on real news.
 */
export async function storeConversations(svc: Svc, accountId: string, parsed: ParsedConversation[]): Promise<number> {
  if (!parsed.length) return 0;
  const urns = parsed.map((c) => c.urn);
  const { data: existingRows, error: readError } = await svc
    .from("linkedin_bridge_conversations")
    .select(
      "id, conversation_urn, title, last_activity_at, unread, messages_synced_at, needs_message_sync, last_message_preview, last_message_direction, last_message_sender, participants",
    )
    .eq("account_id", accountId)
    .in("conversation_urn", urns);
  if (readError) throw new Error("linkedin_bridge_conversations read failed");
  const existing = new Map((existingRows as StoredConversation[] | null ?? []).map((row) => [row.conversation_urn, row]));

  const now = new Date().toISOString();
  const rows = parsed.flatMap((c) => {
    const known = existing.get(c.urn);
    const knownActivity = known?.last_activity_at ? Date.parse(known.last_activity_at) : null;
    const newer = c.lastActivityAt !== null && (knownActivity === null || c.lastActivityAt > knownActivity);
    const latest = c.messages[c.messages.length - 1];
    const row = {
      account_id: accountId,
      conversation_urn: c.urn,
      title: c.title ? c.title.slice(0, 300) : null,
      participants: c.participants.slice(0, 50),
      group_chat: c.groupChat,
      last_activity_at: newer ? iso(c.lastActivityAt) : (known?.last_activity_at ?? iso(c.lastActivityAt)),
      unread: c.unread,
      last_message_preview: latest ? preview(latest.body) : (known?.last_message_preview ?? null),
      last_message_direction: latest ? latest.direction : (known?.last_message_direction ?? null),
      last_message_sender: latest ? latest.senderName.slice(0, 200) : (known?.last_message_sender ?? null),
      needs_message_sync: !known || !known.messages_synced_at || known.needs_message_sync || newer,
      updated_at: now,
    };
    const unchanged =
      known &&
      !newer &&
      known.unread === row.unread &&
      known.title === row.title &&
      known.last_message_preview === row.last_message_preview &&
      known.last_message_direction === row.last_message_direction &&
      known.needs_message_sync === row.needs_message_sync &&
      participantsKey(known.participants) === participantsKey(row.participants);
    return unchanged ? [] : [row];
  });
  const idByUrn = new Map([...existing.values()].map((row) => [row.conversation_urn, row.id]));
  if (rows.length) {
    const { data: saved, error } = await svc
      .from("linkedin_bridge_conversations")
      .upsert(rows, { onConflict: "account_id,conversation_urn" })
      .select("id, conversation_urn");
    if (error) throw new Error("linkedin_bridge_conversations upsert failed");
    for (const r of (saved as { id: string; conversation_urn: string }[] | null) ?? []) idByUrn.set(r.conversation_urn, r.id);
  }
  const embedded = parsed.flatMap((c) => c.messages);
  await storeMessages(svc, accountId, idByUrn, embedded);
  return rows.length;
}

/** LinkedIn says unread, and nothing newer arrived since the user opened it in ARIA. */
export function unreadInAria(row: { unread: boolean; seen_at: string | null; last_activity_at: string | null }): boolean {
  if (!row.unread) return false;
  if (!row.seen_at) return true;
  return row.last_activity_at !== null && Date.parse(row.last_activity_at) > Date.parse(row.seen_at);
}

export async function unreadCount(svc: Svc, accountId: string): Promise<number> {
  const { data, error } = await svc
    .from("linkedin_bridge_conversations")
    .select("unread, seen_at, last_activity_at")
    .eq("account_id", accountId)
    .eq("unread", true)
    .limit(500);
  if (error) throw new Error("linkedin_bridge_conversations read failed");
  return ((data as { unread: boolean; seen_at: string | null; last_activity_at: string | null }[] | null) ?? []).filter(unreadInAria)
    .length;
}

export interface BridgeVersion {
  /** Pairing, extension heartbeat and sync health. */
  status: string;
  /** Conversations (and through them, messages). */
  inbox: string;
  outbox: string;
}

/** Cheap fingerprint of everything the inbox page shows; the live stream diffs it. */
export async function bridgeVersion(ctx: BridgeUserContext): Promise<BridgeVersion> {
  const account = await accountForUser(ctx);
  if (!account) return { status: "unpaired", inbox: "", outbox: "" };
  const [conversation, outbox] = await Promise.all([
    ctx.svc
      .from("linkedin_bridge_conversations")
      .select("updated_at")
      .eq("account_id", account.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.svc
      .from("linkedin_bridge_outbox")
      .select("updated_at")
      .eq("account_id", account.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (conversation.error || outbox.error) throw new Error("linkedin bridge version read failed");
  return {
    status: [
      account.id,
      account.paired_at,
      account.member_id,
      account.session_present,
      account.last_seen_at,
      account.last_inbox_sync_at,
      account.last_error_at,
      account.backoff_until,
    ].join("|"),
    inbox: (conversation.data as { updated_at?: string } | null)?.updated_at ?? "",
    outbox: (outbox.data as { updated_at?: string } | null)?.updated_at ?? "",
  };
}

export async function storeMessages(
  svc: Svc,
  accountId: string,
  conversationIds: Map<string, string>,
  messages: ParsedMessage[],
): Promise<number> {
  const rows = messages
    .filter((m) => conversationIds.has(m.conversationUrn))
    .map((m) => ({
      account_id: accountId,
      conversation_id: conversationIds.get(m.conversationUrn)!,
      message_urn: m.urn,
      sender_member_id: m.senderMemberId,
      sender_name: m.senderName.slice(0, 200),
      direction: m.direction,
      body: m.body,
      sent_at: new Date(m.sentAt).toISOString(),
    }));
  if (!rows.length) return 0;
  const { error } = await svc.from("linkedin_bridge_messages").upsert(rows, { onConflict: "account_id,message_urn" });
  if (error) throw new Error("linkedin_bridge_messages upsert failed");
  return rows.length;
}

export async function conversationByUrn(
  svc: Svc,
  accountId: string,
  urn: string,
): Promise<{ id: string; conversation_urn: string } | null> {
  const { data, error } = await svc
    .from("linkedin_bridge_conversations")
    .select("id, conversation_urn")
    .eq("account_id", accountId)
    .eq("conversation_urn", urn)
    .maybeSingle();
  if (error) throw new Error("linkedin_bridge_conversations read failed");
  return (data as { id: string; conversation_urn: string } | null) ?? null;
}

/** Make sure a conversation row exists (a new chat opened by a send). */
export async function ensureConversation(svc: Svc, accountId: string, urn: string, participants: unknown[]): Promise<string> {
  const known = await conversationByUrn(svc, accountId, urn);
  if (known) {
    await svc
      .from("linkedin_bridge_conversations")
      .update({ needs_message_sync: true, updated_at: new Date().toISOString() })
      .eq("id", known.id);
    return known.id;
  }
  const { data, error } = await svc
    .from("linkedin_bridge_conversations")
    .upsert(
      {
        account_id: accountId,
        conversation_urn: urn,
        participants,
        last_activity_at: new Date().toISOString(),
        needs_message_sync: true,
      },
      { onConflict: "account_id,conversation_urn" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error("linkedin_bridge_conversations insert failed");
  return (data as { id: string }).id;
}

// ── Outbox ───────────────────────────────────────────────────────────────────

export interface OutboxRow {
  id: string;
  account_id: string;
  conversation_id: string | null;
  conversation_urn: string | null;
  recipient_public_id: string | null;
  recipient_member_id: string | null;
  recipient_name: string | null;
  candidate_id: string | null;
  body: string;
  status: "queued" | "resolving" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  claim_until: string | null;
  attempts: number;
  error: string | null;
  sent_message_urn: string | null;
  sent_at: string | null;
  created_at: string;
}

export const OUTBOX_COLUMNS =
  "id, account_id, conversation_id, conversation_urn, recipient_public_id, recipient_member_id, recipient_name, candidate_id, body, status, claim_until, attempts, error, sent_message_urn, sent_at, created_at";

export async function outboxItem(svc: Svc, accountId: string, id: string): Promise<OutboxRow | null> {
  const { data, error } = await svc
    .from("linkedin_bridge_outbox")
    .select(OUTBOX_COLUMNS)
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("linkedin_bridge_outbox read failed");
  return (data as OutboxRow | null) ?? null;
}

/** Move an outbox row from one status to another, only if nobody moved it first. */
export async function transitionOutbox(
  svc: Svc,
  row: Pick<OutboxRow, "id" | "account_id" | "status">,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await svc
    .from("linkedin_bridge_outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("account_id", row.account_id)
    .eq("status", row.status)
    .select("id");
  if (error) throw new Error("linkedin_bridge_outbox update failed");
  return Array.isArray(data) && data.length === 1;
}

/**
 * Claims that ran out without an answer. A send in flight becomes "unknown"
 * (it may have left; never resend blindly); a profile lookup is just retried.
 */
export async function expireStaleClaims(svc: Svc, accountId: string, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const sending = await svc
    .from("linkedin_bridge_outbox")
    .update({
      status: "unknown",
      claim_until: null,
      error: "The extension never confirmed this send. Check the conversation on LinkedIn before sending again.",
      updated_at: nowIso,
    })
    .eq("account_id", accountId)
    .eq("status", "sending")
    .lt("claim_until", nowIso);
  const resolving = await svc
    .from("linkedin_bridge_outbox")
    .update({ status: "queued", claim_until: null, updated_at: nowIso })
    .eq("account_id", accountId)
    .eq("status", "resolving")
    .lt("claim_until", nowIso);
  if (sending.error || resolving.error) throw new Error("linkedin_bridge_outbox expiry failed");
}

export async function recentSendTimes(svc: Svc, accountId: string, now: Date): Promise<number[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await svc
    .from("linkedin_bridge_outbox")
    .select("sent_at, updated_at")
    .eq("account_id", accountId)
    .in("status", ["sent", "sending", "unknown"])
    .gte("updated_at", since)
    .limit(500);
  if (error) throw new Error("linkedin_bridge_outbox read failed");
  // An unconfirmed send counts against the cap as of its last state change.
  return (data as { sent_at: string | null; updated_at: string }[] | null ?? []).map((r) =>
    Date.parse(r.sent_at ?? r.updated_at),
  );
}
