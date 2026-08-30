"use client";

import * as React from "react";
import { Badge, Card, CardContent, EmptyState, Eyebrow, Input } from "@/components/ui";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { useActivities, useBookings, useCandidates, useChats, useHydrated, useSeats } from "@/lib/store";
import { DecisionReplay } from "@/components/sessions/decision-replay";
import { formatTimeAgo, toneForStage } from "@/lib/utils";
import type { Activity } from "@/lib/types";
import { Activity as ActivityIcon, History, MessageSquare, Radar, Search, Users } from "lucide-react";

/** Resolves the candidate a given activity is replayable for. Most
 *  candidate-linked activities carry the candidate id directly, but a
 *  booking activity is logged against the booking's own id (see
 *  createBookingFor in store.ts) — resolve that indirection here too, so
 *  every replayable row in the log opens the right candidate's replay. */
function candidateIdForActivity(a: Activity, bookingCandidateById: Map<string, string>): string | null {
  if (a.linkedEntityType === "candidate") return a.linkedEntityId;
  if (a.linkedEntityType === "booking" && a.linkedEntityId) {
    return bookingCandidateById.get(a.linkedEntityId) ?? null;
  }
  return null;
}

export default function SessionsPage() {
  const hydrated = useHydrated();
  const chats = useChats();
  const activities = useActivities();
  const seats = useSeats();
  const candidates = useCandidates();
  const bookings = useBookings();
  const [q, setQ] = React.useState("");
  const [replayCandidateId, setReplayCandidateId] = React.useState<string | null>(null);

  const seatName = React.useMemo(() => {
    const m = new Map(seats.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) ?? "Agent";
  }, [seats]);

  const bookingCandidateById = React.useMemo(() => new Map(bookings.map((b) => [b.id, b.candidateId])), [bookings]);

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

  const matchedCandidates = React.useMemo(() => {
    const sorted = [...candidates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!needle) return sorted;
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.currentTitle.toLowerCase().includes(needle) ||
        c.currentCompany.toLowerCase().includes(needle),
    );
  }, [candidates, needle]);

  return (
    <HydrationGate
      hydrated={hydrated}
      fallback={
        <EmptyState
          title="Loading sessions…"
          description="Conversations and activity appear after workspace hydrate — no placeholder panels."
        />
      }
    >
      <PageHeader
        eyebrow="System"
        title="Sessions"
        description="Browse and search every agent conversation and the full activity history across the workspace. Open any candidate's Decision Replay to see the full sourced-to-booked chain."
      />

      <div className="relative mb-6 max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search conversations, activity and candidates…"
          className="pl-11"
          aria-label="Search sessions"
        />
      </div>

      {/* Decision Replay — any candidate can be opened here, not just ones
          with a row in the activity log below (e.g. a freshly sourced
          candidate has no candidate-linked activity yet, but still has a
          coherent sourced+scored replay). */}
      <Card className="mb-6">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-aqua" aria-hidden />
            <Eyebrow>Decision Replay</Eyebrow>
            <Badge tone="neutral" size="sm">{matchedCandidates.length}</Badge>
          </div>
          {matchedCandidates.length === 0 ? (
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              title="No candidates"
              description="Source candidates from a campaign to replay their journey here."
            />
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {matchedCandidates.slice(0, 60).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setReplayCandidateId(c.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                      <p className="truncate text-xs text-muted">
                        {c.currentTitle}
                        {c.currentCompany ? ` · ${c.currentCompany}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={toneForStage(c.stage)} size="sm">{c.stage}</Badge>
                      <span className="text-xs text-muted">{formatTimeAgo(c.createdAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
                {acts.slice(0, 60).map((a) => {
                  const replayCandidate = candidateIdForActivity(a, bookingCandidateById);
                  const row = (
                    <>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                        {a.outcome && <p className="truncate text-xs text-muted">{a.outcome}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted">{formatTimeAgo(a.createdAt)}</span>
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {replayCandidate ? (
                        <button
                          type="button"
                          onClick={() => setReplayCandidateId(replayCandidate)}
                          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                        >
                          {row}
                        </button>
                      ) : (
                        <div className="flex items-start justify-between gap-3 px-4 py-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DecisionReplay candidateId={replayCandidateId} onClose={() => setReplayCandidateId(null)} />
    </HydrationGate>
  );
}
