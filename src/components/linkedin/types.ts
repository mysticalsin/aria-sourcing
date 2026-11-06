/* Shapes returned by /api/linkedin/* for the experimental LinkedIn inbox. */

export type Participant = { memberId: string | null; name: string; profileUrl: string | null; headline: string | null };

export type Direction = "inbound" | "outbound";

export type Conversation = {
  id: string;
  title: string | null;
  participants: Participant[];
  group_chat: boolean;
  last_activity_at: string | null;
  unread: boolean;
  seen_at: string | null;
  last_message_preview: string | null;
  last_message_direction: Direction | null;
  last_message_sender: string | null;
  messages_synced_at: string | null;
};

export type Message = {
  id: string;
  message_urn: string;
  sender_name: string | null;
  direction: Direction;
  body: string;
  sent_at: string;
};

export type OutboxStatus = "queued" | "resolving" | "sending" | "sent" | "failed" | "unknown" | "cancelled";

export type OutboxItem = {
  id: string;
  conversation_id: string | null;
  recipient_public_id: string | null;
  recipient_name: string | null;
  body: string;
  status: OutboxStatus;
  error: string | null;
  sent_message_urn: string | null;
  created_at: string;
  sent_at: string | null;
};

export type AccountInfo = {
  pairedAt: string;
  memberId: string | null;
  displayName: string | null;
  publicIdentifier: string | null;
  extensionVersion: string | null;
  sessionPresent: boolean;
  online: boolean;
  lastSeenAt: string | null;
  lastInboxSyncAt: string | null;
  backoffUntil: string | null;
  lastError: string | null;
};

export type Policy = { dailySendCap: number; sentLast24h: number; minSendIntervalSeconds?: number };

export type AccountState =
  | { kind: "loading" }
  | { kind: "disabled"; detail: string }
  | { kind: "unavailable"; detail: string }
  | { kind: "ready"; paired: boolean; account: AccountInfo | null; policy: Policy; unread: number };

export type ThreadConversation = Conversation & { conversation_urn: string; thread_url: string | null };

export type ThreadData = { conversation: ThreadConversation; messages: Message[]; outbox: OutboxItem[] };

/** What the extension tells this page about itself (never a secret). */
export type ExtensionStatus = {
  version: string;
  paired: boolean;
  state: string;
  running: boolean;
  message: string;
  sessionPresent: boolean;
  accountName: string | null;
  lastPollAt: number | null;
};

/** A reply that just landed, for toasts and highlights. */
export type Arrival = { conversationId: string; name: string; preview: string; at: number };
