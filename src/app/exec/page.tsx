"use client";

import * as React from "react";
import { BarChart3, CalendarCheck, Download, EyeOff, Mail, MousePointerClick, Reply, Target, Timer, Trophy, Users } from "lucide-react";
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
import { deriveExecDashboard, execCanExport, execWinCandidateLabel, type ExecDashboardModel, type ExecFunnelRow } from "@/lib/exec-dashboard";
import { ROLE_LABEL } from "@/lib/rbac";
import { supabaseEnabled } from "@/lib/supabase/config";
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
        <div className="space-y-6">
          {model.demoMode ? (
            <div className="rounded-2xl border border-tangerine/25 bg-tangerine-soft px-4 py-3 text-sm font-semibold text-tangerine">
              Demo data - synthetic
            </div>
          ) : null}

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
