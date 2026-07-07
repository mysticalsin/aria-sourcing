"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Brain } from "lucide-react";
import { Badge, Card, CardContent, Drawer, Eyebrow } from "@/components/ui";
import { AgentBot, botColorForSeat } from "./agent-bot";
import {
  agentCortexTrace,
  cortexScriptText,
  streamCortexWords,
  type CortexChip,
  type CortexRung,
  type CortexRungStatus,
  type CortexTrace,
} from "@/lib/cortex";
import type { AgentSeat, HermesState, MatchBreakdownItem, ScoringWeights } from "@/lib/types";
import { clamp } from "@/lib/utils";

/* ============================================================================
   Glass Cortex — click a robot on the Ops Floor, watch its mind think.
   Read-only visualization: streams the deterministic trace from
   src/lib/cortex.ts (a pure function of the seat's real current candidate,
   score breakdown, and suppression/ledger facts), plus an SVG tool-ladder,
   framer-motion confidence meters, and guardrail chips. Never mutates the
   store and never sends anything.
   ========================================================================== */

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

/** Consumes the word-by-word generator from src/lib/cortex.ts. Restarts only
 *  when the seat changes or the drawer re-opens — NOT on every parent
 *  re-render (the floor page re-renders every second for its pulse ticker) —
 *  so the streaming pacing never hitches. `prefers-reduced-motion` renders
 *  the full script instantly instead of streaming it. */
function useCortexStream(
  trace: CortexTrace | null,
  open: boolean,
): { text: string; streaming: boolean } {
  const reducedMotion = usePrefersReducedMotion();
  const [text, setText] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);

  React.useEffect(() => {
    if (!trace || !open) {
      setText("");
      setStreaming(false);
      return;
    }
    if (reducedMotion) {
      setText(cortexScriptText(trace));
      setStreaming(false);
      return;
    }
    let cancelled = false;
    setText("");
    setStreaming(true);
    const gen = streamCortexWords(trace);
    (async () => {
      let buf = "";
      for await (const token of gen) {
        if (cancelled) break;
        buf += token;
        setText(buf);
      }
      if (!cancelled) setStreaming(false);
    })();
    return () => {
      cancelled = true;
      void gen.return(undefined);
    };
    // Intentionally keyed on seatId/open, not the `trace` object identity —
    // page.tsx rebuilds its state snapshot every render (e.g. the 1s pulse
    // ticker), which would otherwise restart the stream constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.seatId, open, reducedMotion]);

  return { text, streaming };
}

const RUNG_TONE: Record<CortexRungStatus, { stroke: string; fill: string; badge: "success" | "electric" | "danger" }> = {
  done: { stroke: "hsl(var(--success))", fill: "hsl(var(--success) / 0.14)", badge: "success" },
  active: { stroke: "hsl(var(--electric))", fill: "hsl(var(--electric) / 0.14)", badge: "electric" },
  skipped: { stroke: "hsl(var(--danger))", fill: "hsl(var(--danger) / 0.12)", badge: "danger" },
};

/** Hand-rolled SVG tool-ladder (source -> score -> draft) — same
 *  self-contained-SVG convention as fit-radar.tsx / mission-control-hud.tsx.
 *  A skipped rung (suppressed/do-not-contact candidate) draws its incoming
 *  connector as a dashed red line so the skip reads visually, not just via color. */
function CortexLadder({ ladder }: { ladder: CortexRung[] }) {
  const w = 300;
  const h = 84;
  const r = 15;
  const cy = 30;
  const step = (w - 60) / Math.max(1, ladder.length - 1);
  const cx = (i: number) => 30 + i * step;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Tool ladder: source, score, draft">
        {ladder.slice(0, -1).map((_, i) => {
          const nextSkipped = ladder[i + 1].status === "skipped";
          return (
            <line
              key={i}
              x1={cx(i) + r}
              y1={cy}
              x2={cx(i + 1) - r}
              y2={cy}
              stroke={nextSkipped ? "hsl(var(--danger))" : "hsl(var(--ink) / 0.18)"}
              strokeWidth={2}
              strokeDasharray={nextSkipped ? "4 3" : undefined}
            />
          );
        })}
        {ladder.map((rung, i) => {
          const tone = RUNG_TONE[rung.status];
          return (
            <g key={rung.key} className={rung.status === "active" ? "animate-pulse" : undefined}>
              <circle cx={cx(i)} cy={cy} r={r} fill={tone.fill} stroke={tone.stroke} strokeWidth={2} />
              <text x={cx(i)} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={tone.stroke}>
                {i + 1}
              </text>
              <text x={cx(i)} y={cy + r + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--ink))">
                {rung.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 space-y-1.5">
        {ladder.map((rung) => (
          <li key={rung.key} className="flex items-start gap-2 text-xs">
            <Badge tone={RUNG_TONE[rung.status].badge} size="sm" className="shrink-0">
              {rung.status === "done" ? "Done" : rung.status === "active" ? "In progress" : "Skipped"}
            </Badge>
            <span className="text-muted">{rung.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DIM_COLOR_VAR: Record<keyof ScoringWeights, string> = {
  skills: "--electric",
  experience: "--violet",
  companyStage: "--tangerine",
  industry: "--aqua",
  location: "--success",
  activity: "--warning",
};

function ConfidenceMeters({ meters }: { meters: MatchBreakdownItem[] }) {
  const reducedMotion = usePrefersReducedMotion();
  if (meters.length === 0) {
    return <p className="text-sm text-muted">No candidate in focus to score right now.</p>;
  }
  return (
    <div className="space-y-3">
      {meters.map((m) => {
        const pct = clamp(m.score, 0, 100);
        const colorVar = DIM_COLOR_VAR[m.key] ?? "--electric";
        return (
          <div key={m.key}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-ink-soft">{m.label}</span>
              <span className="font-bold tabular-nums text-ink">{Math.round(m.score)}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink/10">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: `hsl(var(${colorVar}))` }}
                initial={reducedMotion ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: reducedMotion ? 0 : 0.6, ease: "easeOut" }}
              />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted">{m.rationale}</p>
          </div>
        );
      })}
    </div>
  );
}

function GuardrailChips({ chips }: { chips: CortexChip[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Badge key={c.key} tone={c.tone} dot title={c.detail}>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

export interface AgentCortexProps {
  seat: AgentSeat | null;
  state: HermesState;
  open: boolean;
  /** Full close — deselects the agent (X / Escape / backdrop), same semantics
   *  as AgentDetailDrawer's onClose. */
  onClose: () => void;
  /** Switch back to the overview drawer without deselecting the agent. */
  onBack: () => void;
}

/** The drawer itself — a Drawer (reusing @/components/ui, same primitive as
 *  AgentDetailDrawer) opened from the floor page's existing `selectedId`.
 *  Read-only: computes the trace via a pure lib call, never touches the
 *  store, never sends anything. */
export function AgentCortex({ seat, state, open, onClose, onBack }: AgentCortexProps) {
  const trace = seat ? agentCortexTrace(seat, state) : null;
  const { text, streaming } = useCortexStream(trace, open && trace !== null);

  if (!seat || !trace) {
    return (
      <Drawer open={false} onClose={onClose} title="Cortex">
        <div />
      </Drawer>
    );
  }

  const busy = trace.activityState === "sourcing" || trace.activityState === "outreach" || trace.activityState === "booking";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${seat.name} — inside the mind`}
      description={trace.headline}
      width="max-w-xl"
    >
      <div className="space-y-6 animate-fade-in">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to overview
        </button>

        <div className="flex items-center gap-3">
          <AgentBot
            color={botColorForSeat(seat.id)}
            size={64}
            busy={busy}
            paused={trace.activityState === "paused"}
            warming={trace.activityState === "warming"}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-ink">
              <Brain className="h-3.5 w-3.5 text-electric" aria-hidden />
              <Eyebrow>Reasoning trace — simulated</Eyebrow>
            </div>
            <p className="truncate text-sm text-muted">
              {trace.candidateName ? `Focused on ${trace.candidateName}` : "No candidate in focus"}
            </p>
          </div>
        </div>

        <GuardrailChips chips={trace.chips} />

        <Card className="bg-ink/[0.03]">
          <CardContent>
            <Eyebrow className="mb-2 block">Simulated thinking (derived from real pipeline data)</Eyebrow>
            <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink-soft" aria-live="off">
              {text}
              {streaming && (
                <span aria-hidden className="ml-0.5 animate-pulse text-muted">
                  ▍
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <div>
          <Eyebrow className="mb-3 block">Tool ladder</Eyebrow>
          <CortexLadder ladder={trace.ladder} />
        </div>

        <div>
          <Eyebrow className="mb-2 block">Confidence — match breakdown</Eyebrow>
          <ConfidenceMeters meters={trace.meters} />
        </div>
      </div>
    </Drawer>
  );
}
