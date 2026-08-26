"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge, Card, CardContent, Eyebrow, Progress } from "@/components/ui";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { cn, type Tone } from "@/lib/utils";
import { Check, ChevronDown, Circle, AlertCircle } from "lucide-react";

export type StepState = "complete" | "active" | "pending" | "blocked";

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  hint?: string;
  optional?: boolean;
};

export function StatusPill({
  label,
  tone = "neutral",
  pulse,
}: {
  label: string;
  tone?: Tone;
  pulse?: boolean;
}) {
  return (
    <Badge tone={tone} size="sm" dot={pulse}>
      {label}
    </Badge>
  );
}

export function ConnectionStackShell({
  id,
  eyebrow,
  title,
  description,
  statusLabel,
  statusTone = "neutral",
  progressPct,
  progressLabel,
  children,
  footer,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string;
  statusTone?: Tone;
  progressPct: number;
  progressLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.section
      id={id}
      variants={fadeUp}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
      className="scroll-mt-24 outline-none"
      tabIndex={-1}
    >
      <Card className="overflow-hidden border-line/80 bg-surface shadow-sm">
        <CardContent className="space-y-0 p-0">
          <div className="border-b border-line/60 bg-gradient-to-b from-canvas/80 to-surface px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <Eyebrow>{eyebrow}</Eyebrow>
                <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink sm:text-[1.35rem]">
                  {title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
              </div>
              <StatusPill label={statusLabel} tone={statusTone} />
            </div>
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink-soft">{progressLabel}</span>
                <span className="tabular-nums text-muted">{Math.round(progressPct)}%</span>
              </div>
              <Progress
                value={progressPct}
                tone={progressPct >= 100 ? "success" : progressPct >= 50 ? "electric" : "neutral"}
                trackClassName="h-1.5 bg-ink/[0.06]"
                aria-label={progressLabel}
              />
            </div>
          </div>
          <div className="divide-y divide-line/50">{children}</div>
          {footer ? (
            <div className="border-t border-line/60 bg-canvas/40 px-6 py-4 sm:px-8">{footer}</div>
          ) : null}
        </CardContent>
      </Card>
    </motion.section>
  );
}

const STEP_RING: Record<StepState, string> = {
  complete: "border-success bg-success text-white",
  active: "border-[#0A66C2] bg-[#0A66C2]/10 text-[#0A66C2]",
  pending: "border-line bg-canvas text-muted",
  blocked: "border-warning/50 bg-warning-soft text-warning",
};

export function ConnectionStep({
  step,
  title,
  subtitle,
  state,
  children,
  advanced,
}: {
  step: 1 | 2 | 3;
  title: string;
  subtitle: string;
  state: StepState;
  children: React.ReactNode;
  advanced?: React.ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  return (
    <div className="px-6 py-6 sm:px-8">
      <div className="flex gap-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums transition-colors",
            STEP_RING[state],
          )}
          aria-hidden
        >
          {state === "complete" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <p className="text-base font-semibold tracking-tight text-ink">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{subtitle}</p>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={state}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              className="space-y-4"
            >
              {children}
            </motion.div>
          </AnimatePresence>
          {advanced ? (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="group flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
                aria-expanded={advancedOpen}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200",
                    advancedOpen && "rotate-180",
                  )}
                  aria-hidden
                />
                Advanced options
              </button>
              <AnimatePresence>
                {advancedOpen ? (
                  <motion.div
                    initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 rounded-2xl border border-dashed border-line/80 bg-canvas/50 p-4">
                      {advanced}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SystemReadiness({
  title = "System readiness",
  items,
  defaultOpen = false,
}: {
  title?: string;
  items: ReadinessItem[];
  defaultOpen?: boolean;
}) {
  if (items.length === 0) return null;

  const readyCount = items.filter((i) => i.ok || i.optional).length;
  const allRequiredOk = items.filter((i) => !i.optional).every((i) => i.ok);
  const tone: Tone = allRequiredOk ? "success" : "warning";

  return (
    <details
      className="rounded-2xl border border-line/70 bg-canvas/30"
      open={defaultOpen && !allRequiredOk}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {allRequiredOk ? (
            <Check className="h-4 w-4 text-success" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
          )}
          {title}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <Badge tone={tone} size="sm">
            {readyCount}/{items.length} ready
          </Badge>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </span>
      </summary>
      <ul className="space-y-0 border-t border-line/60 px-4 py-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start justify-between gap-3 border-b border-line/40 py-2.5 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-sm text-ink">{item.label}</p>
              {item.hint && !item.ok ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.hint}</p>
              ) : null}
            </div>
            <span className="shrink-0 pt-0.5">
              {item.ok ? (
                <Check className="h-4 w-4 text-success" aria-label="Ready" />
              ) : item.optional ? (
                <Circle className="h-3 w-3 text-muted/50" aria-label="Optional" />
              ) : (
                <AlertCircle className="h-4 w-4 text-warning" aria-label="Needs attention" />
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ConnectedIdentityBanner({
  displayName,
  secondary,
  imageUrl,
  icon,
  action,
}: {
  displayName: string;
  secondary?: string;
  imageUrl?: string | null;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-success/20 bg-success-soft/30 px-4 py-3.5">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-11 w-11 rounded-full object-cover ring-2 ring-white/80"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0A66C2] text-white ring-2 ring-white/80">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{displayName}</p>
        {secondary ? <p className="text-xs text-muted">{secondary}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ConnectionListItem({
  title,
  meta,
  healthy,
  badges,
  actions,
}: {
  title: string;
  meta: string;
  healthy: boolean;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface/90 px-4 py-3.5",
        healthy ? "border-success/15" : "border-warning/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {healthy ? (
              <Check className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
            )}
            <span className="truncate text-sm font-semibold text-ink">{title}</span>
            {badges}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{meta}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function IntegrationsHealthStrip({
  connected,
  degraded,
  error,
  notConfigured,
  total,
}: {
  connected: number;
  degraded: number;
  error: number;
  notConfigured: number;
  total: number;
}) {
  return (
    <HealthStrip
      title="Integration health"
      primary={`${connected} connected`}
      secondary={[
        degraded > 0 ? `${degraded} degraded` : "",
        error > 0 ? `${error} need attention` : "",
        notConfigured > 0 ? `${notConfigured} not configured` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      numerator={connected}
      denominator={total}
      tone={error > 0 ? "danger" : degraded > 0 ? "warning" : connected > 0 ? "success" : "neutral"}
      progressPct={total ? ((connected + degraded + error) / total) * 100 : 0}
      ariaLabel={`${connected} of ${total} integrations connected`}
    />
  );
}

export function HealthStrip({
  title,
  primary,
  secondary,
  numerator,
  denominator,
  progressPct,
  tone = "neutral",
  ariaLabel,
}: {
  title: string;
  primary: string;
  secondary?: string;
  numerator: number;
  denominator: number;
  progressPct: number;
  tone?: Tone;
  ariaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-line/70 bg-canvas/40 px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {primary}
            {secondary ? ` · ${secondary}` : ""}
          </p>
        </div>
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
          {numerator}
          <span className="text-base font-normal text-muted">/{denominator}</span>
        </p>
      </div>
      <Progress
        value={progressPct}
        tone={tone}
        className="mt-3"
        trackClassName="h-1"
        aria-label={ariaLabel}
      />
    </div>
  );
}
