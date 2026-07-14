"use client";

import * as React from "react";
import { Users, Mail, PenLine, CheckCircle2, CalendarCheck, Radio } from "lucide-react";
import { useCandidates, useOutreach, useBookings, useReplies, useSettings } from "@/lib/store";
import { subscribe, recentEvents, type AgentEvent } from "@/lib/agent-events";
import { EVENT_COLOR } from "@/lib/floor3d";
import { useCountUp } from "@/components/reveal/use-count-up";
import { missionControlHudValues } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/* ============================================================================
   Mission Control HUD — a glass overlay floating over the 3D floor canvas
   (mounted only in the 3D view from src/app/floor/page.tsx; the existing
   ActivityTicker stays the guaranteed 2D/low-tier fallback).

   Every tile is a live read of the REAL store — never a theatrical
   incrementer:
     Sourced   = canonical real-funnel sourced count   (missionControlHudValues)
     Contacted = canonical real completed-send facts   (missionControlHudValues)
     Drafted   = outreach messages ever generated      (useOutreach)
     Approved  = outreach messages with approvedBy set (useOutreach)
     Booked    = canonical real-funnel bookings        (missionControlHudValues)
   `useCountUp` (src/components/reveal/use-count-up.ts) animates old -> new
   whenever a real value changes. The agent-events bus only decides *when* to
   re-check for a delta (within one tick of the emitting store action, same
   guarantee as the 1.2 floor FX) and feeds the throughput sparkline — it
   never supplies the numbers themselves, so the HUD can never drift from
   true state.
   ========================================================================== */

type TileKey = "sourced" | "contacted" | "drafted" | "approved" | "booked";

const TILE_ORDER: TileKey[] = ["sourced", "contacted", "drafted", "approved", "booked"];

const TILE_META: Record<TileKey, { label: string; icon: React.ReactNode; varName: string }> = {
  sourced: { label: "Sourced", icon: <Users className="h-3 w-3" aria-hidden />, varName: "--electric" },
  contacted: { label: "Contacted", icon: <Mail className="h-3 w-3" aria-hidden />, varName: "--tangerine" },
  drafted: { label: "Drafted", icon: <PenLine className="h-3 w-3" aria-hidden />, varName: "--violet" },
  approved: { label: "Approved", icon: <CheckCircle2 className="h-3 w-3" aria-hidden />, varName: "--success" },
  booked: { label: "Booked", icon: <CalendarCheck className="h-3 w-3" aria-hidden />, varName: "--aqua" },
};

type Flash = { until: number; delta: number };

const FLASH_MS = 1400;
const SPARK_BUCKET_MS = 4000;
const SPARK_BUCKET_COUNT = 16; // ~64s rolling window

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function bucketEvents(events: AgentEvent[], now: number): number[] {
  const buckets = new Array(SPARK_BUCKET_COUNT).fill(0) as number[];
  const windowMs = SPARK_BUCKET_COUNT * SPARK_BUCKET_MS;
  for (const e of events) {
    const age = now - e.at;
    if (age < 0 || age >= windowMs) continue;
    const idx = SPARK_BUCKET_COUNT - 1 - Math.floor(age / SPARK_BUCKET_MS);
    if (idx >= 0 && idx < SPARK_BUCKET_COUNT) buckets[idx] += 1;
  }
  return buckets;
}

export function MissionControlHud() {
  const candidates = useCandidates();
  const outreach = useOutreach();
  const replies = useReplies();
  const bookings = useBookings();
  const settings = useSettings();
  const reducedMotion = usePrefersReducedMotion();

  const values: Record<TileKey, number> = missionControlHudValues(
    { candidates, outreach, replies, bookings },
    { live: !settings.dryRunMode },
  );

  // Always-fresh mirror of the real values, read from inside callbacks below
  // without re-subscribing them to every render.
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const lastSeenRef = React.useRef(values);
  const [flashes, setFlashes] = React.useState<Partial<Record<TileKey, Flash>>>({});

  const checkDeltas = React.useCallback(() => {
    const latest = valuesRef.current;
    const prev = lastSeenRef.current;
    const until = Date.now() + FLASH_MS;
    let changed: Partial<Record<TileKey, Flash>> | null = null;
    for (const key of TILE_ORDER) {
      const delta = latest[key] - prev[key];
      if (delta !== 0) {
        changed ??= {};
        changed[key] = { until, delta };
      }
    }
    if (changed) {
      lastSeenRef.current = latest;
      setFlashes((old) => ({ ...old, ...changed }));
    }
  }, []);

  // Real state changed -> flash + count-up. Fires even if the bus is silent
  // for some reason, so the scoreboard can never silently go stale.
  React.useEffect(() => {
    checkDeltas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.sourced, values.contacted, values.drafted, values.approved, values.booked]);

  // Agent-events bus: re-check within one tick of the emitting action (same
  // guarantee 1.1/1.2 rely on), and feed the throughput sparkline — raw event
  // kinds/timestamps aren't reconstructable from any store selector.
  const [sparkBuckets, setSparkBuckets] = React.useState<number[]>(() =>
    bucketEvents(recentEvents(), Date.now()),
  );
  React.useEffect(() => {
    const unsubscribe = subscribe(() => {
      checkDeltas();
      setSparkBuckets(bucketEvents(recentEvents(), Date.now()));
    });
    const id = setInterval(() => {
      setSparkBuckets(bucketEvents(recentEvents(), Date.now()));
    }, 2000);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, [checkDeltas]);

  // Let expired flashes drop off on a slow tick (DOM overlay — no need for
  // per-frame precision here, unlike the 3D FX layer).
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(forceTick, 400);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <div
        role="group"
        aria-label="Mission control scoreboard, live counts"
        className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap gap-2 sm:right-auto"
      >
        {TILE_ORDER.map((key) => (
          <HudTile
            key={key}
            tileKey={key}
            value={values[key]}
            flash={flashes[key]}
            now={now}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
      <div className="pointer-events-auto absolute bottom-3 right-3">
        <ThroughputSparkline buckets={sparkBuckets} />
      </div>
    </div>
  );
}

function HudTile({
  tileKey,
  value,
  flash,
  now,
  reducedMotion,
}: {
  tileKey: TileKey;
  value: number;
  flash: Flash | undefined;
  now: number;
  reducedMotion: boolean;
}) {
  const meta = TILE_META[tileKey];
  const display = useCountUp(value, { durationMs: 700 });
  const flashing = !!flash && flash.until > now;
  const solid = `hsl(var(${meta.varName}))`;
  const tint = `hsl(var(${meta.varName}) / 0.16)`;

  return (
    <div
      className={cn(
        "pointer-events-auto relative flex min-w-[84px] flex-col gap-0.5 rounded-xl border px-2.5 py-1.5 backdrop-blur-md",
        !reducedMotion && "transition-[box-shadow,border-color,background-color] duration-500",
      )}
      style={{
        borderColor: flashing ? solid : "rgba(255,255,255,0.14)",
        backgroundColor: flashing ? tint : "rgba(8,10,18,0.42)",
        boxShadow: flashing ? `0 0 0 1px ${solid}, 0 0 16px -2px ${solid}` : "none",
      }}
      title={`${meta.label}: ${Math.round(display)} (live)`}
      aria-label={`${meta.label}: ${Math.round(display)}`}
    >
      <span className="flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.13em] text-white/55">
        <span style={{ color: solid }}>{meta.icon}</span>
        {meta.label}
      </span>
      <span className="text-lg font-extrabold tabular-nums text-white">{Math.round(display)}</span>
      {flashing && flash!.delta !== 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute -right-1.5 -top-1.5 rounded-full px-1.5 py-0.5 text-[0.55rem] font-bold text-white",
            !reducedMotion && "animate-scale-in",
          )}
          style={{ backgroundColor: solid }}
        >
          {flash!.delta > 0 ? `+${flash!.delta}` : flash!.delta}
        </span>
      ) : null}
    </div>
  );
}

/** Small hand-rolled SVG bar sparkline — matches the self-contained-SVG chart
 *  convention (src/components/charts/fit-radar.tsx): no chart library, real
 *  data straight from the bounded agent-events ring buffer
 *  (src/lib/agent-events.ts recentEvents(), capacity 64). */
function ThroughputSparkline({ buckets }: { buckets: number[] }) {
  const gradientId = React.useId();
  const w = 132;
  const h = 40;
  const gap = 2;
  const barW = (w - gap * (buckets.length - 1)) / buckets.length;
  const max = Math.max(1, ...buckets);
  const total = buckets.reduce((a, b) => a + b, 0);
  const windowSec = Math.round((buckets.length * SPARK_BUCKET_MS) / 1000);

  return (
    <div
      className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 backdrop-blur-md"
      role="img"
      aria-label={`Agent throughput, last ${windowSec}s: ${total} event${total === 1 ? "" : "s"}`}
    >
      <div className="mb-1 flex items-center gap-1 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-white/50">
        <Radio className="h-2.5 w-2.5" style={{ color: EVENT_COLOR.source }} aria-hidden />
        Throughput
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--electric))" />
            <stop offset="100%" stopColor="hsl(var(--tangerine))" />
          </linearGradient>
        </defs>
        {buckets.map((count, i) => {
          const bh = count === 0 ? 1.5 : Math.max(3, (count / max) * (h - 4));
          const x = i * (barW + gap);
          const y = h - bh;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={bh}
              rx={1.5}
              fill={`url(#${gradientId})`}
              opacity={count === 0 ? 0.25 : 1}
            />
          );
        })}
      </svg>
    </div>
  );
}
