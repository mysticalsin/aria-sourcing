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
import { AgentCortex } from "@/components/floor/agent-cortex";
import { MissionControlHud } from "@/components/floor/mission-control-hud";
import { playSound } from "@/lib/sound";
import {
  useHydrated,
  useSeats,
  useCampaigns,
  useCandidates,
  useLedger,
  useSuppression,
  useSettings,
  useActions,
} from "@/lib/store";
import { agentActivity, floorRollup } from "@/lib/floor";
import { seatsToOfficeAgents } from "@/lib/floor3d";
import { getDeviceQuality, MAX_3D_AGENTS } from "@/lib/device";
import {
  effectiveDailyCap,
  seatHealthStatus,
  warmupStage,
} from "@/lib/fleet";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { languageLabel } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/utils";
import type { AgentSeat, HermesState } from "@/lib/types";
import { subscribe, recentEvents, type AgentEvent } from "@/lib/agent-events";
import {
  EVENT_COLOR,
  EVENT_SOUND,
  PULSE_MS,
  pickResponderIndex,
  describeEvent,
} from "@/components/floor3d/retro/scene/packet-shared";
import { Bot, Users, Activity, PauseCircle, Flame, Mail, Clock, Languages, Building2, ArrowUpRight, Volume2, VolumeX, LayoutGrid, Box, Radio, Brain } from "lucide-react";

/** Recent events shown in the 2D activity ticker (guaranteed fallback). */
const TICKER_CAP = 8;

const Floor3D = dynamic(() => import("@/components/floor3d/Floor3D"), { ssr: false });

export default function FloorPage() {
  const hydrated = useHydrated();
  const seats = useSeats();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const ledger = useLedger();
  const suppression = useSuppression();
  const settings = useSettings();
  const actions = useActions();
  const soundEnabled = settings.soundEnabled;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Which panel the selection drawer shows — "overview" (AgentDetailDrawer,
  // unchanged) or "cortex" (3.2 Glass Cortex). Mutually exclusive so only one
  // Drawer is ever mounted open at a time; resets to "overview" whenever the
  // selection changes so switching agents doesn't leave the wrong pane open.
  const [drawerView, setDrawerView] = React.useState<"overview" | "cortex">("overview");
  const [viewMode, setViewMode] = React.useState<"2d" | "3d">("2d");

  // Device tier — cheap, deterministic per session (src/lib/device.ts).
  // "low" already folds in prefers-reduced-motion, so gating sound on "high"
  // alone satisfies both halves of "hard-gate 3D FX + reduced-motion";
  // PacketFX (RetroOfficeScene.tsx) gates its own packets the same way.
  const [deviceQuality] = React.useState(() => getDeviceQuality());
  const fxSoundEnabled = deviceQuality === "high";

  // Live activity ticker — the guaranteed 2D fallback for the event bus.
  // Seeded from the bounded ring buffer so navigating to /floor after
  // triggering an action elsewhere still shows it.
  const [ticker, setTicker] = React.useState<AgentEvent[]>(() =>
    recentEvents().slice(-TICKER_CAP),
  );
  // Seat ids currently "pulsing" — forces their 3D status to "working" so
  // the existing agentTick walk-to-desk animation fires (no agentTick edits).
  const pulseUntilRef = React.useRef<Map<string, number>>(new Map());
  const soundEnabledRef = React.useRef(soundEnabled);
  const seatsRef = React.useRef(seats);
  React.useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  React.useEffect(() => {
    seatsRef.current = seats;
  }, [seats]);

  React.useEffect(() => {
    const now = Date.now();
    for (const e of recentEvents()) {
      if (e.at <= now - PULSE_MS) continue;
      const employees = seatsRef.current.slice(1); // index 0 = CEO (src/lib/floor3d.ts)
      if (employees.length === 0) continue;
      const seat = employees[pickResponderIndex(e, employees.length)];
      pulseUntilRef.current.set(seat.id, e.at + PULSE_MS);
    }

    const unsubscribe = subscribe((e) => {
      setTicker((prev) => [...prev, e].slice(-TICKER_CAP));
      const employees = seatsRef.current.slice(1);
      if (employees.length > 0) {
        const seat = employees[pickResponderIndex(e, employees.length)];
        pulseUntilRef.current.set(seat.id, Date.now() + PULSE_MS);
      }
      if (fxSoundEnabled && soundEnabledRef.current) {
        playSound(EVENT_SOUND[e.kind], true);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Force a re-render every second so an expired pulse lets go of the forced
  // "working" status. agentTick's own DESK_STICKY_MS (10s) keeps the walk/sit
  // animation going well past this window, so nothing snaps back visibly.
  const [, forcePulseTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      for (const [seatId, until] of pulseUntilRef.current) {
        if (until <= now) pulseUntilRef.current.delete(seatId);
      }
      forcePulseTick();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const stateLike = { campaigns, candidates, ledger, suppression, seats, settings } as unknown as HermesState;
  const rollup = floorRollup(seats, stateLike);
  const selected = seats.find((s) => s.id === selectedId) ?? null;

  const pulseNow = Date.now();
  const pulsingSeatIds = new Set<string>();
  for (const [seatId, until] of pulseUntilRef.current) {
    if (until > pulseNow) pulsingSeatIds.add(seatId);
  }

  const selectAgent = (id: string) => {
    setSelectedId(id);
    setDrawerView("overview");
    playSound("select", soundEnabled);
  };
  const closeDrawer = () => {
    setSelectedId(null);
    setDrawerView("overview");
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

        {/* Live activity ticker — the guaranteed 2D fallback: renders on
            every device/view, regardless of tier or reduced-motion, since
            the packet FX + sound (RetroOfficeScene.tsx/PacketFX.tsx) are
            hard-gated off for low-tier/reduced-motion sessions. */}
        <ActivityTicker events={ticker} seats={seats} />

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
              pulsingSeatIds={pulsingSeatIds}
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
        open={selected !== null && drawerView === "overview"}
        onClose={closeDrawer}
        onOpenCortex={() => setDrawerView("cortex")}
      />
      <AgentCortex
        seat={selected}
        state={stateLike}
        open={selected !== null && drawerView === "cortex"}
        onClose={closeDrawer}
        onBack={() => setDrawerView("overview")}
      />
    </div>
  );
}

function Floor3DSection({
  seats,
  state,
  selectedId,
  onSelect,
  pulsingSeatIds,
}: {
  seats: AgentSeat[];
  state: HermesState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pulsingSeatIds: Set<string>;
}) {
  // Render-cap: a full procedural robot per agent is ~20 meshes; rendering the
  // whole fleet (up to 300) tanks the GPU. RetroOfficeScene itself caps at
  // MAX_3D_AGENTS[deviceQuality] and drops agents past that cap entirely (no
  // proxy mesh) — mirror the same real cap here so the copy never lies about
  // what's on screen. The full fleet always lives on the Agent Fleet page.
  const [deviceQuality] = React.useState(() => getDeviceQuality());
  const cap = MAX_3D_AGENTS[deviceQuality];
  // Force a pulsing seat's status to "working" so agentTick's existing
  // status-flip → walk-to-desk mechanism fires for it (no agentTick edits).
  const office = seatsToOfficeAgents(seats, state).map((a) =>
    pulsingSeatIds.has(a.id) && a.status !== "working" ? { ...a, status: "working" as const } : a,
  );
  const notShown = Math.max(0, office.length - cap);
  return (
    <div className="space-y-3">
      {office.length > 0 && (
        <p className="text-xs text-muted">
          {office.length} agents on the floor in 3D.
          {notShown > 0 &&
            ` Nearest ${cap} fully animated at this device tier; ${notShown} more not shown here.`}{" "}
          <Link href="/fleet" className="font-semibold text-electric hover:underline">
            Manage the full fleet
          </Link>
          .
        </p>
      )}
      {/* Mission Control HUD — glass overlay over the 3D canvas only (the
          2D grid view + ActivityTicker above stay the guaranteed fallback).
          The wrapping div has no explicit height, so it shrinks to Floor3D's
          own h-[70vh] container; the HUD's absolute inset-0 then matches
          that exactly without touching Floor3D.tsx itself. */}
      <div className="relative">
        <Floor3D agents={office} selectedId={selectedId} onSelect={onSelect} />
        <MissionControlHud />
      </div>
    </div>
  );
}

/** 2D text feed of recent agent-events — the guaranteed fallback for the
 *  Living Floor on every device, tier, and view mode (see PacketFX.tsx /
 *  RetroOfficeScene.tsx for the 3D-only packet+sound layer this backs up). */
function ActivityTicker({ events, seats }: { events: AgentEvent[]; seats: AgentSeat[] }) {
  const employees = seats.slice(1); // index 0 = CEO (src/lib/floor3d.ts convention)
  const items = [...events].slice(-TICKER_CAP).reverse();
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-ink">
          <Radio className="h-3.5 w-3.5 text-electric" aria-hidden />
          <Eyebrow>Live activity</Eyebrow>
        </div>
        <span className="text-xs text-muted">Real-time feed — works on every device</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          No agent activity yet — trigger a sourcing or outreach action to see it here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((e, i) => {
            const seat = employees.length > 0 ? employees[pickResponderIndex(e, employees.length)] : null;
            return (
              <li key={`${e.at}-${i}`} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: EVENT_COLOR[e.kind] }}
                  aria-hidden
                />
                <span className="truncate text-ink-soft">{describeEvent(e, seat?.name)}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {formatTimeAgo(new Date(e.at).toISOString())}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AgentDetailDrawer({
  seat,
  state,
  open,
  onClose,
  onOpenCortex,
}: {
  seat: AgentSeat | null;
  state: HermesState;
  open: boolean;
  onClose: () => void;
  onOpenCortex: () => void;
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

        <button
          type="button"
          onClick={onOpenCortex}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-electric/30 bg-electric-soft px-4 py-2.5 text-sm font-semibold text-electric transition hover:border-electric/50"
        >
          <Brain className="h-4 w-4" aria-hidden />
          Open cortex — watch it think
        </button>

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
