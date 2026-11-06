"use client";

import * as React from "react";
import { linkedInApi } from "./api";
import type { AccountInfo, AccountState, Arrival, Conversation, OutboxItem, Policy } from "./types";

/* Live data for the LinkedIn inbox page. One EventSource on
 * /api/linkedin/stream says which part changed (status, inbox, outbox); only
 * that part is refetched. If the stream cannot be opened, the hook falls back
 * to polling every 10 s. */

const FALLBACK_POLL_MS = 10_000;

export type Transport = "connecting" | "live" | "polling";

export interface LinkedInInbox {
  account: AccountState;
  conversations: Conversation[] | null;
  outbox: OutboxItem[];
  /** Bumps whenever a thread may have changed: open threads refetch on it. */
  threadTick: number;
  transport: Transport;
  /** Conversations that just received a reply (cleared after a few seconds). */
  highlighted: ReadonlySet<string>;
  refreshAll: () => Promise<void>;
}

export interface InboxEvents {
  onArrival?: (arrivals: Arrival[]) => void;
  onSent?: (items: OutboxItem[]) => void;
}

function newer(a: string | null, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a) > Date.parse(b);
}

function nameOf(c: Conversation): string {
  return c.title || c.participants.map((p) => p.name).join(", ") || c.last_message_sender || "LinkedIn member";
}

export function useLinkedInInbox(events: InboxEvents = {}): LinkedInInbox {
  const [account, setAccount] = React.useState<AccountState>({ kind: "loading" });
  const [conversations, setConversations] = React.useState<Conversation[] | null>(null);
  const [outbox, setOutbox] = React.useState<OutboxItem[]>([]);
  const [threadTick, setThreadTick] = React.useState(0);
  const [transport, setTransport] = React.useState<Transport>("connecting");
  const [highlighted, setHighlighted] = React.useState<ReadonlySet<string>>(new Set());
  const eventsRef = React.useRef(events);
  eventsRef.current = events;
  const lastActivity = React.useRef<Map<string, string | null> | null>(null);
  const lastStatus = React.useRef<Map<string, OutboxItem["status"]> | null>(null);

  const refreshAccount = React.useCallback(async () => {
    const res = await linkedInApi<{ paired: boolean; account?: AccountInfo; policy: Policy; unread?: number }>("/api/linkedin/account");
    if (!res.ok) {
      setAccount(res.disabled ? { kind: "disabled", detail: res.error } : { kind: "unavailable", detail: res.error });
      return;
    }
    setAccount({
      kind: "ready",
      paired: res.data.paired,
      account: res.data.account ?? null,
      policy: res.data.policy,
      unread: res.data.unread ?? 0,
    });
  }, []);

  const refreshConversations = React.useCallback(async () => {
    const res = await linkedInApi<{ conversations: Conversation[] }>("/api/linkedin/conversations");
    if (!res.ok) return;
    const list = res.data.conversations;
    const previous = lastActivity.current;
    // The first sync fills an empty inbox: that is history, not news.
    if (previous && previous.size > 0) {
      const arrivals: Arrival[] = list
        .filter((c) => c.last_message_direction === "inbound" && newer(c.last_activity_at, previous.get(c.id)))
        .map((c) => ({ conversationId: c.id, name: nameOf(c), preview: c.last_message_preview ?? "", at: Date.now() }));
      if (arrivals.length) {
        eventsRef.current.onArrival?.(arrivals);
        setHighlighted((current) => new Set([...current, ...arrivals.map((a) => a.conversationId)]));
        window.setTimeout(() => {
          setHighlighted((current) => {
            const next = new Set(current);
            for (const a of arrivals) next.delete(a.conversationId);
            return next;
          });
        }, 4000);
      }
    }
    lastActivity.current = new Map(list.map((c) => [c.id, c.last_activity_at]));
    setConversations(list);
  }, []);

  const refreshOutbox = React.useCallback(async () => {
    const res = await linkedInApi<{ items: OutboxItem[] }>("/api/linkedin/outbox");
    if (!res.ok) return;
    const items = res.data.items;
    const previous = lastStatus.current;
    if (previous) {
      const sent = items.filter((i) => i.status === "sent" && previous.has(i.id) && previous.get(i.id) !== "sent");
      if (sent.length) eventsRef.current.onSent?.(sent);
    }
    lastStatus.current = new Map(items.map((i) => [i.id, i.status]));
    setOutbox(items);
  }, []);

  const refreshAll = React.useCallback(async () => {
    await Promise.all([refreshAccount(), refreshConversations(), refreshOutbox()]);
    setThreadTick((t) => t + 1);
  }, [refreshAccount, refreshConversations, refreshOutbox]);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const streaming = account.kind === "ready";
  React.useEffect(() => {
    if (!streaming) return;
    let source: EventSource | null = new EventSource("/api/linkedin/stream");
    let poll: number | null = null;
    let opened = false;
    let failures = 0;

    source.onopen = () => {
      opened = true;
      failures = 0;
      setTransport("live");
    };
    source.addEventListener("change", (event) => {
      let parts: string[] = [];
      try {
        parts = (JSON.parse((event as MessageEvent<string>).data) as { parts?: string[] }).parts ?? [];
      } catch {
        return;
      }
      if (parts.includes("status")) void refreshAccount();
      if (parts.includes("inbox")) void refreshConversations();
      if (parts.includes("outbox")) {
        void refreshOutbox();
        void refreshAccount(); // the send counter
      }
      if (parts.includes("inbox") || parts.includes("outbox")) setThreadTick((t) => t + 1);
    });
    source.onerror = () => {
      failures += 1;
      if ((!opened && failures >= 3) || failures >= 8) {
        source?.close();
        source = null;
        setTransport("polling");
        poll = window.setInterval(() => void refreshAll(), FALLBACK_POLL_MS);
      } else {
        setTransport("connecting");
      }
    };
    return () => {
      source?.close();
      if (poll !== null) window.clearInterval(poll);
    };
  }, [streaming, refreshAccount, refreshConversations, refreshOutbox, refreshAll]);

  return { account, conversations, outbox, threadTick, transport, highlighted, refreshAll };
}
