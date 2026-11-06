/* ============================================================================
   LinkedIn bridge planner: what the extension should do on its next poll.

   Pure function over the account state; the poll route loads that state,
   calls planTasks, claims the outbox row of a send task, and returns the
   tasks. The extension runs them one by one and posts each raw answer back.
   ========================================================================== */

import type { BridgePolicy, SendSlot } from "./policy";
import {
  buildConversationsRequest,
  buildMeRequest,
  buildMessagesRequest,
  buildProfileLookupRequest,
  buildSendMessageRequest,
  type CapturedQueries,
  type LinkedInRequestSpec,
} from "./voyager";

export const BRIDGE_OPS = ["identity", "conversations", "messages", "resolveProfile", "send"] as const;
export type BridgeOp = (typeof BRIDGE_OPS)[number];

export interface BridgeTask {
  id: string;
  op: BridgeOp;
  /** Conversation URN (messages) or outbox item id (resolveProfile, send). */
  ref: string | null;
  request: LinkedInRequestSpec;
}

export interface PendingSend {
  id: string;
  body: string;
  conversationUrn: string | null;
  recipientMemberId: string | null;
  recipientPublicId: string | null;
}

export interface PlanInput {
  now: number;
  policy: Pick<BridgePolicy, "inboxSyncIntervalMs">;
  account: {
    memberId: string | null;
    identityCheckedAt: number | null;
    lastInboxSyncAt: number | null;
    backoffUntil: number | null;
    queries: CapturedQueries | null;
  };
  /** The extension saw a LinkedIn session cookie in the browser. */
  sessionPresent: boolean;
  /** Conversation URNs whose messages need a refresh, most recent first. */
  threadsToRefresh: string[];
  nextSend: PendingSend | null;
  sendSlot: SendSlot;
  trackingId: () => string;
}

const IDENTITY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function planTasks(input: PlanInput): BridgeTask[] {
  const { now, account } = input;
  if (!input.sessionPresent) return [];
  if (account.backoffUntil !== null && account.backoffUntil > now) return [];

  const tasks: BridgeTask[] = [];
  const identityStale = account.identityCheckedAt === null || now - account.identityCheckedAt > IDENTITY_MAX_AGE_MS;
  if (!account.memberId || identityStale) {
    tasks.push({ id: `identity:${now}`, op: "identity", ref: null, request: buildMeRequest() });
  }
  // Everything else is addressed to the mailbox of a known member.
  if (!account.memberId) return tasks;
  const memberId = account.memberId;

  // A person is waiting on a send: it goes first.
  const send = input.nextSend;
  if (send && input.sendSlot.allowed) {
    if (send.conversationUrn || send.recipientMemberId) {
      tasks.push({
        id: `send:${send.id}`,
        op: "send",
        ref: send.id,
        request: buildSendMessageRequest({
          selfMemberId: memberId,
          text: send.body,
          conversationUrn: send.conversationUrn,
          recipientMemberId: send.conversationUrn ? null : send.recipientMemberId,
          originToken: send.id,
          trackingId: input.trackingId(),
        }),
      });
    } else if (send.recipientPublicId) {
      tasks.push({
        id: `resolveProfile:${send.id}`,
        op: "resolveProfile",
        ref: send.id,
        request: buildProfileLookupRequest(send.recipientPublicId),
      });
    }
  }

  if (account.lastInboxSyncAt === null || now - account.lastInboxSyncAt >= input.policy.inboxSyncIntervalMs) {
    tasks.push({
      id: `conversations:${now}`,
      op: "conversations",
      ref: null,
      request: buildConversationsRequest(memberId, account.queries),
    });
  }

  for (const urn of input.threadsToRefresh) {
    tasks.push({ id: `messages:${urn}`, op: "messages", ref: urn, request: buildMessagesRequest(urn, account.queries, now) });
  }
  return tasks;
}
