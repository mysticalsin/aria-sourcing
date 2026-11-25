"use client";

import * as React from "react";
import Link from "next/link";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import {
  accountPrompt,
  LINKEDIN_ACCOUNT_SETTINGS_PATH,
  type AccountView,
} from "@/lib/contact-chat/account-view";
import { MessageSquare, UserRound } from "lucide-react";

interface Person {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
}

interface ChatMessage {
  id: string;
  text: string;
  at: string;
}

const EMPTY_ACCOUNT: AccountView = {
  channel: "heyreach",
  enabled: false,
  tokenConfigured: false,
  addAccount: true,
  settingsPath: LINKEDIN_ACCOUNT_SETTINGS_PATH,
};

export function ContactChat() {
  const [ready, setReady] = React.useState(false);
  const [account, setAccount] = React.useState<AccountView>(EMPTY_ACCOUNT);
  const [people, setPeople] = React.useState<Person[]>([]);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [noticePath, setNoticePath] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadAccount = React.useCallback(async () => {
    const res = await fetch("/api/contacts/account", { cache: "no-store" });
    const body = (await res.json()) as { account?: AccountView };
    if (body.account) setAccount(body.account);
  }, []);

  const runSearch = React.useCallback(async (nextQuery: string) => {
    const res = await fetch("/api/contacts/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: nextQuery }),
    });
    const body = (await res.json()) as { people?: Person[] };
    const list = Array.isArray(body.people) ? body.people : [];
    setPeople(list);
    setSelectedId((current) => (current && list.some((person) => person.id === current) ? current : list[0]?.id ?? null));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([loadAccount(), runSearch("")]);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccount, runSearch]);

  React.useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void fetch(`/api/contacts/thread?personId=${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { messages?: ChatMessage[] }) => {
        if (!cancelled) setMessages(Array.isArray(body.messages) ? body.messages : []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const prompt = accountPrompt(account);
  const selected = people.find((person) => person.id === selectedId) ?? null;

  async function approve() {
    if (!selectedId || !draft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contacts/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: selectedId, text: draft }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string };
      setNotice(body.ok ? "Exact text approved. Send uses this text only." : body.message ?? "Could not approve this text.");
      setNoticePath(null);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!selectedId || !draft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contacts/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: selectedId, text: draft }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        message?: string;
        settingsPath?: string;
        messages?: ChatMessage[];
        account?: AccountView;
      };
      if (body.account) setAccount(body.account);
      if (!body.ok) {
        setNotice(body.message ?? "Send refused.");
        setNoticePath(body.settingsPath ?? null);
        return;
      }
      setMessages(body.messages ?? []);
      setDraft("");
      setNotice("Sent through HeyReach.");
      setNoticePath(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HydrationGate hydrated={ready} fallback={<Card><CardContent>Loading contacts…</CardContent></Card>}>
      <PageHeader
        eyebrow="Operate"
        title="Contacts"
        description="One thread per person. Type a message, approve that exact text, then send it through HeyReach."
      />
      {prompt && (
        <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink" data-testid="account-prompt">
          <p>{prompt.message}</p>
          <Link
            href={prompt.settingsPath}
            className="mt-1 inline-block font-semibold text-electric underline-offset-2 hover:underline"
            data-testid={prompt.tone === "account" ? "add-account" : "turn-on-heyreach"}
          >
            {prompt.tone === "account" ? "Add your account" : "Open HeyReach settings"}
          </Link>
        </div>
      )}
      <div className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col overflow-hidden rounded-3xl border border-violet/10 bg-surface/60 md:flex-row">
        <div className="flex max-h-56 shrink-0 flex-col border-b border-violet/10 md:max-h-none md:w-72 md:border-b-0 md:border-r">
          <form
            className="border-b border-violet/10 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(query);
            }}
          >
            <label htmlFor="people-search" className="text-xs font-bold uppercase tracking-wider text-ink-soft">
              People
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="people-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people"
                className="h-9 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
              />
              <Button type="submit" size="sm" variant="outline">Search</Button>
            </div>
          </form>
          <ul className="flex-1 overflow-y-auto" data-testid="people-list" aria-label="People">
            {people.length === 0 && (
              <li className="px-4 py-6 text-sm text-muted">No people match that search.</li>
            )}
            {people.map((person) => {
              const active = person.id === selectedId;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(person.id);
                      setDraft("");
                      setNotice(null);
                      setNoticePath(null);
                    }}
                    className={active ? "w-full bg-violet/10 px-4 py-3 text-left" : "w-full px-4 py-3 text-left hover:bg-violet/[0.06]"}
                    aria-current={active ? "true" : undefined}
                  >
                    <span className="block text-sm font-semibold text-ink">{person.name}</span>
                    <span className="block text-xs text-muted">{person.title} · {person.company}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-violet/10 px-4 py-3">
                <UserRound className="h-5 w-5 text-muted" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{selected.name}</p>
                  <p className="text-xs text-muted">{selected.title} · {selected.location}</p>
                </div>
                <Badge tone="neutral" size="sm">One thread</Badge>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="contact-thread">
                {messages.length === 0 && (
                  <p className="text-sm text-muted">No messages yet. Type one below.</p>
                )}
                {messages.map((message) => (
                  <div key={message.id} className="ml-auto max-w-[80%] rounded-2xl bg-ink px-3 py-2 text-sm text-paper">
                    {message.text}
                  </div>
                ))}
              </div>
              <form
                className="border-t border-violet/10 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="contact-composer" className="text-xs font-semibold text-ink-soft">
                  Message to {selected.name}
                </label>
                <textarea
                  id="contact-composer"
                  data-testid="contact-composer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink"
                  placeholder="Type a message"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy || draft.trim().length === 0} onClick={() => void approve()}>
                    Approve exact text
                  </Button>
                  <Button type="submit" size="sm" data-testid="contact-send" disabled={busy || draft.trim().length === 0}>
                    Send
                  </Button>
                </div>
                {notice && (
                  <p className="mt-2 text-sm text-ink" role="status" data-testid="send-notice">
                    {notice}{" "}
                    {noticePath && (
                      <Link href={noticePath} className="font-semibold text-electric underline-offset-2 hover:underline">
                        Open settings
                      </Link>
                    )}
                  </p>
                )}
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <MessageSquare className="mb-3 h-10 w-10 text-muted" />
              <p className="text-sm font-semibold text-ink-soft">Pick a person to open their thread.</p>
            </div>
          )}
        </div>
      </div>
    </HydrationGate>
  );
}
