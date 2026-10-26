"use client";

import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarCheck,
  Clock,
  Download,
  EyeOff,
  FileText,
  Mail,
  MousePointerClick,
  PiggyBank,
  Printer,
  Reply,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { TrendSpark } from "@/components/charts/trend-spark";
import { Badge, Button, Card, CardContent, CardTitle, EmptyState, Eyebrow, SkeletonCard, useToast } from "@/components/ui";
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
  EXEC_PERIODS,
  EXEC_PERIOD_LABEL,
  deriveExecDashboard,
  execCanExport,
  execWinCandidateLabel,
  type ExecDashboardModel,
  type ExecDecisionReport,
  type ExecFunnelRow,
  type ExecPeriod,
} from "@/lib/exec-dashboard";
import { ROLE_LABEL } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn, downloadText, formatCurrency, formatDateTime, formatNumber, formatPercent, formatTimeAgo, round, type Tone } from "@/lib/utils";

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
  const { report } = model;
  const lines = [
    "# Exec Dashboard",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Period: ${EXEC_PERIOD_LABEL[report.period]}`,
    `Mode: ${model.demoMode ? "Demo data - synthetic" : "Live"}`,
    "",
    "## Recruiting funnel",
    ...(report.simulated ? ["Contacts are approved dry-run sends: no email left the system.", ""] : []),
    ...report.conversion.map(
      (step) =>
        `${step.label}: ${step.count}${step.rateFromPrevious == null ? "" : ` (${formatPercent(step.rateFromPrevious)} of previous step)`}`,
    ),
    "",
    "## Value of recruiter time saved",
    `Hours saved: ${round(report.value.hoursSaved, 1)}`,
    `Value of time saved: ${formatCurrency(report.value.valueSaved)}`,
    `Annualized saving: ${formatCurrency(report.value.annualSaving)} vs. ${formatCurrency(report.value.annualCost)} annual cost (${round(report.value.multiple, 1)}x)`,
    `Assumptions: ${formatCurrency(report.value.assumptions.hourlyCost)}/h, ${report.value.assumptions.hoursPerSourced} h per profile, ${report.value.assumptions.hoursPerDraft} h per draft, ${report.value.assumptions.hoursPerBooking} h per booking`,
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

function PeriodPicker({ value, onChange }: { value: ExecPeriod; onChange: (period: ExecPeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Reporting period" className="inline-flex rounded-full bg-ink/[0.05] p-1 print:hidden">
      {EXEC_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          role="radio"
          aria-checked={value === period}
          onClick={() => onChange(period)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric",
            value === period ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
          )}
        >
          {period === "all" ? "All" : period}
        </button>
      ))}
    </div>
  );
}

function ConversionFunnel({ report }: { report: ExecDecisionReport }) {
  const top = Math.max(1, report.conversion[0]?.count ?? 0);
  return (
    <div className="space-y-2.5">
      {report.conversion.map((step) => (
        <div key={step.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 print:break-inside-avoid">
          <span className="truncate text-sm font-semibold text-ink-soft">{step.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            <div
              className="h-full rounded-full bg-tangerine"
              style={{ width: `${Math.max(step.count > 0 ? 2 : 0, (step.count / top) * 100)}%` }}
            />
          </div>
          <span className="w-28 text-right text-sm tabular-nums">
            <span className="font-extrabold text-ink">{formatNumber(step.count)}</span>
            {step.rateFromPrevious != null ? (
              <span className="ml-1.5 text-xs text-muted">{formatPercent(step.rateFromPrevious)}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function ValueStat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/70 p-4 print:break-inside-avoid">
      <div className="mb-2 flex items-center gap-2 text-ink-soft">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</span>
      </div>
      <p className="text-2xl font-extrabold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function DecisionReport({ report }: { report: ExecDecisionReport }) {
  const { value } = report;
  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Eyebrow>Decision report · {EXEC_PERIOD_LABEL[report.period]}</Eyebrow>
            <CardTitle className="mt-1 text-lg">From sourcing to interviews, and what it saved</CardTitle>
          </div>
          {report.simulated ? (
            <Badge tone="warning" size="sm" dot>
              Simulated sends (dry-run): no email left the system
            </Badge>
          ) : (
            <Badge tone="success" size="sm" dot>
              Real sends only
            </Badge>
          )}
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-3 text-sm font-bold text-ink">Conversion funnel</p>
            <ConversionFunnel report={report} />
            <p className="mt-3 text-xs text-muted">Percentages are the share of the previous step.</p>
          </div>
          <div>
            <p className="mb-3 text-sm font-bold text-ink">Value of recruiter time saved</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ValueStat
                icon={<Clock className="h-4 w-4" aria-hidden />}
                label="Hours saved"
                value={`${formatNumber(round(value.hoursSaved, 1))} h`}
                hint={`Over ${formatNumber(value.spanDays)} day${value.spanDays === 1 ? "" : "s"} of activity.`}
              />
              <ValueStat
                icon={<PiggyBank className="h-4 w-4" aria-hidden />}
                label="Value of time saved"
                value={formatCurrency(value.valueSaved)}
                hint={`At ${formatCurrency(value.assumptions.hourlyCost)}/h recruiter cost.`}
              />
              <ValueStat
                icon={<TrendingUp className="h-4 w-4" aria-hidden />}
                label="Annualized return"
                value={`${formatNumber(round(value.multiple, 1))}×`}
                hint={`${formatCurrency(value.annualSaving)} saved vs. ${formatCurrency(value.annualCost)} cost per year.`}
              />
              <ValueStat
                icon={<CalendarCheck className="h-4 w-4" aria-hidden />}
                label="Saved per interview"
                value={value.valuePerBooking == null ? "No interviews yet" : formatCurrency(value.valuePerBooking)}
                hint="Value of time saved divided by interviews booked."
              />
            </div>
            <p className="mt-3 text-xs text-muted">
              Estimates use editable assumptions ({value.assumptions.hoursPerSourced} h per profile,{" "}
              {value.assumptions.hoursPerDraft} h per draft, {value.assumptions.hoursPerBooking} h per booking).{" "}
              <Link href="/trust" className="font-semibold text-electric hover:underline print:hidden">
                Adjust them in Trust &amp; ROI
              </Link>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink/[0.04] text-ink-soft">
            {icon}
          </div>
          <Badge tone={tone} size="sm" dot>
            Canonical
          </Badge>
        </div>
        <div>
          <p className="text-2xl font-extrabold tabular-nums text-ink">{value}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
        </div>
        <p className="text-sm text-muted">{hint}</p>
      </CardContent>
    </Card>
  );
}

function OpenRateTile() {
  return (
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
  );
}

function FunnelRows({ title, rows }: { title: string; rows: ExecFunnelRow[] }) {
  return (
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
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-line bg-surface/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{row.label}</p>
                    <p className="text-xs text-muted">
                      Avg match {formatNumber(row.avgMatchScore)}
                      {row.timeToFirstInterviewHours != null ? ` · ${formatNumber(row.timeToFirstInterviewHours)}h TTFI` : ""}
                    </p>
                  </div>
                  <Badge tone="success" size="sm">
                    {formatPercent(row.facts.replyRate)}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                  <MiniStat label="Sourced" value={row.facts.sourced} />
                  <MiniStat label="Sent" value={row.facts.contacted} />
                  <MiniStat label="Replies" value={row.facts.repliedCount} />
                  <MiniStat label="Positive" value={row.facts.positiveReplies} />
                  <MiniStat label="Booked" value={row.facts.booked} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-ink/[0.035] px-2 py-2">
      <p className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="text-sm font-extrabold tabular-nums text-ink">{formatNumber(value)}</p>
    </div>
  );
}

function TrendPanel({ model }: { model: ExecDashboardModel }) {
  return (
    <Card>
      <CardContent>
        <div className="mb-4">
          <Eyebrow>Trends</Eyebrow>
          <CardTitle className="mt-1 text-base">Real activity history</CardTitle>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Spark label="Sourced" data={model.trends.sourced} tone="electric" />
          <Spark label="Contacted" data={model.trends.contacted} tone="tangerine" />
          <Spark label="Replies" data={model.trends.replied} tone="aqua" />
          <Spark label="Booked" data={model.trends.booked} tone="success" />
        </div>
      </CardContent>
    </Card>
  );
}

function Spark({ label, data, tone }: { label: string; data: number[]; tone: Tone }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/70 p-3">
      <p className="mb-2 text-sm font-bold text-ink">{label}</p>
      <TrendSpark data={data} tone={tone} />
    </div>
  );
}

function WinsFeed({ model, role }: { model: ExecDashboardModel; role: ReturnType<typeof useRole> }) {
  return (
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
          <div className="grid gap-3 lg:grid-cols-2">
            {model.recentWins.map((win) => (
              <div key={win.id} className="rounded-2xl border border-line bg-surface/70 p-4">
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
                  <span>{formatNumber(win.touchCount)} touch{win.touchCount === 1 ? "" : "es"}</span>
                  <span>{formatDuration(win.timeToBookMs)}</span>
                  <span>{formatTimeAgo(win.at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
  const [period, setPeriod] = React.useState<ExecPeriod>("30d");

  const model = React.useMemo(
    () =>
      deriveExecDashboard(
        { campaigns, candidates, outreach, replies, bookings, activities, settings, wins },
        demoMode,
        { period },
      ),
    [campaigns, candidates, outreach, replies, bookings, activities, settings, wins, demoMode, period],
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
        description="Recruiting performance and value for leadership: candidates sourced, conversion to interviews, and recruiter time saved."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PeriodPicker value={period} onChange={setPeriod} />
            {exportAllowed ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Printer className="h-4 w-4" aria-hidden />}
                  onClick={() => window.print()}
                  disabled={!hydrated}
                >
                  Download PDF
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Download className="h-4 w-4" aria-hidden />}
                  onClick={exportDashboard}
                  disabled={!hydrated}
                >
                  Export Markdown
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<SkeletonCard className="h-96" />}>
        <div className="space-y-6">
          {model.demoMode ? (
            <div className="rounded-2xl border border-tangerine/25 bg-tangerine-soft px-4 py-3 text-sm font-semibold text-tangerine">
              Demo data - synthetic
            </div>
          ) : null}

          <DecisionReport report={model.report} />

          <p className="hidden text-xs text-muted print:block">
            <FileText className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            ARIA exec report · {EXEC_PERIOD_LABEL[model.report.period]} · generated {formatDateTime(new Date().toISOString())}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          </div>

          <TrendPanel model={model} />

          <div className="grid gap-6 xl:grid-cols-2">
            <FunnelRows title="By platform" rows={model.platformFunnels} />
            <FunnelRows title="By campaign" rows={model.campaignFunnels} />
          </div>

          {!exportAllowed ? (
            <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface/70 px-4 py-3 text-sm text-muted">
              <EyeOff className="h-4 w-4" aria-hidden />
              Viewer mode redacts win candidates to first name and role. Export is admin-only.
            </div>
          ) : null}

          <WinsFeed model={model} role={role} />
        </div>
      </HydrationGate>
    </div>
  );
}
