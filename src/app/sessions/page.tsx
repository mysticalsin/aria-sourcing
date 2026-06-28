"use client";

import * as React from "react";
import { Badge, Card, CardContent, EmptyState, Eyebrow, Input, SkeletonCard } from "@/components/ui";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { useActivities, useChats, useHydrated, useSeats } from "@/lib/store";
import { formatTimeAgo } from "@/lib/utils";
import { Activity as ActivityIcon, History, MessageSquare, Search } from "lucide-react";

export default function SessionsPage() {
  const hydrated = useHydrated();
  const chats = useChats();
  const activities = useActivities();
  const seats = useSeats();
  const [q, setQ] = React.useState("");

  const seatName = React.useMemo(() => {
    const m = new Map(seats.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "Agent";
  }, [seats]);

  const needle = q.trim().toLowerCase();

  const threads = React.useMemo(() => {
    const sorted = [...chats].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    if (!needle) return sorted;
    return sorted.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        seatName(t.seatId).toLowerCase().includes(needle) ||
        t.messages.some((m) => m.content.toLowerCase().includes(needle)),
    );
  }, [chats, needle, seatName]);

  const acts = React.useMemo(() => {
    if (!needle) return activities;
    return activities.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.notes.toLowerCase().includes(needle) ||
        a.outcome.toLowerCase().includes(needle),
    );
  }, [activities, needle]);

  return (
    <HydrationGate hydrated={hydrated} fallback={<div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}>
      <PageHeader
        eyebrow="System"
        title="Sessions"
        description="Browse and search every agent conversation and the full activity history across the workspace."
      />

      <div className="relative mb-6 max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations and activity…"
          className="pl-11"
          aria-label="Search sessions"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Conversations */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-electric" aria-hidden />
              <Eyebrow>Conversations</Eyebrow>
              <Badge tone="neutral" size="sm">{threads.length}</Badge>
            </div>
            {threads.length === 0 ? (
              <EmptyState icon={<MessageSquare className="h-7 w-7" />} title="No conversations" description="Start a chat from the Chat page to see it here." />
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {threads.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{t.title}</p>
                      <p className="truncate text-xs text-muted">
                        {seatName(t.seatId)} · {t.messages.length} message{t.messages.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{formatTimeAgo(t.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Activity log */}
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-violet" aria-hidden />
              <Eyebrow>Activity history</Eyebrow>
              <Badge tone="neutral" size="sm">{acts.length}</Badge>
            </div>
            {acts.length === 0 ? (
              <EmptyState icon={<History className="h-7 w-7" />} title="No activity" description="Operations across the workspace will appear here." />
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {acts.slice(0, 60).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      {a.outcome && <p className="truncate text-xs text-muted">{a.outcome}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted">{formatTimeAgo(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </HydrationGate>
  );
}
