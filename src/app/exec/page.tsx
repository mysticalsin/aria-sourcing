"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  CalendarCheck,
  Download,
  EyeOff,
  Mail,
  MousePointerClick,
  Reply,
  Target,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { TrendSpark } from "@/components/charts/trend-spark";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardTitle,
  EmptyState,
  Eyebrow,
  SkeletonCard,
  useToast,
} from "@/components/ui";
import {
  useActivities,
  useBookings,
  useCampaigns,
  useCandidates,
  useHydrated,
  useOutreach,
  useReplies,
  useRole,
  useSettings,
  useWins,
} from "@/lib/store";
import {
  deriveExecDashboard,
  execCanExport,
  execWinCandidateLabel,
  type ExecDashboardModel,
  type ExecFunnelRow,
} from "@/lib/exec-dashboard";
import {
  fadeUp,
  formatAnimatedMetric,
  parseMetricNumber,
  staggerContainer,
  staggerFast,
} from "@/lib/dashboard-motion";
import { ROLE_LABEL } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { useCountUp } from "@/components/reveal/use-count-up";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { downloadText, formatDateTime, formatNumber, formatPercent, formatTimeAgo, type Tone } from "@/lib/utils";

function formatHours(hours: number | null): string {
  return hours == null ? "Not tracked yet" : `${formatNumber(hours)}h`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "Unknown";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${formatNumber(minutes)}m`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 48) return `${formatNumber(hours)}h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10)}d`;
}

function execMarkdown(model: ExecDashboardModel): string {
  const lines = [
    "# Exec Dashboard",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${model.demoMode ? "Demo data - synthetic" : "Live"}`,
    "",
    "## KPIs",
    `Candidates sourced: ${model.kpis.candidatesSourced}`,
    `Contacted: ${model.kpis.contacted}`,
    `Reply rate: ${formatPercent(model.kpis.replyRate)}`,
    `Positive-reply rate: ${formatPercent(model.facts.positiveReplyRate)}`,
    `Meetings booked: ${model.kpis.interviewsBooked}`,
    `Time to first interview: ${formatHours(model.kpis.timeToFirstInterviewHours)}`,
    `Average match score: ${model.kpis.avgMatchScore}`,
    "Open rate: Not tracked yet",
    "",
    "## Recent wins",
  ];
  for (const win of model.recentWins) {
    lines.push(
      `- ${formatDateTime(win.at)} | ${win.candidateName} | ${win.roleTitle} | ${win.campaignTitle} | ${win.sourcePlatform} | ${win.outreachChannel ?? "Unknown"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

const TONE_GLOW: Record<Tone, string> = {
  neutral: "from-ink/[0.05] to-transparent",
  tangerine: "from-tangerine/12 to-transparent",
  electric: "from-electric/12 to-transparent",
  aqua: "from-aqua/12 to-transparent",
  violet: "from-violet/12 to-transparent",
  success: "from-success/12 to-transparent",
  warning: "from-warning/12 to-transparent",
  danger: "from-danger/12 to-transparent",
};

function KpiTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const numeric = parseMetricNumber(value);
  const animated = useCountUp(numeric ?? 0, {
    durationMs: 900,
    enabled: numeric != null && !reducedMotion,
  });
  const display =
    numeric != null && !reducedMotion
      ? formatAnimatedMetric(value, animated)
      : value;

  return (
    <motion.div variants={fadeUp} className="h-full" whileHover={reducedMotion ? undefined : { y: -3 }}>
      <Card className="relative h-full overflow-hidden">
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${TONE_GLOW[tone]}`}
          aria-hidden
        />
        <CardContent className="relative flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink/[0.04] text-ink-soft">
              {icon}
            </div>
            <Badge tone={tone} size="sm" dot>
              Canonical
            </Badge>
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums tracking-tight text-ink">{display}</p>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
          </div>
          <p className="text-sm text-muted">{hint}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function OpenRateTile() {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <motion.div variants={fadeUp} className="h-full" whileHover={reducedMotion ? undefined : { y: -3 }}>
      <Card className="h-full">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink/[0.04] text-ink-soft">
              <MousePointerClick className="h-5 w-5" aria-hidden />
            </div>
            <Badge tone="neutral" size="sm">
              Gap
            </Badge>
          </div>
          <div>
            <p className="text-2xl font-extrabold text-ink">Not tracked yet</p>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Open rate</p>
          </div>
          <p className="text-sm text-muted">No email-open events exist in the current event model.</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FunnelStageBar({
  label,
  value,
  max,
  toneVar,
  delay,
}: {
  label: string;
  value: number;
  max: number;
  toneVar: string;
  delay: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const pct = Math.round((value / Math.max(max, 1)) * 100);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
        <span className="text-xs font-extrabold tabular-nums text-ink">{formatNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: `hsl(var(${toneVar}))` }}
          initial={reducedMotion ? false : { width: 0 }}
          animate={{ width: `${Math.max(pct, value > 0 ? 8 : 0)}%` }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </div>
    </div>
  );
}

function FunnelRows({ title, rows }: { title: string; rows: ExecFunnelRow[] }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <motion.div variants={fadeUp} className="h-full">
      <Card className="h-full">
        <CardContent>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <Eyebrow>{title}</Eyebrow>
              <CardTitle className="mt-1 text-base">Real-send funnel</CardTitle>
            </div>
            <Badge tone="electric" size="sm">
              {formatNumber(rows.length)}
            </Badge>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No funnel data yet.</p>
          ) : (
            <motion.div
              className="space-y-3"
              variants={staggerFast}
              initial={reducedMotion ? false : "hidden"}
              animate="show"
            >
              {rows.map((row) => {
                const max = Math.max(
                  row.facts.sourced,
                  row.facts.contacted,
                  row.facts.repliedCount,
                  row.facts.positiveReplies,
                  row.facts.booked,
                  1,
                );
                return (
                  <motion.div
                    key={row.id}
                    variants={fadeUp}
                    className="rounded-2xl border border-line bg-gradient-to-br from-surface to-ink/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink">{row.label}</p>
                        <p className="text-xs text-muted">
                          Avg match {formatNumber(row.avgMatchScore)}
                          {row.timeToFirstInterviewHours != null
                            ? ` · ${formatNumber(row.timeToFirstInterviewHours)}h TTFI`
                            : ""}
                        </p>
                      </div>
                      <Badge tone="success" size="sm">
                        {formatPercent(row.facts.replyRate)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-5">
                      <FunnelStageBar label="Sourced" value={row.facts.sourced} max={max} toneVar="--muted" delay={0} />
                      <FunnelStageBar label="Sent" value={row.facts.contacted} max={max} toneVar="--tangerine" delay={0.05} />
                      <FunnelStageBar label="Replies" value={row.facts.repliedCount} max={max} toneVar="--aqua" delay={0.1} />
                      <FunnelStageBar label="Positive" value={row.facts.positiveReplies} max={max} toneVar="--electric" delay={0.15} />
                      <FunnelStageBar label="Booked" value={row.facts.booked} max={max} toneVar="--success" delay={0.2} />
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function TrendPanel({ model }: { model: ExecDashboardModel }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <motion.div variants={fadeUp}>
      <Card>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <Eyebrow>Trends</Eyebrow>
              <CardTitle className="mt-1 text-base">Real activity history</CardTitle>
            </div>
            <p className="text-xs text-muted">Hover a series for point detail</p>
          </div>
          <motion.div
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            variants={staggerContainer}
            initial={reducedMotion ? false : "hidden"}
            animate="show"
          >
            <TrendSpark label="Sourced" data={model.trends.sourced} tone="electric" height={88} showSummary />
            <TrendSpark label="Contacted" data={model.trends.contacted} tone="tangerine" height={88} showSummary />
            <TrendSpark label="Replies" data={model.trends.replied} tone="aqua" height={88} showSummary />
            <TrendSpark label="Booked" data={model.trends.booked} tone="success" height={88} showSummary />
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function WinsFeed({ model, role }: { model: ExecDashboardModel; role: ReturnType<typeof useRole> }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <motion.div variants={fadeUp}>
      <Card>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Eyebrow>Wins feed</Eyebrow>
              <CardTitle className="mt-1 text-base">Recent booked wins</CardTitle>
            </div>
            <Badge tone="neutral" size="sm">
              {ROLE_LABEL[role]}
            </Badge>
          </div>
          {model.recentWins.length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-7 w-7" aria-hidden />}
              title="No wins recorded yet"
              description="The next accepted meeting will add a structured win record here."
            />
          ) : (
            <motion.div
              className="grid gap-3 lg:grid-cols-2"
              variants={staggerFast}
              initial={reducedMotion ? false : "hidden"}
              animate="show"
            >
              {model.recentWins.map((win) => (
                <motion.div
                  key={win.id}
                  variants={fadeUp}
                  whileHover={reducedMotion ? undefined : { y: -2 }}
                  className="rounded-2xl border border-line bg-gradient-to-br from-surface to-success/[0.04] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">
                        {execWinCandidateLabel(win, role)}
                      </p>
                      <p className="truncate text-xs text-muted">{win.roleTitle}</p>
                    </div>
                    <Badge tone="electric" size="sm">
                      {win.sourcePlatform}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">{win.campaignTitle}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                    <span>{win.outreachChannel ?? "Unknown"} touch</span>
                    <span>
                      {formatNumber(win.touchCount)} touch{win.touchCount === 1 ? "" : "es"}
                    </span>
                    <span>{formatDuration(win.timeToBookMs)}</span>
                    <span>{formatTimeAgo(win.at)}</span>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function ExecPage() {
  const hydrated = useHydrated();
  const role = useRole();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const outreach = useOutreach();
  const replies = useReplies();
  const bookings = useBookings();
  const activities = useActivities();
  const settings = useSettings();
  const wins = useWins();
  const { toast } = useToast();
  const demoMode = !supabaseEnabled || settings.dryRunMode;
  const reducedMotion = usePrefersReducedMotion();

  const model = React.useMemo(
    () =>
      deriveExecDashboard(
        { campaigns, candidates, outreach, replies, bookings, activities, settings, wins },
        demoMode,
      ),
    [campaigns, candidates, outreach, replies, bookings, activities, settings, wins, demoMode],
  );

  function exportDashboard() {
    downloadText("exec-dashboard.md", execMarkdown(model));
    toast({
      title: "Exec dashboard exported",
      description: "exec-dashboard.md downloaded from this browser session.",
      variant: "success",
    });
  }

  const exportAllowed = execCanExport(role);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Executive"
        title="Exec Dashboard"
        description="Read-only sourcing performance for leadership, derived from the same canonical real-send metrics used by Mission Control."
        actions={
          exportAllowed ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" aria-hidden />}
              onClick={exportDashboard}
              disabled={!hydrated}
            >
              Export dashboard
            </Button>
          ) : null
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<SkeletonCard className="h-96" />}>
        <motion.div
          className="space-y-6"
          variants={staggerContainer}
          initial={reducedMotion ? false : "hidden"}
          animate="show"
        >
          {model.demoMode ? (
            <motion.div
              variants={fadeUp}
              className="rounded-2xl border border-tangerine/25 bg-tangerine-soft px-4 py-3 text-sm font-semibold text-tangerine"
            >
              Demo data - synthetic
            </motion.div>
          ) : null}

          <motion.div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            variants={staggerContainer}
          >
            <KpiTile
              icon={<Users className="h-5 w-5" aria-hidden />}
              label="Candidates sourced"
              value={formatNumber(model.kpis.candidatesSourced)}
              hint="Live mode excludes synthetic candidate records."
              tone="electric"
            />
            <KpiTile
              icon={<Mail className="h-5 w-5" aria-hidden />}
              label="Contacted"
              value={formatNumber(model.kpis.contacted)}
              hint="Completed real sends only."
              tone="tangerine"
            />
            <KpiTile
              icon={<Reply className="h-5 w-5" aria-hidden />}
              label="Reply rate"
              value={formatPercent(model.kpis.replyRate)}
              hint="Replies tied to contacted candidates."
              tone="aqua"
            />
            <KpiTile
              icon={<Target className="h-5 w-5" aria-hidden />}
              label="Positive-reply rate"
              value={formatPercent(model.facts.positiveReplyRate)}
              hint="Interested or qualified-interest replies."
              tone="success"
            />
            <KpiTile
              icon={<CalendarCheck className="h-5 w-5" aria-hidden />}
              label="Meetings booked"
              value={formatNumber(model.kpis.interviewsBooked)}
              hint="Bookings tied to real contacted candidates."
              tone="violet"
            />
            <KpiTile
              icon={<Timer className="h-5 w-5" aria-hidden />}
              label="Time to first interview"
              value={formatHours(model.kpis.timeToFirstInterviewHours)}
              hint="Canonical campaign timing from metrics.ts."
              tone="neutral"
            />
            <KpiTile
              icon={<BarChart3 className="h-5 w-5" aria-hidden />}
              label="Avg match score"
              value={formatNumber(model.kpis.avgMatchScore)}
              hint="Average across in-scope sourced candidates."
              tone="electric"
            />
            <OpenRateTile />
          </motion.div>

          <TrendPanel model={model} />

          <div className="grid gap-6 xl:grid-cols-2">
            <FunnelRows title="By platform" rows={model.platformFunnels} />
            <FunnelRows title="By campaign" rows={model.campaignFunnels} />
          </div>

          {!exportAllowed ? (
            <motion.div
              variants={fadeUp}
              className="flex items-center gap-2 rounded-2xl border border-line bg-surface/70 px-4 py-3 text-sm text-muted"
            >
              <EyeOff className="h-4 w-4" aria-hidden />
              Viewer mode redacts win candidates to first name and role. Export is admin-only.
            </motion.div>
          ) : null}

          <WinsFeed model={model} role={role} />
        </motion.div>
      </HydrationGate>
    </div>
  );
}
