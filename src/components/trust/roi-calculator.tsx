"use client";

/* ============================================================================
   4.3 Trust & ROI Proof Center — ROI calculator.

   Every number on screen is either:
   (a) a real, auditable count pulled straight from the store via selector
       hooks (useCandidates/useOutreach/useBookings), or
   (b) a buyer-editable assumption (sliders below) with a sane illustrative
       default.
   The multiple and annual saving are *computed*, live, from (a) x (b) --
   nothing here is a hardcoded "results" number. The "How we counted" drawer
   shows the raw counts so a buyer can audit the math themselves.
   ========================================================================== */

import * as React from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator, Sparkles, Info } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow, Drawer, EmptyState, Button } from "@/components/ui";
import { useCandidates, useOutreach, useBookings } from "@/lib/store";
import { formatCurrency, formatNumber, round } from "@/lib/utils";

interface Assumption {
  key: string;
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

function AssumptionSlider({ a }: { a: Assumption }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={a.key} className="text-sm font-semibold text-ink-soft">
          {a.label}
        </label>
        <span className="shrink-0 font-bold tabular-nums text-ink">{a.format(a.value)}</span>
      </div>
      <input
        id={a.key}
        type="range"
        min={a.min}
        max={a.max}
        step={a.step}
        value={a.value}
        onChange={(e) => a.onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-ink/10 accent-tangerine"
        aria-valuetext={a.format(a.value)}
      />
      <p className="text-xs text-muted">{a.hint}</p>
    </div>
  );
}

function spanDaysFrom(dates: string[]): number {
  const ts = dates.map((d) => new Date(d).getTime()).filter((n) => Number.isFinite(n));
  if (ts.length === 0) return 1;
  const spanMs = Math.max(...ts) - Math.min(...ts);
  return Math.max(1, round(spanMs / 86_400_000, 1));
}

export function RoiCalculator() {
  const candidates = useCandidates();
  const outreach = useOutreach();
  const bookings = useBookings();

  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // ---- Editable assumptions (buyer-tunable; illustrative defaults) --------
  const [hourlyCost, setHourlyCost] = React.useState(60);
  const [hoursPerSourced, setHoursPerSourced] = React.useState(0.25);
  const [hoursPerDraft, setHoursPerDraft] = React.useState(0.2);
  const [hoursPerBooking, setHoursPerBooking] = React.useState(1.5);
  const [monthlyCost, setMonthlyCost] = React.useState(1500);

  // ---- Real, auditable counts ---------------------------------------------
  const sourcedCount = candidates.length;
  const draftedCount = outreach.length;
  const sentCount = React.useMemo(() => outreach.filter((m) => m.status === "Scheduled").length, [outreach]);
  const bookedCount = bookings.length;

  const spanDays = React.useMemo(
    () =>
      spanDaysFrom([
        ...candidates.map((c) => c.createdAt),
        ...outreach.map((m) => m.createdAt),
        ...bookings.map((b) => b.createdAt),
      ]),
    [candidates, outreach, bookings],
  );

  const earliestIso = React.useMemo(() => {
    const all = [...candidates.map((c) => c.createdAt), ...outreach.map((m) => m.createdAt), ...bookings.map((b) => b.createdAt)];
    if (all.length === 0) return null;
    return all.reduce((min, d) => (d < min ? d : min), all[0]);
  }, [candidates, outreach, bookings]);

  const latestIso = React.useMemo(() => {
    const all = [...candidates.map((c) => c.createdAt), ...outreach.map((m) => m.createdAt), ...bookings.map((b) => b.createdAt)];
    if (all.length === 0) return null;
    return all.reduce((max, d) => (d > max ? d : max), all[0]);
  }, [candidates, outreach, bookings]);

  // ---- Live computation: assumption x count, nothing hardcoded ------------
  const totalHoursSaved = sourcedCount * hoursPerSourced + draftedCount * hoursPerDraft + bookedCount * hoursPerBooking;
  const totalDollarSaved = totalHoursSaved * hourlyCost;
  const dailyRate = totalDollarSaved / spanDays;
  const annualSaving = dailyRate * 365;
  const annualCost = monthlyCost * 12;
  const multiple = annualCost > 0 ? annualSaving / annualCost : 0;

  const chartData = [
    { name: "Your assumed annual cost", value: Math.round(annualCost) },
    { name: "Computed annual saving", value: Math.round(annualSaving) },
  ];

  if (sourcedCount === 0 && draftedCount === 0 && bookedCount === 0) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<Calculator className="h-6 w-6" aria-hidden />}
            title="Nothing to calculate yet"
            description="The ROI calculator derives every number from real sourcing, outreach and booking activity — source and work a campaign first."
            action={
              <Link
                href="/campaigns"
                className="inline-flex h-11 items-center rounded-full bg-tangerine px-6 text-sm font-semibold text-white shadow-soft hover:bg-tangerine/90"
              >
                Go to Campaigns
              </Link>
            }
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <Eyebrow className="mb-1 block">ROI calculator</Eyebrow>
          <CardTitle>Recruiter hours saved, priced by you</CardTitle>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Drag any assumption below — the multiple and annual saving recompute live. Every figure is an
            editable assumption multiplied by a real, auditable count from this workspace.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="shrink-0 gap-2"
          onClick={() => setDrawerOpen(true)}
        >
          <Info className="h-4 w-4" aria-hidden />
          How we counted
        </Button>
      </CardHeader>
      <CardBody className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-5">
          <AssumptionSlider
            a={{
              key: "hourlyCost",
              label: "Recruiter fully-loaded hourly cost",
              hint: "Editable assumption — your blended recruiter cost per hour.",
              value: hourlyCost,
              onChange: setHourlyCost,
              min: 20,
              max: 150,
              step: 5,
              format: (v) => formatCurrency(v) + "/hr",
            }}
          />
          <AssumptionSlider
            a={{
              key: "hoursPerSourced",
              label: "Hours saved per profile sourced & scored",
              hint: `Applied to ${formatNumber(sourcedCount)} sourced profile${sourcedCount === 1 ? "" : "s"} in this workspace.`,
              value: hoursPerSourced,
              onChange: setHoursPerSourced,
              min: 0.05,
              max: 1,
              step: 0.05,
              format: (v) => `${round(v, 2)} hr`,
            }}
          />
          <AssumptionSlider
            a={{
              key: "hoursPerDraft",
              label: "Hours saved per personalized outreach drafted",
              hint: `Applied to ${formatNumber(draftedCount)} draft${draftedCount === 1 ? "" : "s"} in this workspace.`,
              value: hoursPerDraft,
              onChange: setHoursPerDraft,
              min: 0.05,
              max: 1,
              step: 0.05,
              format: (v) => `${round(v, 2)} hr`,
            }}
          />
          <AssumptionSlider
            a={{
              key: "hoursPerBooking",
              label: "Hours saved per interview scheduled",
              hint: `Applied to ${formatNumber(bookedCount)} booking${bookedCount === 1 ? "" : "s"} in this workspace.`,
              value: hoursPerBooking,
              onChange: setHoursPerBooking,
              min: 0.25,
              max: 4,
              step: 0.25,
              format: (v) => `${round(v, 2)} hr`,
            }}
          />
          <AssumptionSlider
            a={{
              key: "monthlyCost",
              label: "Your assumed platform cost",
              hint: "Editable assumption — swap in your real quoted price to see your multiple.",
              value: monthlyCost,
              onChange: setMonthlyCost,
              min: 200,
              max: 10_000,
              step: 100,
              format: (v) => formatCurrency(v) + "/mo",
            }}
          />
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-line bg-surface/60 p-6 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              <Sparkles className="h-3.5 w-3.5 text-tangerine" aria-hidden />
              Computed multiple
            </div>
            <p className="mt-2 text-5xl font-extrabold tabular-nums text-ink">{round(multiple, 1)}×</p>
            <p className="mt-2 text-sm text-muted">
              {formatCurrency(Math.round(annualSaving))} annualized saving vs. {formatCurrency(Math.round(annualCost))}{" "}
              assumed annual cost
            </p>
            <p className="mt-1 text-xs text-muted">
              Annualized from {formatCurrency(Math.round(totalDollarSaved))} saved across {spanDays} day
              {spanDays === 1 ? "" : "s"} of observed activity in this workspace.
            </p>
          </div>

          <div style={{ width: "100%", height: 160 }} role="img" aria-label={`Assumed annual cost ${formatCurrency(Math.round(annualCost))} versus computed annual saving ${formatCurrency(Math.round(annualSaving))}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
                barCategoryGap={18}
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--line))" strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--ink-soft))", fontSize: 11, fontWeight: 600 }}
                />
                <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={28} isAnimationActive fill="hsl(var(--electric))">
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: number) => formatCurrency(v)}
                    fill="hsl(var(--ink-soft))"
                    style={{ fontSize: 12, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardBody>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="How we counted"
        description="The raw, auditable counts behind every number above — nothing here is estimated."
      >
        <dl className="space-y-4 text-sm">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <dt className="text-ink-soft">Profiles sourced &amp; scored</dt>
            <dd className="font-bold tabular-nums text-ink">{formatNumber(sourcedCount)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <dt className="text-ink-soft">Outreach messages drafted</dt>
            <dd className="font-bold tabular-nums text-ink">{formatNumber(draftedCount)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <dt className="text-ink-soft">Outreach messages sent (Scheduled)</dt>
            <dd className="font-bold tabular-nums text-ink">{formatNumber(sentCount)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <dt className="text-ink-soft">Interviews booked</dt>
            <dd className="font-bold tabular-nums text-ink">{formatNumber(bookedCount)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <dt className="text-ink-soft">Observed activity span</dt>
            <dd className="font-bold tabular-nums text-ink">
              {spanDays} day{spanDays === 1 ? "" : "s"}
            </dd>
          </div>
          {earliestIso && latestIso && (
            <div className="flex items-baseline justify-between border-b border-line pb-3">
              <dt className="text-ink-soft">Date range</dt>
              <dd className="text-right text-xs font-semibold text-ink">
                {new Date(earliestIso).toLocaleDateString()} → {new Date(latestIso).toLocaleDateString()}
              </dd>
            </div>
          )}
          <div className="rounded-2xl bg-ink/[0.03] p-4 text-xs leading-relaxed text-muted">
            <p className="font-semibold text-ink-soft">Formula</p>
            <p className="mt-1">
              hours saved = (sourced × hrs/sourced) + (drafted × hrs/draft) + (booked × hrs/booking)
              <br />
              $ saved = hours saved × hourly cost
              <br />
              annual saving = ($ saved ÷ observed days) × 365
              <br />
              multiple = annual saving ÷ (assumed monthly cost × 12)
            </p>
          </div>
          <p className="text-xs italic text-muted">
            Illustrative on synthetic demo data. Swap in your own recruiter cost and platform price above to see
            your own multiple.
          </p>
        </dl>
      </Drawer>
    </Card>
  );
}
