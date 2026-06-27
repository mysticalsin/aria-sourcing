"use client";

import * as React from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Drawer,
  Eyebrow,
  EmptyState,
  Meter,
  SkeletonCard,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { AgentDesk } from "@/components/floor/agent-desk";
import {
  useHydrated,
  useSeats,
  useCampaigns,
  useCandidates,
  useLedger,
  useSettings,
} from "@/lib/store";
import { agentActivity, floorRollup } from "@/lib/floor";
import {
  effectiveDailyCap,
  seatHealthStatus,
  warmupStage,
} from "@/lib/fleet";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { languageLabel } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/utils";
import type { AgentSeat, HermesState } from "@/lib/types";
import { Bot, Users, Activity, PauseCircle, Flame, Mail, Clock, Languages, Building2, ArrowUpRight } from "lucide-react";

export default function FloorPage() {
  const hydrated = useHydrated();
  const seats = useSeats();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const ledger = useLedger();
  const settings = useSettings();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const stateLike = { campaigns, candidates, ledger, seats, settings } as unknown as HermesState;
  const rollup = floorRollup(seats, stateLike);
  const selected = seats.find((s) => s.id === selectedId) ?? null;

  const stats = [
    { label: "On the floor", value: rollup.total, icon: <Users className="h-4 w-4" />, tone: "electric" as const },
    { label: "Working now", value: rollup.working, icon: <Activity className="h-4 w-4" />, tone: "success" as const },
    { label: "Warming up", value: rollup.warming, icon: <Flame className="h-4 w-4" />, tone: "warning" as const },
    { label: "Paused", value: rollup.paused, icon: <PauseCircle className="h-4 w-4" />, tone: "danger" as const },
    { label: "Contacted today", value: rollup.contactedToday, icon: <Mail className="h-4 w-4" />, tone: "violet" as const },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Operations floor"
        title="The agents, at work."
        description="Every Hermes agent on one floor — live status, what they're sourcing right now, and who they're working. Click a desk for the full picture."
        actions={
          <Link
            href="/fleet"
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/12 bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/25"
          >
            Manage fleet
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<FloorFallback />}>
        {/* Floor stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="flex items-center gap-2 text-muted">
                <span className="text-muted">{s.icon}</span>
                <span className="eyebrow">{s.label}</span>
              </div>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{s.value}</p>
            </Card>
          ))}
        </div>

        {seats.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-7 w-7" />}
            title="The floor is empty"
            description="Deploy agents to populate the operations floor."
            action={
              <Link
                href="/fleet"
                className="inline-flex h-11 items-center rounded-full bg-tangerine px-6 text-sm font-semibold text-white shadow-soft hover:bg-tangerine/90"
              >
                Deploy agents
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {seats.map((seat) => (
              <AgentDesk
                key={seat.id}
                seat={seat}
                activity={agentActivity(seat, stateLike)}
                onSelect={(s) => setSelectedId(s.id)}
              />
            ))}
          </div>
        )}
      </HydrationGate>

      <AgentDetailDrawer
        seat={selected}
        state={stateLike}
        open={selected !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function AgentDetailDrawer({
  seat,
  state,
  open,
  onClose,
}: {
  seat: AgentSeat | null;
  state: HermesState;
  open: boolean;
  onClose: () => void;
}) {
  if (!seat) {
    return (
      <Drawer open={false} onClose={onClose} title="Agent">
        <div />
      </Drawer>
    );
  }
  const activity = agentActivity(seat, state);
  const cap = effectiveDailyCap(seat);
  const ws = warmupStage(seat);
  const health = seatHealthStatus(seat, state.settings.fleet);
  const candById = new Map(state.candidates.map((c) => [c.id, c]));
  const touched = state.ledger
    .filter((l) => l.seatId === seat.id)
    .slice(0, 14)
    .map((l) => {
      const c = candById.get(l.candidateId);
      const name = c
        ? state.settings.confidentialityMode && !hasOutreachPurpose(c.stage)
          ? applyConfidentiality(c, { confidentialityMode: true, reveal: false }).name
          : c.name
        : "Candidate";
      return { id: l.id, name, at: l.at, status: l.status };
    });

  return (
    <Drawer open={open} onClose={onClose} title={seat.name} description={`${seat.provider} · ${activity.label}`} width="max-w-xl">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={activity.tone} dot>
            {activity.label}
          </Badge>
          <Badge tone={seat.mode === "live" ? "success" : "neutral"}>{seat.mode}</Badge>
          <Badge tone={health.tone}>{health.label}</Badge>
        </div>

        <Card className="bg-canvas/40">
          <CardContent className="space-y-1">
            <Eyebrow>Working on</Eyebrow>
            <p className="text-sm font-semibold text-ink">{activity.detail}</p>
            {activity.focusName && <p className="text-sm text-muted">Current focus: {activity.focusName}</p>}
          </CardContent>
        </Card>

        <div>
          <Eyebrow className="mb-2 block">Capacity today</Eyebrow>
          <Meter label="Sends" used={seat.sentToday} limit={cap} />
          <p className="mt-1.5 text-xs text-muted">
            {ws.full ? "Fully warmed." : `Warming up — day ${ws.day}, cap ${ws.cap}/day.`}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Meta icon={<Mail className="h-4 w-4" />} label="Mailbox" value={seat.connectedAccount || seat.operatorEmail} />
          <Meta icon={<Building2 className="h-4 w-4" />} label="Provider" value={seat.provider} />
          <Meta icon={<Languages className="h-4 w-4" />} label="Language" value={languageLabel(seat.language ?? "en")} />
          <Meta icon={<Clock className="h-4 w-4" />} label="Send window" value={`${seat.sendWindow.startHour}:00–${seat.sendWindow.endHour}:00 ${seat.sendWindow.timezone}`} />
        </dl>

        <div>
          <Eyebrow className="mb-1 block">Agent prompt</Eyebrow>
          <p className="rounded-2xl bg-ink/[0.04] p-3 text-sm leading-relaxed text-ink-soft">{seat.persona}</p>
        </div>

        <div>
          <Eyebrow className="mb-2 block">Recently worked ({activity.contacted})</Eyebrow>
          {touched.length === 0 ? (
            <p className="text-sm text-muted">No contacts logged yet for this agent.</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {touched.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate font-medium text-ink">{t.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatTimeAgo(t.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          href="/fleet"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-electric hover:underline"
        >
          Manage this agent in the fleet
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </Drawer>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

function FloorFallback() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
