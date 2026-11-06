"use client";

import * as React from "react";
import { Badge, Button, Card, EmptyState, Input, Textarea, useConfirm, useToast } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { AlertTriangle, Copy, Inbox, Linkedin, PenSquare, Plug, RefreshCw, Send, Unplug, X } from "lucide-react";

/* Experimental LinkedIn inbox. Everything shown here is synced by the ARIA
 * LinkedIn Bridge extension running in the user's own browser; every message
 * leaves only when the user clicks Send. See extensions/linkedin-bridge. */

type Participant = { memberId: string | null; name: string; profileUrl: string | null; headline: string | null };

type Conversation = {
  id: string;
  title: string | null;
  participants: Participant[];
  group_chat: boolean;
  last_activity_at: string | null;
  unread: boolean;
  last_message_preview: string | null;
  messages_synced_at: string | null;
};

type Message = { id: string; sender_name: string | null; direction: "inbound" | "outbound"; body: string; sent_at: string };

type OutboxItem = {
  id: string;
  conversation_id: string | null;
  recipient_public_id: string | null;
  recipient_name: string | null;
  body: string;
  status: "queued" | "resolving" | "sending" | "sent" | "failed" | "unknown" | "cancelled";
  error: string | null;
  created_at: string;
  sent_at: string | null;
};

type AccountInfo = {
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

type Status =
  | { kind: "loading" }
  | { kind: "disabled"; detail: string }
  | { kind: "unavailable"; detail: string }
  | {
      kind: "ready";
      paired: boolean;
      account: AccountInfo | null;
      policy: { dailySendCap: number; sentLast24h: number; minSendIntervalSeconds?: number };
    };

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; disabled: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error: String(json.detail ?? json.error ?? `HTTP ${res.status}`),
        disabled: json.error === "linkedin_bridge_disabled",
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "ARIA is not reachable.", disabled: false };
  }
}

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000 && new Date().getDate() === date.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function conversationName(c: Conversation): string {
  if (c.title) return c.title;
  const names = c.participants.map((p) => p.name).filter(Boolean);
  return names.length ? names.join(", ") : "LinkedIn conversation";
}

const STATUS_LABEL: Record<OutboxItem["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  queued: { label: "Waiting for the extension", tone: "neutral" },
  resolving: { label: "Looking up the profile", tone: "neutral" },
  sending: { label: "Sending", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Not sent", tone: "danger" },
  unknown: { label: "Unconfirmed", tone: "warning" },
  cancelled: { label: "Withdrawn", tone: "neutral" },
};

// ── Connection ───────────────────────────────────────────────────────────────

function ConnectionPanel({ status, onChanged }: { status: Extract<Status, { kind: "ready" }>; onChanged: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [token, setToken] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const account = status.account;

  async function pair() {
    setBusy(true);
    const res = await api<{ token: string }>("/api/linkedin/account", { method: "POST" });
    setBusy(false);
    if (!res.ok) return toast({ title: "Pairing failed.", description: res.error, variant: "error" });
    setToken(res.data.token);
    onChanged();
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect LinkedIn?",
      description: "The extension stops syncing and every LinkedIn conversation stored in ARIA for you is deleted.",
      confirmLabel: "Disconnect and delete",
      danger: true,
    });
    if (!ok) return;
    const res = await api("/api/linkedin/account", { method: "DELETE" });
    if (!res.ok) return toast({ title: "Disconnect failed.", description: res.error, variant: "error" });
    setToken(null);
    onChanged();
  }

  const stateLine = !status.paired
    ? { tone: "neutral" as const, text: "Not connected" }
    : account?.online
      ? account.sessionPresent
        ? { tone: "success" as const, text: account.displayName ? `Connected as ${account.displayName}` : "Extension online" }
        : { tone: "warning" as const, text: "Extension online, not signed in to LinkedIn" }
      : { tone: "warning" as const, text: account?.lastSeenAt ? `Extension offline (last seen ${when(account.lastSeenAt)})` : "Waiting for the extension" };

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Linkedin className="h-4 w-4 text-[#0a66c2]" aria-hidden />
            <span className="font-semibold text-ink">LinkedIn bridge</span>
            <Badge tone={stateLine.tone} dot>
              {stateLine.text}
            </Badge>
          </div>
          {status.paired && account && (
            <p className="mt-1 text-sm text-muted">
              {account.lastInboxSyncAt ? `Inbox synced ${when(account.lastInboxSyncAt)}` : "Inbox not synced yet"}
              {` · ${status.policy.sentLast24h}/${status.policy.dailySendCap} messages sent in the last 24 h`}
              {account.extensionVersion ? ` · extension ${account.extensionVersion}` : ""}
            </p>
          )}
          {account?.lastError && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {account.lastError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant={status.paired ? "outline" : "primary"} size="sm" leftIcon={<Plug className="h-4 w-4" />} loading={busy} onClick={pair}>
            {status.paired ? "New pairing code" : "Connect the extension"}
          </Button>
          {status.paired && (
            <Button variant="ghost" size="sm" leftIcon={<Unplug className="h-4 w-4" />} onClick={disconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {token && (
        <div className="mt-4 rounded-lg border border-line bg-ink/[0.03] p-4 text-sm">
          <p className="font-semibold text-ink">Pairing code (shown once)</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={token} className="h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Copy className="h-4 w-4" />}
              onClick={() => void navigator.clipboard.writeText(token).then(() => toast({ title: "Pairing code copied.", variant: "success" }))}
            >
              Copy
            </Button>
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted">
            <li>
              In Chrome, open <span className="font-mono">chrome://extensions</span>, turn on Developer mode, then &quot;Load unpacked&quot; and
              pick the <span className="font-mono">extensions/linkedin-bridge</span> folder of the ARIA repository.
            </li>
            <li>Open the extension, keep the ARIA address ({typeof window === "undefined" ? "" : window.location.origin}), paste this code, Save.</li>
            <li>Stay signed in to linkedin.com in the same Chrome profile. The first sync starts within a minute.</li>
          </ol>
        </div>
      )}
    </Card>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  placeholder,
  disabled,
  onSend,
  initial = "",
}: {
  placeholder: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
  initial?: string;
}) {
  const [text, setText] = React.useState(initial);
  const [sending, setSending] = React.useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    const ok = await onSend(text);
    setSending(false);
    if (ok) setText("");
  }
  return (
    <form onSubmit={submit} className="border-t border-line p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={8000}
        className="min-h-[88px]"
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">Sent from your LinkedIn account by the extension. ⌘/Ctrl + Enter to send.</span>
        <Button type="submit" size="sm" leftIcon={<Send className="h-4 w-4" />} loading={sending} disabled={disabled || !text.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}

function OutboxLine({ item, onCancel, onRetry }: { item: OutboxItem; onCancel: (id: string) => void; onRetry?: (item: OutboxItem) => void }) {
  const meta = STATUS_LABEL[item.status];
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-dashed border-[#0a66c2]/40 bg-[#0a66c2]/[0.06] px-3.5 py-2 text-sm">
        <p className="whitespace-pre-wrap break-words text-ink">{item.body}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
          {item.error && <span className="text-xs text-danger">{item.error}</span>}
          {(item.status === "queued" || item.status === "failed" || item.status === "unknown") && (
            <button type="button" className="text-xs font-semibold text-muted underline" onClick={() => onCancel(item.id)}>
              {item.status === "queued" ? "Withdraw" : "Dismiss"}
            </button>
          )}
          {item.status === "failed" && onRetry && (
            <button type="button" className="text-xs font-semibold text-[#0a66c2] underline" onClick={() => onRetry(item)}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────

function Thread({ conversationId, canSend, onQueued }: { conversationId: string; canSend: boolean; onQueued: () => void }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<{ conversation: Conversation; messages: Message[]; outbox: OutboxItem[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  const lastCount = React.useRef(0);

  const load = React.useCallback(async () => {
    const res = await api<{ conversation: Conversation; messages: Message[]; outbox: OutboxItem[] }>(`/api/linkedin/conversations/${conversationId}`);
    if (!res.ok) return setError(res.error);
    setError(null);
    setData(res.data);
  }, [conversationId]);

  React.useEffect(() => {
    setData(null);
    lastCount.current = 0;
    void load();
    void api("/api/linkedin/conversations", { method: "POST", body: JSON.stringify({ conversationId }) });
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [conversationId, load]);

  React.useEffect(() => {
    const count = (data?.messages.length ?? 0) + (data?.outbox.length ?? 0);
    if (count !== lastCount.current) bottom.current?.scrollIntoView({ block: "end" });
    lastCount.current = count;
  }, [data]);

  async function send(text: string): Promise<boolean> {
    const res = await api("/api/linkedin/outbox", { method: "POST", body: JSON.stringify({ conversationId, text }) });
    if (!res.ok) {
      toast({ title: "Message not queued.", description: res.error, variant: "error" });
      return false;
    }
    onQueued();
    await load();
    return true;
  }

  async function cancel(id: string) {
    await api(`/api/linkedin/outbox?id=${id}`, { method: "DELETE" });
    await load();
  }

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const people = data.conversation.participants;
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="font-semibold text-ink">{conversationName(data.conversation)}</p>
        {people.length === 1 && (
          <p className="truncate text-xs text-muted">
            {people[0].headline}
            {people[0].profileUrl && (
              <>
                {people[0].headline ? " · " : ""}
                <a href={people[0].profileUrl} target="_blank" rel="noreferrer" className="underline">
                  Profile
                </a>
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!data.messages.length && (
          <p className="text-sm text-muted">{data.conversation.messages_synced_at ? "No messages." : "Messages arrive with the next sync (up to a minute)."}</p>
        )}
        {data.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                m.direction === "outbound" ? "rounded-br-sm bg-[#0a66c2] text-white" : "rounded-bl-sm bg-ink/[0.06] text-ink",
              )}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={cn("mt-1 text-[11px]", m.direction === "outbound" ? "text-white/70" : "text-muted")}>
                {m.direction === "inbound" && data.conversation.group_chat ? `${m.sender_name} · ` : ""}
                {when(m.sent_at)}
              </p>
            </div>
          </div>
        ))}
        {data.outbox.map((item) => (
          <OutboxLine key={item.id} item={item} onCancel={cancel} onRetry={(i) =>
              void send(i.body).then((ok) => {
                if (ok) void cancel(i.id);
              })
            }
          />
        ))}
        <div ref={bottom} />
      </div>
      <Composer placeholder="Write a reply…" disabled={!canSend} onSend={send} />
    </div>
  );
}

// ── New message ──────────────────────────────────────────────────────────────

function NewMessage({ initialUrl, candidateId, canSend, onDone }: { initialUrl: string; candidateId: string | null; canSend: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [profileUrl, setProfileUrl] = React.useState(initialUrl);
  async function send(text: string): Promise<boolean> {
    const res = await api("/api/linkedin/outbox", {
      method: "POST",
      body: JSON.stringify({ profileUrl, text, ...(candidateId ? { candidateId } : {}) }),
    });
    if (!res.ok) {
      toast({ title: "Message not queued.", description: res.error, variant: "error" });
      return false;
    }
    toast({ title: "Message queued.", description: "The extension sends it on its next pass (within a minute or two).", variant: "success" });
    onDone();
    return true;
  }
  return (
    <div className="flex h-full min-h-[480px] flex-col">
      <div className="border-b border-line px-4 py-3">
        <p className="font-semibold text-ink">New LinkedIn message</p>
        <p className="text-xs text-muted">
          Works for your 1st-degree connections. Others need InMail or a connection request, which LinkedIn will refuse here.
        </p>
      </div>
      <div className="p-4">
        <label htmlFor="li-profile" className="mb-1.5 block text-sm font-semibold text-ink">
          Profile URL
        </label>
        <Input id="li-profile" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.linkedin.com/in/jane-doe/" />
      </div>
      <div className="flex-1" />
      <Composer placeholder="Write your message…" disabled={!canSend || !profileUrl.trim()} onSend={send} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LinkedInPage() {
  const [status, setStatus] = React.useState<Status>({ kind: "loading" });
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [outbox, setOutbox] = React.useState<OutboxItem[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [composeTo, setComposeTo] = React.useState<{ url: string; candidateId: string | null } | null>(null);
  const [query, setQuery] = React.useState("");

  const refresh = React.useCallback(async () => {
    const account = await api<{ paired: boolean; account?: AccountInfo; policy: { dailySendCap: number; sentLast24h: number } }>(
      "/api/linkedin/account",
    );
    if (!account.ok) {
      setStatus(account.disabled ? { kind: "disabled", detail: account.error } : { kind: "unavailable", detail: account.error });
      return;
    }
    setStatus({ kind: "ready", paired: account.data.paired, account: account.data.account ?? null, policy: account.data.policy });
    if (!account.data.paired) {
      setConversations([]);
      setOutbox([]);
      return;
    }
    const [list, out] = await Promise.all([
      api<{ conversations: Conversation[] }>("/api/linkedin/conversations"),
      api<{ items: OutboxItem[] }>("/api/linkedin/outbox"),
    ]);
    if (list.ok) setConversations(list.data.conversations);
    if (out.ok) setOutbox(out.data.items);
  }, []);

  React.useEffect(() => {
    // Deep link from a candidate: /linkedin?to=<profile url>&candidate=<id>
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    if (to) setComposeTo({ url: to, candidateId: params.get("candidate") });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function syncNow() {
    await api("/api/linkedin/conversations", { method: "POST", body: JSON.stringify({}) });
    await refresh();
  }

  const header = (
    <PageHeader
      eyebrow="Engage · experimental"
      title="LinkedIn"
      description="Your LinkedIn inbox, synced by the ARIA extension in your own browser. A message leaves only when you click Send."
      actions={
        status.kind === "ready" && status.paired ? (
          <>
            <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={syncNow}>
              Sync now
            </Button>
            <Button
              size="sm"
              leftIcon={<PenSquare className="h-4 w-4" />}
              onClick={() => {
                setSelected(null);
                setComposeTo({ url: "", candidateId: null });
              }}
            >
              New message
            </Button>
          </>
        ) : null
      }
    />
  );

  if (status.kind === "loading") return <div>{header}<p className="text-sm text-muted">Loading…</p></div>;
  if (status.kind === "disabled" || status.kind === "unavailable") {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Linkedin className="h-6 w-6" />}
          title={status.kind === "disabled" ? "The LinkedIn bridge is turned off" : "The LinkedIn bridge is unavailable"}
          description={
            status.kind === "disabled"
              ? "Add LINKEDIN_BRIDGE_ENABLED=true to .env.local, restart the app (Docker: docker compose up -d app), then reload."
              : status.detail
          }
        />
      </div>
    );
  }

  const canSend = status.paired;
  const unsentElsewhere = outbox.filter((o) => !o.conversation_id && o.status !== "sent");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? conversations.filter((c) => `${conversationName(c)} ${c.last_message_preview ?? ""}`.toLowerCase().includes(needle))
    : conversations;

  return (
    <div>
      {header}
      <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(32_90%_34%)]" aria-hidden />
        LinkedIn&apos;s User Agreement forbids automated access. This experiment runs on your own account at your own risk: LinkedIn may
        restrict it.
      </p>
      <ConnectionPanel status={status} onChanged={() => void refresh()} />

      {status.paired && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Card className="flex max-h-[70vh] flex-col overflow-hidden">
            <div className="border-b border-line p-3">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" className="h-9" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {!shown.length && (
                <p className="p-4 text-sm text-muted">
                  {conversations.length ? "No match." : "No conversation synced yet. Keep the extension running and signed in to LinkedIn."}
                </p>
              )}
              {shown.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setComposeTo(null);
                    setSelected(c.id);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left hover:bg-ink/[0.03]",
                    selected === c.id && "bg-[#0a66c2]/[0.07]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#0a66c2]" aria-label="Unread" />}
                    <span className={cn("truncate text-sm text-ink", c.unread ? "font-bold" : "font-semibold")}>{conversationName(c)}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{when(c.last_activity_at)}</span>
                  </span>
                  <span className="truncate text-xs text-muted">{c.last_message_preview ?? ""}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden">
            {composeTo ? (
              <div className="relative">
                <button type="button" aria-label="Close" className="absolute right-3 top-3 text-muted hover:text-ink" onClick={() => setComposeTo(null)}>
                  <X className="h-4 w-4" />
                </button>
                <NewMessage
                  initialUrl={composeTo.url}
                  candidateId={composeTo.candidateId}
                  canSend={canSend}
                  onDone={() => {
                    setComposeTo(null);
                    void refresh();
                  }}
                />
              </div>
            ) : selected ? (
              <Thread conversationId={selected} canSend={canSend} onQueued={() => void refresh()} />
            ) : (
              <EmptyState icon={<Inbox className="h-6 w-6" />} title="Pick a conversation" description="Or start a new message to one of your connections." className="py-24" />
            )}
          </Card>
        </div>
      )}

      {unsentElsewhere.length > 0 && (
        <Card className="mt-6 p-5">
          <p className="mb-3 font-semibold text-ink">New conversations in progress</p>
          <div className="space-y-2">
            {unsentElsewhere.map((item) => (
              <div key={item.id}>
                <p className="mb-1 text-right text-xs text-muted">To {item.recipient_name ?? item.recipient_public_id ?? "LinkedIn member"}</p>
                <OutboxLine
                  item={item}
                  onCancel={(id) => void api(`/api/linkedin/outbox?id=${id}`, { method: "DELETE" }).then(() => refresh())}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
