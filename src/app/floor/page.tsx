"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import { AgentBot, botColorForSeat } from "@/components/floor/agent-bot";
import { playSound } from "@/lib/sound";
import {
  useHydrated,
  useSeats,
  useCampaigns,
  useCandidates,
  useLedger,
  useSettings,
  useActions,
} from "@/lib/store";
import { agentActivity, floorRollup } from "@/lib/floor";
import { seatsToOfficeAgents } from "@/lib/floor3d";
import {
  effectiveDailyCap,
  seatHealthStatus,
  warmupStage,
} from "@/lib/fleet";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { languageLabel } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/utils";
import type { AgentSeat, HermesState } from "@/lib/types";
import { Bot, Users, Activity, PauseCircle, Flame, Mail, Clock, Languages, Building2, ArrowUpRight, Volume2, VolumeX, LayoutGrid, Box } from "lucide-react";

const Floor3D = dynamic(() => import("@/components/floor3d/Floor3D"), { ssr: false });

export default function FloorPage() {
  const hydrated = useHydrated();
  const seats = useSeats();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const ledger = useLedger();
  const settings = useSettings();
  const actions = useActions();
  const soundEnabled = settings.soundEnabled;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<"2d" | "3d">("2d");

  const stateLike = { campaigns, candidates, ledger, seats, settings } as unknown as HermesState;
  const rollup = floorRollup(seats, stateLike);
  const selected = seats.find((s) => s.id === selectedId) ?? null;

  const selectAgent = (id: string) => {
    setSelectedId(id);
    playSound("select", soundEnabled);
  };
  const toggleSound = () => {
    const next = !soundEnabled;
    actions.updateSettings({ soundEnabled: next });
    playSound("toggle", next); // confirm with a blip when turning on
  };

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
        description="Every Aria agent on one floor: live status, what they're sourcing right now, and who they're working. Click a desk for the full picture."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
              title={soundEnabled ? "Sound on" : "Sound off (click to enable)"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink/12 bg-surface text-ink-soft transition hover:border-ink/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-electric" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <Link
              href="/fleet"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink/12 bg-surface px-4 text-sm font-semibold text-ink hover:border-ink/25"
            >
              Manage fleet
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
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

        {/* 2D / 3D view toggle */}
        <div className="mb-4 flex gap-2">
          {([
            { mode: "2d" as const, label: "2D grid", icon: <LayoutGrid className="h-4 w-4" /> },
            { mode: "3d" as const, label: "3D floor", icon: <Box className="h-4 w-4" /> },
          ]).map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={[
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition",
                viewMode === mode
                  ? "border-electric bg-electric/10 text-electric"
                  : "border-ink/12 bg-surface text-ink-soft hover:border-ink/25",
              ].join(" ")}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {viewMode === "3d" ? (
          seats.length === 0 ? (
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
            <Floor3DSection
              seats={seats}
              state={stateLike}
              selectedId={selectedId}
              onSelect={(s) => selectAgent(s)}
            />
          )
        ) : seats.length === 0 ? (
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
                onSelect={(s) => selectAgent(s.id)}
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

function Floor3DSection({
  seats,
  state,
  selectedId,
  onSelect,
}: {
  seats: AgentSeat[];
  state: HermesState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Render-cap: a full procedural robot per agent is ~20 meshes; rendering the
  // whole fleet (up to 300) tanks the GPU. Cap the 3D scene to the first N and
  // surface the cap honestly (no silent truncation) — the full fleet lives on
  // the Agent Fleet page.
  const FULL_DETAIL = 48;
  const office = seatsToOfficeAgents(seats, state);
  const proxied = Math.max(0, office.length - FULL_DETAIL);
  return (
    <div className="space-y-3">
      {office.length > 0 && (
        <p className="text-xs text-muted">
          {office.length} agents on the floor in 3D.
          {proxied > 0 &&
            ` Nearest ${FULL_DETAIL} fully animated; ${proxied} more rendered as live instanced proxies for performance.`}{" "}
          <Link href="/fleet" className="font-semibold text-electric hover:underline">
            Manage the full fleet
          </Link>
          .
        </p>
      )}
      <Floor3D agents={office} selectedId={selectedId} onSelect={onSelect} />
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
        <div className="flex justify-center py-1">
          <AgentBot
            color={botColorForSeat(seat.id)}
            size={108}
            busy={activity.busy}
            paused={activity.state === "paused"}
            warming={activity.state === "warming"}
          />
        </div>
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
            {ws.full ? "Fully warmed." : `Warming up: day ${ws.day}, cap ${ws.cap}/day.`}
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
