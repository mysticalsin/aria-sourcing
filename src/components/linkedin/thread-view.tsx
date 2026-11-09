"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowDown, Check, CheckCheck, Clock, ExternalLink, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { linkedInApi, postJson } from "./api";
import { Avatar } from "./avatar";
import { Composer } from "./composer";
import { clock, dayKey, dayLabel } from "./format";
import type { Message, OutboxItem, OutboxStatus, ThreadData } from "./types";

const EASE = [0.23, 1, 0.32, 1] as const;
const GROUP_GAP_MS = 5 * 60 * 1000;

type LocalSend = { key: string; body: string; createdAt: string; serverId?: string; error?: string };

type Stage = OutboxStatus | "local" | "local-failed";

type Entry =
  | { kind: "message"; key: string; at: string; message: Message }
  | { kind: "pending"; key: string; at: string; body: string; stage: Stage; error: string | null; serverId: string | null; localKey: string | null };

const STAGE: Record<Stage, { label: string; icon: React.ReactNode; tone: "pending" | "busy" | "done" | "bad" | "warn" }> = {
  local: { label: "Queued", icon: <Clock className="h-3 w-3" />, tone: "pending" },
  queued: { label: "Queued", icon: <Clock className="h-3 w-3" />, tone: "pending" },
  resolving: { label: "Finding the profile…", icon: <Loader2 className="h-3 w-3 animate-spin" />, tone: "busy" },
  sending: { label: "Sending…", icon: <Loader2 className="h-3 w-3 animate-spin" />, tone: "busy" },
  sent: { label: "Sent", icon: <Check className="h-3 w-3" />, tone: "done" },
  failed: { label: "Not sent", icon: <AlertTriangle className="h-3 w-3" />, tone: "bad" },
  "local-failed": { label: "Not queued", icon: <AlertTriangle className="h-3 w-3" />, tone: "bad" },
  unknown: { label: "Unconfirmed: check LinkedIn", icon: <AlertTriangle className="h-3 w-3" />, tone: "warn" },
  cancelled: { label: "Withdrawn", icon: <X className="h-3 w-3" />, tone: "pending" },
};

function conversationName(c: ThreadData["conversation"]): string {
  if (c.title) return c.title;
  const names = c.participants.map((p) => p.name).filter(Boolean);
  return names.length ? names.join(", ") : (c.last_message_sender ?? "LinkedIn conversation");
}

export function ThreadView({
  conversationId,
  title,
  subtitle,
  compact,
  tick,
  extensionOnline,
  syncing,
  nudge,
  onChanged,
  initialText,
  onSent,
}: {
  conversationId: string;
  /** Who the thread is with, when ARIA knows better than LinkedIn's copy (the candidate's name). */
  title?: string;
  subtitle?: string | null;
  /** Inside the candidate drawer: no header, the drawer already says who it is. */
  compact?: boolean;
  /** Bumped by the live stream: refetch. */
  tick: number;
  extensionOnline: boolean;
  syncing: boolean;
  nudge: () => void;
  onChanged: () => void;
  /** Prefilled message (an approved outreach draft). */
  initialText?: string;
  /** Called with the text once LinkedIn's outbox accepted it. */
  onSent?: (text: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const { toast } = useToast();
  const [data, setData] = React.useState<ThreadData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [locals, setLocals] = React.useState<LocalSend[]>([]);
  const aliases = React.useRef(new Map<string, string>()); // server outbox id -> local key
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const [unseenBelow, setUnseenBelow] = React.useState(0);
  const lastCount = React.useRef(0);
  const lastInbound = React.useRef<string | null>(null);
  const counter = React.useRef(0);

  const load = React.useCallback(async () => {
    const res = await linkedInApi<ThreadData>(`/api/linkedin/conversations/${conversationId}`);
    if (!res.ok) return setError(res.error);
    setError(null);
    setData(res.data);
  }, [conversationId]);

  // Open: fetch, mark seen, and ask the extension for the latest messages now.
  React.useEffect(() => {
    setData(null);
    setLocals([]);
    aliases.current.clear();
    lastCount.current = 0;
    lastInbound.current = null;
    atBottom.current = true;
    void load();
    void linkedInApi("/api/linkedin/conversations", postJson({ conversationId, refresh: true, seen: true })).then(() => {
      nudge();
      onChanged();
    });
  }, [conversationId, load, nudge, onChanged]);

  const firstTick = React.useRef(tick);
  React.useEffect(() => {
    if (tick !== firstTick.current) void load();
  }, [tick, load]);

  // A reply landed while the thread is open and visible: it counts as seen.
  React.useEffect(() => {
    const inbound = data?.messages.filter((m) => m.direction === "inbound").at(-1)?.id ?? null;
    if (inbound && lastInbound.current && inbound !== lastInbound.current && document.visibilityState === "visible") {
      void linkedInApi("/api/linkedin/conversations", postJson({ conversationId, refresh: false, seen: true }));
    }
    lastInbound.current = inbound;
  }, [data, conversationId]);

  async function send(text: string) {
    counter.current += 1;
    const key = `local-${counter.current}-${Date.now()}`;
    atBottom.current = true;
    setLocals((items) => [...items, { key, body: text, createdAt: new Date().toISOString() }]);
    const res = await linkedInApi<{ item: OutboxItem }>("/api/linkedin/outbox", postJson({ conversationId, text }));
    if (!res.ok) {
      setLocals((items) => items.map((i) => (i.key === key ? { ...i, error: res.error } : i)));
      toast({ title: "Message not queued.", description: res.error, variant: "error" });
      return;
    }
    aliases.current.set(res.data.item.id, key);
    onSent?.(text);
    setLocals((items) => items.map((i) => (i.key === key ? { ...i, serverId: res.data.item.id } : i)));
    nudge();
    onChanged();
    void load();
  }

  async function withdraw(serverId: string | null, localKey: string | null) {
    if (serverId) await linkedInApi(`/api/linkedin/outbox?id=${serverId}`, { method: "DELETE" });
    if (localKey) setLocals((items) => items.filter((i) => i.key !== localKey));
    onChanged();
    void load();
  }

  async function retry(body: string, serverId: string | null, localKey: string | null) {
    await withdraw(serverId, localKey);
    await send(body);
  }

  // ── Build the timeline ────────────────────────────────────────────────────
  const entries = React.useMemo<Entry[]>(() => {
    if (!data) return [];
    const keyFor = (id: string) => aliases.current.get(id) ?? id;
    const urnKey = new Map<string, string>();
    for (const item of data.outbox) if (item.status === "sent" && item.sent_message_urn) urnKey.set(item.sent_message_urn, keyFor(item.id));
    const urns = new Set(data.messages.map((m) => m.message_urn));
    const serverIds = new Set(data.outbox.map((o) => o.id));
    const list: Entry[] = [
      ...data.messages.map<Entry>((m) => ({ kind: "message", key: urnKey.get(m.message_urn) ?? m.id, at: m.sent_at, message: m })),
      ...data.outbox
        .filter((o) => o.status !== "cancelled" && !(o.status === "sent" && o.sent_message_urn && urns.has(o.sent_message_urn)))
        .map<Entry>((o) => ({
          kind: "pending",
          key: keyFor(o.id),
          at: o.created_at,
          body: o.body,
          stage: o.status,
          error: o.error,
          serverId: o.id,
          localKey: aliases.current.get(o.id) ?? null,
        })),
      ...locals
        .filter((l) => !l.serverId || !serverIds.has(l.serverId))
        .map<Entry>((l) => ({
          kind: "pending",
          key: l.key,
          at: l.createdAt,
          body: l.body,
          stage: l.error ? "local-failed" : l.serverId ? "queued" : "local",
          error: l.error ?? null,
          serverId: l.serverId ?? null,
          localKey: l.key,
        })),
    ];
    return list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [data, locals]);

  // ── Scrolling: follow the conversation unless the user scrolled up ───────
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !entries.length) return;
    const grew = entries.length > lastCount.current;
    const first = lastCount.current === 0;
    lastCount.current = entries.length;
    if (first || (grew && atBottom.current)) {
      el.scrollTo({ top: el.scrollHeight, behavior: first || reduced ? "auto" : "smooth" });
      setUnseenBelow(0);
    } else if (grew) {
      setUnseenBelow((n) => n + 1);
    }
  }, [entries, reduced]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setUnseenBelow(0);
  }

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-full flex-col gap-3 p-6" aria-busy="true">
        {[60, 40, 70, 50].map((w, i) => (
          <span key={i} className={cn("h-10 animate-pulse rounded-2xl bg-ink/[0.06]", i % 2 ? "self-end" : "self-start")} style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  const conversation = data.conversation;
  const name = title ?? conversationName(conversation);
  const person = conversation.participants.length === 1 ? conversation.participants[0] : null;
  const lastOutboundKey = [...entries].reverse().find((e) => e.kind === "message" && e.message.direction === "outbound")?.key;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className={cn("flex items-center gap-3 border-b border-line px-4 py-3", compact && "py-2")}>
        {!compact && <Avatar name={name} size="lg" />}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold text-ink", compact && "text-sm")}>{compact ? "Conversation" : name}</p>
          {!compact && (
            <p className="truncate text-xs text-muted">
              {subtitle ?? person?.headline ?? (conversation.group_chat ? `${conversation.participants.length} people` : "LinkedIn")}
            </p>
          )}
        </div>
        <span
          className={cn(
            "hidden items-center gap-1.5 text-xs font-medium text-muted transition-opacity duration-300 sm:inline-flex",
            syncing ? "opacity-100" : "opacity-0",
          )}
          aria-live="polite"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", !reduced && syncing && "animate-spin")} aria-hidden />
          {syncing ? "Syncing" : ""}
        </span>
        {!compact && person?.profileUrl && (
          <a href={person.profileUrl} target="_blank" rel="noreferrer" className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/5">
            Profile
          </a>
        )}
        {conversation.thread_url && (
          <a
            href={conversation.thread_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-[#0a66c2] hover:bg-[#0a66c2]/10"
          >
            LinkedIn <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
        {!entries.length && (
          <p className="py-10 text-center text-sm text-muted">
            {conversation.messages_synced_at ? "No messages yet." : "Fetching the conversation from LinkedIn…"}
          </p>
        )}
        <AnimatePresence initial={false}>
          {entries.map((entry, index) => {
            const previous = entries[index - 1];
            const next = entries[index + 1];
            const outbound = entry.kind === "pending" || entry.message.direction === "outbound";
            const sameSide = (other: Entry | undefined) =>
              Boolean(other) &&
              (other!.kind === "pending" || other!.message.direction === "outbound") === outbound &&
              Math.abs(Date.parse(other!.at) - Date.parse(entry.at)) < GROUP_GAP_MS &&
              dayKey(other!.at) === dayKey(entry.at);
            const newDay = !previous || dayKey(previous.at) !== dayKey(entry.at);
            const firstOfGroup = newDay || !sameSide(previous);
            const lastOfGroup = !sameSide(next);
            return (
              <React.Fragment key={entry.key}>
                {newDay && (
                  <div className="my-3 flex justify-center" key={`day-${dayKey(entry.at)}`}>
                    <span className="rounded-full bg-ink/[0.05] px-3 py-0.5 text-[0.7rem] font-semibold text-muted">{dayLabel(entry.at)}</span>
                  </div>
                )}
                <motion.div
                  layout={reduced ? false : "position"}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.26, ease: EASE }}
                  className={cn("flex items-end gap-2", outbound ? "justify-end" : "justify-start", firstOfGroup ? "mt-3" : "mt-1")}
                >
                  {!outbound && (
                    <span className="w-8 shrink-0">{lastOfGroup && <Avatar name={entry.kind === "message" ? (entry.message.sender_name ?? name) : name} size="sm" />}</span>
                  )}
                  <Bubble
                    entry={entry}
                    showSender={!outbound && conversation.group_chat && firstOfGroup}
                    showTime={lastOfGroup}
                    delivered={entry.key === lastOutboundKey}
                    extensionOnline={extensionOnline}
                    onWithdraw={withdraw}
                    onRetry={retry}
                  />
                </motion.div>
              </React.Fragment>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {unseenBelow > 0 && (
          <motion.button
            type="button"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
              setUnseenBelow(0);
            }}
            className="absolute bottom-28 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#0a66c2] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            {unseenBelow === 1 ? "New message" : `${unseenBelow} new messages`}
          </motion.button>
        )}
      </AnimatePresence>

      <Composer
        placeholder={`Message ${(person?.name || name).split(" ")[0]}…`}
        onSend={send}
        initialText={initialText}
        hint={
          extensionOnline
            ? "Leaves from your LinkedIn account within seconds."
            : "The extension is offline: the message leaves as soon as Chrome is back."
        }
      />
    </div>
  );
}

function Bubble({
  entry,
  showSender,
  showTime,
  delivered,
  extensionOnline,
  onWithdraw,
  onRetry,
}: {
  entry: Entry;
  showSender: boolean;
  showTime: boolean;
  delivered: boolean;
  extensionOnline: boolean;
  onWithdraw: (serverId: string | null, localKey: string | null) => void;
  onRetry: (body: string, serverId: string | null, localKey: string | null) => void;
}) {
  if (entry.kind === "message") {
    const m = entry.message;
    const outbound = m.direction === "outbound";
    return (
      <div className={cn("flex max-w-[78%] flex-col", outbound ? "items-end" : "items-start")}>
        {showSender && <span className="mb-0.5 px-1 text-[0.7rem] font-semibold text-muted">{m.sender_name}</span>}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-[background-color,color,box-shadow] duration-500 ease-motion-out",
            outbound ? "rounded-br-md bg-[#0a66c2] text-white shadow-[0_6px_16px_-8px_rgba(10,102,194,0.7)]" : "rounded-bl-md bg-ink/[0.06] text-ink",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
        </div>
        {showTime && (
          <span className="mt-1 inline-flex items-center gap-1 px-1 text-[0.68rem] text-muted">
            {clock(m.sent_at)}
            {outbound && delivered && (
              <>
                <span aria-hidden>·</span>
                <CheckCheck className="h-3 w-3 text-[#0a66c2]" aria-hidden />
                <span>On LinkedIn</span>
              </>
            )}
          </span>
        )}
      </div>
    );
  }

  const stage = STAGE[entry.stage];
  const waiting = (entry.stage === "queued" || entry.stage === "local") && !extensionOnline;
  return (
    <div className="flex max-w-[78%] flex-col items-end">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed transition-[background-color,color,box-shadow] duration-500 ease-motion-out",
          stage.tone === "pending" && "bg-[#0a66c2]/55 text-white",
          stage.tone === "busy" && "bg-[#0a66c2]/80 text-white",
          stage.tone === "done" && "bg-[#0a66c2] text-white",
          stage.tone === "bad" && "bg-danger-soft text-ink ring-1 ring-inset ring-danger/40",
          stage.tone === "warn" && "bg-warning-soft text-ink ring-1 ring-inset ring-warning/40",
        )}
      >
        {stage.tone === "busy" && <span className="li-sending-sheen pointer-events-none absolute inset-0" aria-hidden />}
        <p className="relative whitespace-pre-wrap break-words">{entry.body}</p>
      </div>
      <span
        className={cn(
          "mt-1 inline-flex flex-wrap items-center justify-end gap-1 px-1 text-[0.68rem]",
          stage.tone === "bad" ? "text-danger" : stage.tone === "warn" ? "text-[hsl(32_90%_34%)]" : "text-muted",
        )}
      >
        {stage.icon}
        <span>{waiting ? "Waiting for the extension" : stage.label}</span>
        {entry.error && stage.tone !== "pending" && <span className="max-w-[16rem] truncate" title={entry.error}>· {entry.error}</span>}
        {(entry.stage === "queued" || entry.stage === "local-failed" || entry.stage === "failed" || entry.stage === "unknown") && (
          <button type="button" className="ml-1 font-semibold underline-offset-2 hover:underline" onClick={() => onWithdraw(entry.serverId, entry.localKey)}>
            {entry.stage === "queued" ? "Withdraw" : "Dismiss"}
          </button>
        )}
        {(entry.stage === "failed" || entry.stage === "local-failed") && (
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-0.5 font-semibold text-[#0a66c2] underline-offset-2 hover:underline"
            onClick={() => onRetry(entry.body, entry.serverId, entry.localKey)}
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Try again
          </button>
        )}
      </span>
    </div>
  );
}
