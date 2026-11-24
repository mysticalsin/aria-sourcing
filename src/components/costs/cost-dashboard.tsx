"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Eyebrow, Progress } from "@/components/ui";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { AI_ACTIVITIES, isAiActivity } from "@/lib/ai/activities";
import type { ActivityUsage, AiUsageReport } from "@/lib/ai/usage";
import { cn, type Tone } from "@/lib/utils";
import { Coins, Info, Lock, RefreshCw, TrendingUp } from "lucide-react";

/* ---- Formatting ----------------------------------------------------------- */

/** Small amounts keep enough digits to compare activities ($0.0043 vs $0.0001). */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

const formatCount = (value: number) => Math.round(value).toLocaleString("en-US");
const formatTokens = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** Share as text: a real but tiny share reads "<1%", never "0%". */
const share = (part: number, whole: number) => (part > 0 && percent(part, whole) === 0 ? "<1%" : `${percent(part, whole)}%`);
/** "How many the budget buys" is an order of magnitude: two significant digits. */
const approx = (value: number) => {
  if (value < 100) return formatCount(value);
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return formatCount(Math.round(value / magnitude) * magnitude);
};

function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
}

function modelTier(model: string): "Haiku" | "Sonnet" | "Opus" | "Other" {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("opus")) return "Opus";
  return "Other";
}

function budgetState(spent: number, cap: number): { tone: Tone; label: string } {
  if (cap <= 0 || spent >= cap) return { tone: "danger", label: "Cap reached: AI paused, fallbacks in use" };
  if (spent / cap >= 0.8) return { tone: "warning", label: "Close to the cap" };
  return { tone: "success", label: "Within budget" };
}

function activityInfo(id: string) {
  return isAiActivity(id) ? AI_ACTIVITIES[id] : AI_ACTIVITIES.untracked;
}

/* ---- Page body ------------------------------------------------------------ */

/**
 * What Claude costs this app, split by business activity so the most
 * expensive one is obvious and can be justified. Figures are estimated from
 * the token counts Anthropic returns with every call and the public price
 * list; the Anthropic Console stays the billing reference. Admin only.
 */
export function CostDashboard() {
  const role = useRole();
  const isAdmin = can(role, "manage_models");
  const [report, setReport] = React.useState<AiUsageReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/usage", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Only admins can see AI costs." : "AI costs are unavailable right now.");
      setReport((await res.json()) as AiUsageReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI costs are unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<Lock className="h-6 w-6" aria-hidden />}
        title="Only admins can see AI costs"
        description="Ask an admin of this workspace for access, or for the monthly figures."
      />
    );
  }

  const refresh = (
    <Button variant="outline" size="sm" loading={loading} leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={() => void load()}>
      Refresh
    </Button>
  );

  if (error) {
    return <EmptyState icon={<Coins className="h-6 w-6" aria-hidden />} title="AI costs are not available" description={error} action={refresh} />;
  }
  if (!report) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-32 rounded-3xl" />
          ))}
        </div>
        <div className="skeleton h-72 rounded-3xl" />
      </div>
    );
  }

  // Calls from before activity tracking keep the month exact but explain
  // nothing, so they never lead and always come last.
  const spent = report.byActivity.filter((a) => a.calls > 0);
  const tracked = spent.filter((a) => a.activity !== "untracked");
  const activities = [...tracked, ...spent.filter((a) => a.activity === "untracked")];
  if (activities.length === 0) {
    return (
      <EmptyState
        icon={<Coins className="h-6 w-6" aria-hidden />}
        title="No AI spend yet this month"
        description="Costs appear here as soon as Aria calls Claude: run Aria on a campaign, triage the inbox or read a brief. Each call is filed under the activity that made it."
        action={refresh}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {monthLabel(report.month)} · {formatCount(report.calls)} calls · updated {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </p>
        {refresh}
      </div>

      <KpiRow report={report} />
      {tracked[0] && <TopActivity top={tracked[0]} total={report.monthUsd} />}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ActivityBars activities={activities} total={report.monthUsd} />
        </div>
        <div className="xl:col-span-2">
          <ModelSplit report={report} />
        </div>
      </div>

      <JustificationTable activities={activities} total={report.monthUsd} monthlyLimit={report.monthlyLimitUsd} />
      <DailyChart report={report} />
      {report.months.length > 1 && <MonthHistory months={report.months} />}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Estimated from the token counts Anthropic returns with every call and the public price list (no prompt or answer
          is stored). The Anthropic Console remains the billing reference and holds the hard spend limit. Day history starts{" "}
          {report.trackedSince ? dayLabel(report.trackedSince, { day: "numeric", month: "long" }) : "today"}.
        </span>
      </p>
    </div>
  );
}

/* ---- KPI row -------------------------------------------------------------- */

function KpiRow({ report }: { report: AiUsageReport }) {
  const month = budgetState(report.monthUsd, report.monthlyLimitUsd);
  const day = budgetState(report.dayUsd, report.dailyLimitUsd);
  const projected = budgetState(report.projectedMonthUsd, report.monthlyLimitUsd);
  const avg = report.calls > 0 ? report.monthUsd / report.calls : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-tour="cost-kpis">
      <Tile label="This month" value={formatUsd(report.monthUsd)} suffix={`of $${report.monthlyLimitUsd}`}>
        <Progress
          value={report.monthlyLimitUsd > 0 ? Math.min(100, (report.monthUsd / report.monthlyLimitUsd) * 100) : 100}
          tone={month.tone}
          aria-label={`This month: ${formatUsd(report.monthUsd)} of $${report.monthlyLimitUsd}`}
        />
        <p className="mt-2 text-xs text-muted">{month.label}</p>
      </Tile>
      <Tile label="Today" value={formatUsd(report.dayUsd)} suffix={`of $${report.dailyLimitUsd} a day`}>
        <Progress
          value={report.dailyLimitUsd > 0 ? Math.min(100, (report.dayUsd / report.dailyLimitUsd) * 100) : 100}
          tone={day.tone}
          aria-label={`Today: ${formatUsd(report.dayUsd)} of $${report.dailyLimitUsd}`}
        />
        <p className="mt-2 text-xs text-muted">{day.label}</p>
      </Tile>
      <Tile label="Month end at this pace" value={formatUsd(report.projectedMonthUsd)} suffix="projected">
        <p className="text-xs text-muted">
          {projected.tone === "success"
            ? `${percent(report.projectedMonthUsd, report.monthlyLimitUsd)}% of the monthly budget.`
            : "Above the budget at this pace: the cap will pause AI before month end."}
        </p>
      </Tile>
      <Tile label="Calls this month" value={formatCount(report.calls)} suffix={`${formatUsd(avg)} each on average`}>
        <p className="text-xs text-muted">One call is one draft, one sorted reply, one brief read or one agent round.</p>
      </Tile>
    </div>
  );
}

function Tile({ label, value, suffix, children }: { label: string; value: string; suffix: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-3xl font-extrabold tabular-nums text-ink">
          {value} <span className="text-sm font-semibold text-muted">{suffix}</span>
        </p>
        {children}
      </CardBody>
    </Card>
  );
}

/* ---- Most expensive activity --------------------------------------------- */

function TopActivity({ top, total }: { top: ActivityUsage; total: number }) {
  const info = activityInfo(top.activity);
  return (
    <Card className="border-electric/25 bg-electric-soft/40">
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-electric text-white" aria-hidden>
          <TrendingUp className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-electric">Most expensive activity this month</p>
          <p className="mt-1 text-lg font-bold text-ink">
            {info.label}: {formatUsd(top.costUsd)}{" "}
            <span className="font-semibold text-muted">({share(top.costUsd, total)} of the month)</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {formatCount(top.calls)} {top.calls === 1 ? info.unit : `${info.unit}s`} at {formatUsd(top.costUsd / Math.max(1, top.calls))} each.{" "}
            {info.why}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---- Ranked bars ---------------------------------------------------------- */

function ActivityBars({ activities, total }: { activities: ActivityUsage[]; total: number }) {
  const max = Math.max(...activities.map((a) => a.costUsd), 0);
  return (
    <Card className="h-full" data-tour="cost-activities">
      <CardHeader>
        <Eyebrow>Where the money goes</Eyebrow>
        <CardTitle className="mt-1">Cost by activity, this month</CardTitle>
      </CardHeader>
      <CardBody>
        <ol className="space-y-3">
          {activities.map((a, index) => {
            const info = activityInfo(a.activity);
            const width = max > 0 ? Math.max(1.5, (a.costUsd / max) * 100) : 0;
            return (
              <li key={a.activity} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)_7rem]">
                <span className="truncate text-sm font-semibold text-ink" title={info.produces}>
                  {info.label}
                </span>
                <span className="text-right text-sm font-bold tabular-nums text-ink sm:order-3">
                  {formatUsd(a.costUsd)}
                  <span className="ml-1.5 text-xs font-semibold text-muted">{share(a.costUsd, total)}</span>
                </span>
                <span className="col-span-2 h-2.5 overflow-hidden rounded-full bg-ink/[0.06] sm:order-2 sm:col-span-1" aria-hidden>
                  <span
                    className={cn("block h-full rounded-full", a.activity === "untracked" ? "bg-ink/20" : index === 0 ? "bg-electric" : "bg-electric/45")}
                    style={{ width: `${width}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}

/* ---- Model split ---------------------------------------------------------- */

function ModelSplit({ report }: { report: AiUsageReport }) {
  const tiers = new Map<string, { cost: number; calls: number }>();
  for (const row of report.byTask) {
    const tier = modelTier(row.model);
    const current = tiers.get(tier) ?? { cost: 0, calls: 0 };
    tiers.set(tier, { cost: current.cost + row.costUsd, calls: current.calls + row.calls });
  }
  const rows = [...tiers.entries()].sort((a, b) => b[1].cost - a[1].cost);
  const totalCalls = rows.reduce((sum, [, v]) => sum + v.calls, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <Eyebrow>Which model</Eyebrow>
        <CardTitle className="mt-1">Spend and calls by model</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">The model split appears with the next call.</p>
        ) : (
          rows.map(([tier, v]) => (
            <div key={tier}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{tier}</p>
                <p className="text-sm font-bold tabular-nums text-ink">
                  {formatUsd(v.cost)} <span className="text-xs font-semibold text-muted">{share(v.cost, report.monthUsd)} of spend</span>
                </p>
              </div>
              <Progress value={percent(v.cost, report.monthUsd)} tone="electric" className="mt-1.5" aria-label={`${tier}: ${percent(v.cost, report.monthUsd)}% of spend`} />
              <p className="mt-1 text-xs text-muted">
                {formatCount(v.calls)} calls ({share(v.calls, totalCalls)} of calls), {formatUsd(v.cost / Math.max(1, v.calls))} per call
              </p>
            </div>
          ))
        )}
        <p className="rounded-2xl bg-canvas px-3 py-2 text-xs text-muted">
          Haiku handles the frequent, structured jobs (sorting replies, reading briefs) for a fraction of a cent. Sonnet writes
          what candidates read, where quality pays for itself.
        </p>
      </CardBody>
    </Card>
  );
}

/* ---- Justification -------------------------------------------------------- */

function JustificationTable({ activities, total, monthlyLimit }: { activities: ActivityUsage[]; total: number; monthlyLimit: number }) {
  const rows = activities.map((a) => {
    const info = activityInfo(a.activity);
    const perUnit = a.costUsd / Math.max(1, a.calls);
    const models = Object.keys(a.models).map(modelTier);
    return {
      a,
      info,
      perUnit,
      model: [...new Set(models)].join(", ") || info.model,
      // Old untracked calls mix every activity: a unit price would mean nothing.
      buys: perUnit > 0 && a.activity !== "untracked" ? Math.floor(monthlyLimit / perUnit) : null,
    };
  });
  return (
    <Card data-tour="cost-justification">
      <CardHeader>
        <Eyebrow>Why it costs what it costs</Eyebrow>
        <CardTitle className="mt-1">What each activity buys</CardTitle>
        <p className="mt-1 text-sm text-muted">
          The cost of one result, the model behind it and why that model, and how many of these the monthly budget would pay for.
        </p>
      </CardHeader>
      <CardBody>
        {/* Phones: one card per activity. */}
        <ul className="space-y-3 md:hidden">
          {rows.map(({ a, info, perUnit, model, buys }) => (
            <li key={a.activity} className="rounded-2xl border border-line p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{info.label}</p>
                <p className="font-bold tabular-nums text-ink">{formatUsd(a.costUsd)}</p>
              </div>
              <p className="mt-1 text-xs text-muted">{info.produces}</p>
              <p className="mt-2 text-sm text-ink">
                {formatUsd(perUnit)} per {info.unit} · {formatCount(a.calls)} {a.calls === 1 ? info.unit : `${info.unit}s`} · {share(a.costUsd, total)}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                <Badge tone="neutral" size="sm">{model}</Badge> {info.why}
              </p>
              {buys !== null && (
                <p className="mt-1 text-xs font-semibold text-ink-soft">
                  ${monthlyLimit} buys about {approx(buys)} {info.unit}s
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">Cost per activity this month, with the model used and why</caption>
            <thead>
              <tr className="border-b border-line text-left text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3">Activity</th>
                <th scope="col" className="py-2 pr-3">Model and why</th>
                <th scope="col" className="py-2 pr-3 text-right">Results</th>
                <th scope="col" className="py-2 pr-3 text-right">Per result</th>
                <th scope="col" className="py-2 pr-3 text-right">Tokens in / out</th>
                <th scope="col" className="py-2 pr-3 text-right">This month</th>
                <th scope="col" className="py-2 text-right">${monthlyLimit} buys</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, info, perUnit, model, buys }) => (
                <tr key={a.activity} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-ink">{info.label}</p>
                    <p className="mt-0.5 max-w-[16rem] text-xs text-muted">{info.produces}</p>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge tone="neutral" size="sm">{model}</Badge>
                    <p className="mt-1 max-w-[18rem] text-xs text-ink-soft">{info.why}</p>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-ink">
                    {formatCount(a.calls)} <span className="text-xs text-muted">{a.calls === 1 ? info.unit : `${info.unit}s`}</span>
                  </td>
                  <td className="py-3 pr-3 text-right font-semibold tabular-nums text-ink">{formatUsd(perUnit)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-muted">
                    {formatTokens(a.inputTokens)} / {formatTokens(a.outputTokens)}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    <span className="font-bold text-ink">{formatUsd(a.costUsd)}</span>
                    <span className="block text-xs text-muted">{share(a.costUsd, total)}</span>
                  </td>
                  <td className="py-3 text-right tabular-nums text-ink-soft">{buys !== null ? `≈ ${approx(buys)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---- Last 30 days --------------------------------------------------------- */

function DailyChart({ report }: { report: AiUsageReport }) {
  const days = report.daily;
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  const [selected, setSelected] = React.useState(days.length - 1);
  const day = days[selected] ?? days[days.length - 1];
  const breakdown = Object.entries(day?.byActivity ?? {})
    .filter(([, cost]) => cost > 0)
    .sort((a, b) => b[1] - a[1]);
  const spentDays = days.filter((d) => d.costUsd > 0).length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Eyebrow>Trend</Eyebrow>
          <CardTitle className="mt-1">Last 30 days</CardTitle>
        </div>
        <p className="text-xs text-muted">
          {spentDays} {spentDays === 1 ? "day" : "days"} with spend · busiest {formatUsd(max)}
        </p>
      </CardHeader>
      <CardBody>
        <div className="relative">
          <span className="absolute -top-1 left-0 text-[0.625rem] font-semibold tabular-nums text-muted">{formatUsd(max)}</span>
          <div
            role="group"
            aria-label="Daily AI spend, last 30 days. Select a day for its breakdown."
            className="flex h-36 items-end gap-[2px] border-b border-line pt-4 sm:gap-1"
          >
            {days.map((d, i) => {
              const height = max > 0 && d.costUsd > 0 ? Math.max(3, (d.costUsd / max) * 100) : 0;
              return (
                <button
                  key={d.day}
                  type="button"
                  onClick={() => setSelected(i)}
                  onMouseEnter={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  aria-pressed={i === selected}
                  aria-label={`${dayLabel(d.day)}: ${formatUsd(d.costUsd)}, ${d.calls} calls`}
                  className="group flex h-full min-w-0 flex-1 items-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                >
                  <span
                    className={cn(
                      "block w-full rounded-t-[3px] transition-colors",
                      i === selected ? "bg-electric" : "bg-electric/40 group-hover:bg-electric/70",
                      height === 0 && "bg-transparent",
                    )}
                    style={{ height: `${height}%` }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[0.625rem] font-semibold text-muted" aria-hidden>
            <span>{dayLabel(days[0].day)}</span>
            <span>{dayLabel(days[Math.floor(days.length / 2)].day)}</span>
            <span>{dayLabel(days[days.length - 1].day)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-canvas px-3 py-2.5" aria-live="polite">
          <p className="text-sm font-semibold text-ink">
            {dayLabel(day.day, { weekday: "long", day: "numeric", month: "long" })}: {formatUsd(day.costUsd)}
            <span className="font-normal text-muted"> · {formatCount(day.calls)} calls</span>
          </p>
          {breakdown.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
              {breakdown.map(([id, cost]) => (
                <li key={id}>
                  {activityInfo(id).label} <span className="font-semibold tabular-nums text-ink">{formatUsd(cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">No AI spend that day.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ---- Months --------------------------------------------------------------- */

function MonthHistory({ months }: { months: { month: string; costUsd: number; calls: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <Eyebrow>History</Eyebrow>
        <CardTitle className="mt-1">By month</CardTitle>
      </CardHeader>
      <CardBody>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">AI spend per month</caption>
          <thead>
            <tr className="border-b border-line text-left text-[0.6875rem] font-bold uppercase tracking-wider text-muted">
              <th scope="col" className="py-2">Month</th>
              <th scope="col" className="py-2 text-right">Calls</th>
              <th scope="col" className="py-2 text-right">Spend</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => (
              <tr key={m.month} className="border-b border-line last:border-0">
                <td className="py-2 text-ink">{monthLabel(m.month)}</td>
                <td className="py-2 text-right tabular-nums text-muted">{formatCount(m.calls)}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-ink">{formatUsd(m.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}


