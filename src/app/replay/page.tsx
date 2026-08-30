"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Rewind, Users } from "lucide-react";
import { Badge, Eyebrow, EmptyState } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { RunTimeline } from "@/components/replay/run-timeline";
import {
  useHydrated,
  useCandidates,
  useOutreach,
  useReplies,
  useBookings,
  useReports,
  useActivities,
  useSeats,
  useLedger,
  useSettings,
} from "@/lib/store";
import { buildEventStream, replayStateAt, type ReplayEvent, type ReplayEventKind } from "@/lib/replay";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { toneForStage, formatDateTime, initialsFrom } from "@/lib/utils";

/* ============================================================================
   3.3 Autopilot Replay (DVR) — scrub the agents' whole day. Purely a read/
   derived view: buildEventStream + replayStateAt (src/lib/replay.ts) turn
   existing candidate/outreach/reply/booking/report history into a time-
   ordered stream, precomputed once per store-state and binary-searched on
   every cursor change — no store writes happen anywhere on this page.
   ========================================================================== */

const Floor3D = dynamic(() => import("@/components/floor3d/Floor3D"), { ssr: false });

const KIND_LABEL: Record<ReplayEventKind, string> = {
  source: "Sourced",
  score: "Scored",
  draft: "Drafted",
  approve: "Approved",
  reply: "Replied",
  book: "Booked",
  report: "Reported",
};

export default function ReplayPage() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const outreach = useOutreach();
  const replies = useReplies();
  const bookings = useBookings();
  const reports = useReports();
  const activities = useActivities();
  const seats = useSeats();
  const ledger = useLedger();
  const settings = useSettings();

  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  // null = "follow the end of the stream" (fully revealed) until the operator
  // drags the playhead for the first time, at which point it's pinned.
  const [cursorMs, setCursorMs] = React.useState<number | null>(null);

  // Narrow "stateLike" object — same convention /floor uses (src/app/floor/
  // page.tsx) to assemble exactly the slice of state a helper needs from
  // selector hooks. Memoized so its identity only changes when one of the
  // underlying arrays actually changes (store selectors return stable
  // references between renders that don't touch that slice), which is what
  // lets replay.ts's internal WeakMap cache turn every cursor-only re-render
  // into an O(1) cache hit instead of rebuilding the whole event stream.
  const stateLike = React.useMemo(
    () => ({ candidates, outreach, replies, bookings, reports, activities, seats, ledger }),
    [candidates, outreach, replies, bookings, reports, activities, seats, ledger],
  );

  const stream = React.useMemo(() => buildEventStream(stateLike), [stateLike]);
  const minMs = stream[0]?.at ?? Date.now();
  const maxMs = stream.length > 0 ? stream[stream.length - 1].at : minMs;
  const effectiveCursor = cursorMs ?? maxMs;

  const derived = React.useMemo(
    () => replayStateAt(stateLike, effectiveCursor),
    [stateLike, effectiveCursor],
  );

  const lastEventByCandidate = React.useMemo(() => {
    const map = new Map<string, ReplayEvent>();
    // Events are chronological, so the last write for a given candidateId
    // is always its most recent revealed event.
    for (const e of derived.events) {
      if (e.candidateId) map.set(e.candidateId, e);
    }
    return map;
  }, [derived.events]);

  const revealedCandidates = React.useMemo(
    () =>
      candidates
        .filter((c) => derived.revealedCandidateIds.has(c.id))
        .sort((a, b) => (lastEventByCandidate.get(b.id)?.at ?? 0) - (lastEventByCandidate.get(a.id)?.at ?? 0)),
    [candidates, derived.revealedCandidateIds, lastEventByCandidate],
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Ops Floor"
        title="Autopilot Replay"
        description="Drag the playhead to scrub the agents' whole day. Candidates reveal themselves as they were sourced, scored, drafted, approved, replied to and booked, while the floor re-enacts it in lockstep. Read-only: nothing here sends or mutates anything."
      />
      <HydrationGate
        hydrated={hydrated}
        fallback={
          <EmptyState
            title="Loading replay…"
            description="Autopilot timeline appears after workspace hydrate — no placeholder stage."
          />
        }
      >
        {stream.length === 0 ? (
          <EmptyState
            icon={<Rewind className="h-7 w-7" aria-hidden />}
            title="Nothing to replay yet"
            description="The replay reconstructs itself from real candidate, outreach, reply and booking history. Source and work a campaign first."
            action={
              <Link
                href="/campaigns"
                className="inline-flex h-11 items-center rounded-full bg-tangerine px-6 text-sm font-semibold text-white shadow-soft hover:bg-tangerine/90"
              >
                Go to Campaigns
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-line bg-surface/60 p-4">
                <RunTimeline
                  events={stream}
                  minMs={minMs}
                  maxMs={maxMs}
                  cursorMs={effectiveCursor}
                  onScrub={setCursorMs}
                  soundEnabled={settings.soundEnabled}
                />
                <p className="mt-3 text-xs text-muted">
                  {formatDateTime(new Date(effectiveCursor).toISOString())} ·{" "}
                  {derived.events.length} of {stream.length} events revealed
                </p>
              </div>
              {/* `agents` is required by Floor3DProps but never actually shown here —
                  /replay always drives the scene through the additive `agentsOverride`
                  prop (src/components/floor3d/Floor3D.tsx) with the derived history
                  reconstruction, never the live fleet. */}
              <Floor3D
                agents={[]}
                agentsOverride={derived.agents}
                selectedId={selectedAgentId}
                onSelect={setSelectedAgentId}
              />
            </div>
            <div className="flex flex-col gap-3">
              <Eyebrow>Revealed candidates ({revealedCandidates.length})</Eyebrow>
              {revealedCandidates.length === 0 ? (
                <EmptyState
                  icon={<Users className="h-6 w-6" aria-hidden />}
                  title="Nothing revealed yet"
                  description="Drag the playhead forward to reveal candidates."
                />
              ) : (
                <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
                  {revealedCandidates.map((raw) => {
                    const c = applyConfidentiality(raw, {
                      confidentialityMode: settings.confidentialityMode,
                      reveal: hasOutreachPurpose(raw.stage),
                    });
                    const lastEvent = lastEventByCandidate.get(raw.id);
                    return (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-line bg-surface/60 p-3 animate-fade-in"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/5 text-xs font-bold text-ink-soft">
                            {c.avatarInitials || initialsFrom(c.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                              <Badge tone={toneForStage(c.stage)} size="sm" dot>
                                {c.stage}
                              </Badge>
                            </div>
                            <p className="truncate text-xs text-muted">
                              {c.currentTitle} · {c.currentCompany}
                            </p>
                            {lastEvent && (
                              <p className="mt-1 truncate text-xs text-ink-soft">
                                {KIND_LABEL[lastEvent.kind]}: {lastEvent.label}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </HydrationGate>
    </div>
  );
}
