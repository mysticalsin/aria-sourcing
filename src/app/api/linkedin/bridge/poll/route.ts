// Experimental LinkedIn bridge: the paired extension asks what to do next.
// Authenticated by the pairing token, never by a LinkedIn credential.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { planTasks, type BridgeTask, type PendingSend } from "@/lib/linkedin-bridge/planner";
import { readBridgePolicy, writeSlot } from "@/lib/linkedin-bridge/policy";
import { randomTrackingId } from "@/lib/linkedin-bridge/token";
import { mergeCapturedQueries } from "@/lib/linkedin-bridge/voyager";
import {
  CONTACT_COLUMNS,
  OUTBOX_COLUMNS,
  expireStaleClaims,
  lookupsToday,
  okJson,
  recentWrites,
  requireBridgeExtension,
  serverError,
  transitionOutbox,
  unreadCount,
  updateAccount,
  type ContactRow,
  type OutboxRow,
} from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PollSchema = z.object({
  extensionVersion: z.string().max(40),
  sessionPresent: z.boolean(),
  /** The ARIA LinkedIn page is open and visible in this browser. */
  live: z.boolean().optional(),
  /** LinkedIn's own tab showed new activity since the last poll. */
  activity: z.boolean().optional(),
  queries: z.record(z.string().max(60), z.array(z.unknown()).max(20)).optional(),
});

const POLL_AFTER_SECONDS = 60;
const MAX_ATTEMPTS = 3;

function ms(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

export async function POST(req: NextRequest) {
  const auth = await requireBridgeExtension(req, "poll", 60);
  if (!auth.ok) return auth.response;
  const { svc, account } = auth;

  const validated = await validateBody(req, PollSchema, { maxBytes: 16_000 });
  if (!validated.ok) return validated.response;
  const { extensionVersion, sessionPresent, live = false, activity = false, queries } = validated.data;

  const policy = readBridgePolicy();
  const now = new Date();
  try {
    const mergedQueries = mergeCapturedQueries(account.query_ids, queries);
    await updateAccount(svc, account.id, {
      last_seen_at: now.toISOString(),
      extension_version: extensionVersion,
      session_present: sessionPresent,
      query_ids: mergedQueries,
    });
    await expireStaleClaims(svc, account.id, now);

    const recheckBefore = new Date(now.getTime() - policy.pendingRecheckMs).toISOString();
    const [threads, queued, recent, lookedUp, dueContacts] = await Promise.all([
      svc
        .from("linkedin_bridge_conversations")
        .select("conversation_urn")
        .eq("account_id", account.id)
        .eq("needs_message_sync", true)
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(policy.threadRefreshPerPoll),
      svc
        .from("linkedin_bridge_outbox")
        .select(OUTBOX_COLUMNS)
        .eq("account_id", account.id)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1),
      recentWrites(svc, account.id, now),
      lookupsToday(svc, account.id, now),
      // Asked for by a person, or a pending invitation due for its daily check.
      svc
        .from("linkedin_bridge_contacts")
        .select(CONTACT_COLUMNS)
        .eq("account_id", account.id)
        .or(`lookup_requested.eq.true,and(relationship.eq.pending,checked_at.lt."${recheckBefore}")`)
        .order("updated_at", { ascending: true })
        .limit(policy.lookupsPerPoll),
    ]);
    if (threads.error || queued.error || dueContacts.error) return serverError("Bridge state read failed.");

    let next: OutboxRow | null = ((queued.data as OutboxRow[] | null) ?? [])[0] ?? null;
    if (next && next.attempts >= MAX_ATTEMPTS) {
      // Only profile lookups come back to "queued"; a send is never re-queued.
      await transitionOutbox(svc, next, {
        status: "failed",
        error: "The extension did not answer after several tries. Is a LinkedIn tab reachable?",
      });
      next = null;
    }
    const pending: PendingSend | null = next
      ? {
          id: next.id,
          kind: next.kind,
          body: next.body,
          conversationUrn: next.conversation_urn,
          recipientMemberId: next.recipient_member_id,
          recipientPublicId: next.recipient_public_id,
        }
      : null;
    const slot = next ? writeSlot({ now: now.getTime(), kind: next.kind, recent, policy }) : ({ allowed: true } as const);
    const contactsToCheck =
      lookedUp < policy.dailyLookupCap
        ? ((dueContacts.data as ContactRow[] | null) ?? []).map((c) => ({ id: c.id, identity: c.member_id ?? c.identity }))
        : [];

    const planned = planTasks({
      now: now.getTime(),
      policy,
      account: {
        memberId: account.member_id,
        identityCheckedAt: ms(account.identity_checked_at),
        lastInboxSyncAt: ms(account.last_inbox_sync_at),
        backoffUntil: ms(account.backoff_until),
        queries: mergedQueries,
      },
      sessionPresent,
      live,
      linkedInActivity: activity,
      threadsToRefresh: ((threads.data as { conversation_urn: string }[] | null) ?? []).map((t) => t.conversation_urn),
      contactsToCheck,
      nextSend: pending,
      sendSlot: slot,
      trackingId: randomTrackingId,
    });

    // Claim the outbox row before handing it out, so a send is issued once.
    const tasks: BridgeTask[] = [];
    for (const task of planned) {
      if ((task.op === "send" || task.op === "invite" || task.op === "resolveProfile") && next) {
        const claimed = await transitionOutbox(svc, next, {
          status: task.op === "resolveProfile" ? "resolving" : "sending",
          claim_until: new Date(now.getTime() + policy.sendClaimMs).toISOString(),
          attempts: Math.min(10, next.attempts + 1),
        });
        if (!claimed) continue;
      }
      tasks.push(task);
    }

    return okJson({
      tasks,
      pollAfterSeconds: POLL_AFTER_SECONDS,
      account: {
        memberId: account.member_id,
        displayName: account.display_name,
        backoffUntil: account.backoff_until,
        lastError: account.last_error,
      },
      nextSendAt: !slot.allowed && next ? new Date(slot.retryAt).toISOString() : null,
      stats: {
        unread: await unreadCount(svc, account.id),
        sentLast24h: recent.filter((w) => w.kind === "message" && w.at > now.getTime() - 24 * 60 * 60 * 1000).length,
        dailySendCap: policy.dailySendCap,
      },
    });
  } catch {
    return serverError("Bridge poll failed.");
  }
}
