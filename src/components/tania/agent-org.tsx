"use client";

import * as React from "react";
import {
  Radar,
  ScanSearch,
  Workflow,
  HeartHandshake,
  Rocket,
  UsersRound,
  Waypoints,
  ShieldCheck,
  Lock,
  CircleCheck,
  ChevronDown,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card, Eyebrow } from "@/components/ui";
import { SourceBadge, StageBadge } from "@/components/tania/badges";
import {
  COORDINATOR,
  MANAGERS,
  NEVER_ALONE,
  GATED_EXCEPTION,
  type ManagerAgent,
  type OrgColor,
  type SubAgent,
} from "@/lib/agents-org";

/* ---- Token → class maps (static literals so Tailwind JIT can see them) ---- */

interface ColorClasses {
  /** Icon tile: soft background + accent text + ring. */
  icon: string;
  /** Accent text for the stage-scope line. */
  accent: string;
  /** Soft chip: background + text + ring. */
  chip: string;
  /** Thin accent bar / rail. */
  bar: string;
}

const COLOR: Record<OrgColor, ColorClasses> = {
  electric: {
    icon: "bg-electric-soft text-electric ring-electric/25",
    accent: "text-electric",
    chip: "bg-electric-soft text-electric ring-electric/25",
    bar: "bg-electric",
  },
  violet: {
    icon: "bg-violet-soft text-violet ring-violet/25",
    accent: "text-violet",
    chip: "bg-violet-soft text-violet ring-violet/25",
    bar: "bg-violet",
  },
  tangerine: {
    icon: "bg-tangerine-soft text-tangerine ring-tangerine/25",
    accent: "text-tangerine",
    chip: "bg-tangerine-soft text-tangerine ring-tangerine/25",
    bar: "bg-tangerine",
  },
  aqua: {
    icon: "bg-aqua-soft text-aqua ring-aqua/25",
    accent: "text-aqua",
    chip: "bg-aqua-soft text-aqua ring-aqua/25",
    bar: "bg-aqua",
  },
  success: {
    icon: "bg-success-soft text-success ring-success/25",
    accent: "text-success",
    chip: "bg-success-soft text-success ring-success/25",
    bar: "bg-success",
  },
  "mantu-yellow": {
    icon: "bg-mantu-yellow text-mantu-yellow-ink ring-mantu-yellow/50",
    accent: "text-mantu-yellow-ink",
    chip: "bg-mantu-yellow/20 text-mantu-yellow-ink ring-mantu-yellow/40",
    bar: "bg-mantu-yellow",
  },
};

const MANAGER_ICON: Record<string, LucideIcon> = {
  "sourcing-lead": Radar,
  "candidate-intelligence": ScanSearch,
  process: Workflow,
  "candidate-experience": HeartHandshake,
  onboarding: Rocket,
  "talent-pool": UsersRound,
};

/* ---- Sub-agent row ------------------------------------------------------- */

function SubAgentRow({ sub }: { sub: SubAgent }) {
  const tag =
    sub.source && sub.source !== "All" ? (
      <SourceBadge source={sub.source} size="sm" />
    ) : sub.source === "All" ? (
      <Badge tone="neutral" size="sm">
        <Layers className="h-3 w-3" aria-hidden />
        All sources
      </Badge>
    ) : null;

  return (
    <li className="flex flex-col gap-1 rounded-2xl bg-canvas/60 p-3 ring-1 ring-inset ring-line/70">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{sub.name}</span>
        {sub.future && (
          <Badge tone="neutral" size="sm">
            Future
          </Badge>
        )}
        {tag}
      </div>
      <p className="text-[0.8125rem] leading-relaxed text-muted">{sub.whatItDoes}</p>
    </li>
  );
}

/* ---- Manager card -------------------------------------------------------- */

function ManagerCard({ m }: { m: ManagerAgent }) {
  const [open, setOpen] = React.useState(true);
  const c = COLOR[m.color];
  const Icon = MANAGER_ICON[m.id] ?? Workflow;
  const listId = `manager-${m.id}-agents`;

  return (
    <Card className="flex flex-col overflow-hidden p-0 animate-fade-in">
      {/* Accent rail */}
      <div className={cn("h-1 w-full", c.bar)} aria-hidden />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset",
              c.icon,
            )}
            aria-hidden
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-[0.6875rem] font-bold uppercase tracking-[0.14em]", c.accent)}>
              {m.stageScope}
            </p>
            <h3 className="mt-1 text-base font-bold leading-tight tracking-tight text-ink">
              {m.name}
            </h3>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{m.mission}</p>

        <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted">
          <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span>{m.poweredBy}</span>
        </p>

        {/* Sub-agent toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            "mt-4 inline-flex w-full items-center justify-between gap-2 rounded-full bg-ink/[0.03] px-3.5 py-2 text-xs font-semibold text-ink-soft ring-1 ring-inset ring-line transition-colors hover:bg-ink/[0.06]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
          )}
        >
          <span>
            {m.subAgents.length} sub-agents
            {m.crossStage ? " · cross-stage" : ""}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </button>

        {open && (
          <ul id={listId} className="mt-3 flex flex-col gap-2 animate-fade-in">
            {m.subAgents.map((sub) => (
              <SubAgentRow key={sub.name} sub={sub} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ---- Coordinator card ---------------------------------------------------- */

function CoordinatorCard() {
  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl p-[1.5px] shadow-lift animate-fade-in"
      aria-labelledby="coordinator-title"
    >
      {/* Gradient border via padded wrapper */}
      <div className="gradient-purple absolute inset-0 rounded-3xl opacity-90" aria-hidden />
      <div className="relative rounded-[1.4rem] bg-surface/95 p-6 backdrop-blur-xl sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-40" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
          <span
            className="gradient-purple flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-glow-purple"
            aria-hidden
          >
            <Waypoints className="h-7 w-7" strokeWidth={2} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow className="text-electric">Tier 1 · {COORDINATOR.role}</Eyebrow>
              <Badge tone="violet" size="sm" dot>
                Always confirms
              </Badge>
            </div>
            <h2
              id="coordinator-title"
              className="display mt-2 text-2xl text-ink sm:text-3xl"
            >
              {COORDINATOR.name}
            </h2>
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
              {COORDINATOR.mission}
            </p>

            <ul className="mt-5 grid gap-2 sm:grid-cols-3">
              {COORDINATOR.principles.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-2 rounded-2xl bg-canvas/70 p-3 text-[0.8125rem] leading-snug text-ink-soft ring-1 ring-inset ring-line/70"
                >
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-electric" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>

            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted">
              <Waypoints className="h-3.5 w-3.5 text-violet" aria-hidden />
              {COORDINATOR.mapsTo}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- Legend — managers → funnel stages ----------------------------------- */

function OrgLegend() {
  return (
    <Card className="p-5 animate-fade-in sm:p-6">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted" aria-hidden />
        <Eyebrow>Coverage · manager × funnel stage</Eyebrow>
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {MANAGERS.map((m) => {
          const c = COLOR[m.color];
          return (
            <li
              key={m.id}
              className="flex flex-col gap-2 border-b border-line/60 pb-2.5 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                <span className={cn("h-2.5 w-2.5 rounded-full", c.bar)} aria-hidden />
                {m.name}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {m.crossStage && (
                  <Badge tone="neutral" size="sm">
                    Cross-stage
                  </Badge>
                )}
                {m.stages.map((s) => (
                  <StageBadge key={s} stage={s} size="sm" />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ---- Public: the org visualisation --------------------------------------- */

export function AgentOrg() {
  return (
    <div className="space-y-6">
      <CoordinatorCard />

      {/* Tier-2 label with a connector cue */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" aria-hidden />
        <Eyebrow className="shrink-0">Tier 2 · Six managers, one team</Eyebrow>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {MANAGERS.map((m) => (
          <ManagerCard key={m.id} m={m} />
        ))}
      </div>

      <OrgLegend />
    </div>
  );
}

/* ---- Public: the guardrails trust panel ---------------------------------- */

export function GuardrailsPanel() {
  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl border border-violet/15 bg-surface/80 p-6 shadow-soft backdrop-blur-xl animate-fade-in sm:p-8"
      aria-labelledby="guardrails-title"
    >
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet/10 blur-3xl" aria-hidden />

      <div className="relative">
        <div className="flex items-start gap-3">
          <span
            className="gradient-purple flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-glow-purple"
            aria-hidden
          >
            <ShieldCheck className="h-6 w-6" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <Eyebrow className="text-electric">Guardrails</Eyebrow>
            <h2 id="guardrails-title" className="display mt-1 text-2xl text-ink sm:text-3xl">
              TAnIA never does these alone
            </h2>
            <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
              Six actions are always recruiter-gated. TAnIA prepares the work and waits — a human
              makes the call.
            </p>
          </div>
        </div>

        {/* The six gated actions */}
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {NEVER_ALONE.map((rule, i) => (
            <li
              key={rule.action}
              className="flex items-start gap-3 rounded-2xl bg-canvas/60 p-4 ring-1 ring-inset ring-line/70"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink/[0.04] text-ink-soft ring-1 ring-inset ring-line"
                aria-hidden
              >
                <Lock className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink">
                  <span className="mr-1.5 tabular-nums text-muted">{i + 1}.</span>
                  Never {rule.action.charAt(0).toLowerCase() + rule.action.slice(1)}
                </p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{rule.why}</p>
              </div>
            </li>
          ))}
        </ul>

        {/* The single exception — visually distinguished */}
        <div className="mt-4 rounded-2xl border border-mantu-yellow/40 bg-mantu-yellow/[0.14] p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="bg-mantu-yellow flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-mantu-yellow-ink"
              aria-hidden
            >
              <CircleCheck className="h-4 w-4" />
            </span>
            <Badge className="bg-mantu-yellow/25 text-mantu-yellow-ink ring-mantu-yellow/40" size="sm">
              The one exception
            </Badge>
            <span className="text-sm font-bold text-ink">{GATED_EXCEPTION.action}</span>
          </div>
          <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-soft">
            {GATED_EXCEPTION.why}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {GATED_EXCEPTION.safeguards.map((s) => (
              <li key={s} className="flex items-start gap-2 text-[0.8125rem] text-ink-soft">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mantu-yellow-ink" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
