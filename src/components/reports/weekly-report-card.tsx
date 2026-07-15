"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  CardTitle,
  Button,
  Badge,
  useToast,
} from "@/components/ui";
import { FunnelChart } from "@/components/charts/funnel-chart";
import type { WeeklyReport } from "@/lib/types";
import { exportMarkdownReport } from "@/lib/mock-ai";
import {
  copyToClipboard,
  downloadText,
  formatPercent,
  formatCurrency,
  formatTimeAgo,
  round,
} from "@/lib/utils";
import {
  Download,
  Copy,
  Lightbulb,
  Trophy,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";

export function WeeklyReportCard({ report }: { report: WeeklyReport }) {
  const { toast } = useToast();
  const p = report.performance;

  function handleExport() {
    downloadText("hermes-report.md", exportMarkdownReport(report));
    toast({
      title: "Report exported",
      description: "hermes-report.md downloaded as Markdown.",
      variant: "success",
    });
  }

  async function handleCopy() {
    const ok = await copyToClipboard(exportMarkdownReport(report));
    toast({
      title: ok ? "Report copied" : "Copy failed",
      description: ok ? "Markdown is on your clipboard." : "Clipboard is unavailable in this context.",
      variant: ok ? "success" : "error",
    });
  }

  // Which fields are fixed reference values rather than computed from this
  // campaign comes from the report itself (set by generateWeeklyReport in
  // mock-ai.ts) — not hardcoded here, so the label can't drift from the data.
  const illustrative = report.illustrativeFields;
  const stats: { label: string; value: string; illustrative?: boolean }[] = [
    { label: "Reply rate", value: formatPercent(p.replyRate) },
    { label: "Interest rate", value: formatPercent(p.interestRate) },
    { label: "Booking rate", value: formatPercent(p.bookingRate) },
    { label: "Avg match", value: `${round(p.avgMatchScore)}` },
    {
      label: "Time to interview",
      value: p.timeToFirstInterviewHours == null ? "—" : `${round(p.timeToFirstInterviewHours)}h`,
    },
    {
      label: "Cost per hire",
      value: formatCurrency(p.costPerHire),
      illustrative: illustrative.includes("performance.costPerHire"),
    },
    { label: "Best channel", value: p.bestChannel },
    {
      label: "Best slot",
      value: `${p.bestDay} · ${p.bestTime}`,
      illustrative: illustrative.includes("performance.bestDay"),
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>{report.periodLabel}</Eyebrow>
            <CardTitle>{report.campaignTitle}</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Weekly performance report · generated {formatTimeAgo(report.generatedAt)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Copy className="h-4 w-4" />}
              onClick={handleCopy}
            >
              Copy report
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={handleExport}
            >
              Export Markdown
            </Button>
          </div>
        </div>

        <div>
          <Eyebrow>Funnel</Eyebrow>
          <div className="mt-2">
            <FunnelChart data={report.funnel} height={260} />
          </div>
        </div>

        <div>
          <Eyebrow>Performance</Eyebrow>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-canvas px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  {s.label}
                  {s.illustrative && (
                    <Badge tone="neutral" size="sm" className="normal-case tracking-normal">
                      illustrative
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xl font-extrabold tabular-nums text-ink">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <InsightList
            icon={<Lightbulb className="h-4 w-4 text-electric" aria-hidden />}
            title="Insights"
            items={report.insights}
            tone="electric"
          />
          <InsightList
            icon={<Trophy className="h-4 w-4 text-success" aria-hidden />}
            title="Winning patterns"
            items={report.winningPatterns}
            tone="success"
            illustrative={illustrative.includes("winningPatterns")}
          />
          <InsightList
            icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
            title="Attention needed"
            items={report.attentionNeeded}
            tone="warning"
          />
        </div>

        <p className="text-xs text-muted">
          Benchmarks marked <span className="font-semibold">illustrative</span> are fixed reference values, not
          computed from this campaign.
        </p>
      </CardContent>
    </Card>
  );
}

function InsightList({
  icon,
  title,
  items,
  tone,
  illustrative,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  tone: "electric" | "success" | "warning";
  illustrative?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-ink">
          {icon}
          {title}
          {illustrative && (
            <Badge tone="neutral" size="sm" className="font-medium">
              illustrative
            </Badge>
          )}
        </h4>
        <Badge tone={tone} size="sm">
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          Nothing flagged this period.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-soft">
              <span
                className={
                  tone === "electric"
                    ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric"
                    : tone === "success"
                      ? "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success"
                      : "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                }
                aria-hidden
              />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
