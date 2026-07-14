"use client";

import * as React from "react";
import { Download, Trophy } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardTitle,
  EmptyState,
  Eyebrow,
  SkeletonCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { useHydrated, useRole, useWins } from "@/lib/store";
import type { WinRecord } from "@/lib/types";
import { downloadText, escapeMarkdownTableCell, formatDateTime, formatNumber } from "@/lib/utils";
import { ROLE_LABEL } from "@/lib/rbac";

function formatDuration(ms: number | null): string {
  if (ms == null) return "Unknown";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function winlogMarkdown(wins: WinRecord[]): string {
  const lines = [
    "# Winlog",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Records: ${wins.length}`,
    "",
    "| Booked | Candidate | Campaign | Platform | Channel | Touches | Time to book | Reply intent | Tone |",
    "|---|---|---|---|---|---:|---:|---|---|",
  ];
  for (const win of wins) {
    lines.push(
      [
        formatDateTime(win.at),
        escapeMarkdownTableCell(win.candidateName),
        escapeMarkdownTableCell(win.campaignTitle),
        win.sourcePlatform,
        win.outreachChannel ?? "Unknown",
        String(win.touchCount),
        formatDuration(win.timeToBookMs),
        win.triggeringReplyIntent
          ? `${win.triggeringReplyIntent.intent} (${Math.round(win.triggeringReplyIntent.confidence * 100)}%)`
          : "None",
        win.messageTraits.tone ?? "Unknown",
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }
  return `${lines.join("\n")}\n`;
}

export default function WinlogPage() {
  const hydrated = useHydrated();
  const role = useRole();
  const wins = useWins();
  const { toast } = useToast();

  const sortedWins = React.useMemo(
    () => [...wins].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [wins],
  );
  const avgTouches =
    sortedWins.length > 0
      ? sortedWins.reduce((sum, win) => sum + win.touchCount, 0) / sortedWins.length
      : 0;
  const topChannel = React.useMemo(() => {
    const counts = sortedWins.reduce<Map<string, number>>((acc, win) => {
      const key = win.outreachChannel ?? "Unknown";
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map());
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
  }, [sortedWins]);

  function exportWinlog() {
    downloadText("winlog.md", winlogMarkdown(sortedWins));
    toast({
      title: "Winlog exported",
      description: "winlog.md downloaded from this browser session.",
      variant: "success",
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Learning"
        title="Winlog"
        description="Private booked-win records captured at the booking commit."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="h-4 w-4" aria-hidden />}
            onClick={exportWinlog}
            disabled={!hydrated || sortedWins.length === 0}
          >
            Export Markdown
          </Button>
        }
      />
      <HydrationGate hydrated={hydrated} fallback={<SkeletonCard className="h-96" />}>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent>
              <Eyebrow>Records</Eyebrow>
              <CardTitle className="mt-1 tabular-nums">{formatNumber(sortedWins.length)}</CardTitle>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Eyebrow>Avg touches</Eyebrow>
              <CardTitle className="mt-1 tabular-nums">{Math.round(avgTouches * 10) / 10}</CardTitle>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Eyebrow>Top channel</Eyebrow>
              <CardTitle className="mt-1">{topChannel}</CardTitle>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-surface/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <Eyebrow>Booked wins</Eyebrow>
              <p className="mt-1 text-sm text-muted">Visible to signed-in workspace users only.</p>
            </div>
            <Badge tone="neutral">{ROLE_LABEL[role]}</Badge>
          </div>

          {sortedWins.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Trophy className="h-7 w-7" aria-hidden />}
                title="No wins recorded yet"
                description="The next accepted meeting will add a structured win record here."
              />
            </div>
          ) : (
            <Table caption="Structured booked-win records">
              <THead>
                <TR>
                  <TH>Booked</TH>
                  <TH>Candidate</TH>
                  <TH>Campaign</TH>
                  <TH>Source</TH>
                  <TH>Winning touch</TH>
                  <TH className="text-right">Touches</TH>
                  <TH className="text-right">Time</TH>
                  <TH>Reply</TH>
                </TR>
              </THead>
              <TBody>
                {sortedWins.map((win) => (
                  <TR key={win.id}>
                    <TD className="whitespace-nowrap text-sm text-ink-soft">{formatDateTime(win.at)}</TD>
                    <TD>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{win.candidateName}</p>
                        <p className="truncate text-xs text-muted">{win.roleTitle}</p>
                      </div>
                    </TD>
                    <TD className="min-w-48">
                      <p className="truncate">{win.campaignTitle}</p>
                      <p className="text-xs text-muted">{win.seniority}</p>
                    </TD>
                    <TD>
                      <Badge tone="electric" size="sm">{win.sourcePlatform}</Badge>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="tangerine" size="sm">{win.outreachChannel ?? "Unknown"}</Badge>
                        {win.messageTraits.tone && (
                          <Badge tone="neutral" size="sm">{win.messageTraits.tone}</Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{win.touchCount}</TD>
                    <TD className="text-right tabular-nums">{formatDuration(win.timeToBookMs)}</TD>
                    <TD>
                      {win.triggeringReplyIntent ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{win.triggeringReplyIntent.intent}</p>
                          <p className="text-xs text-muted">
                            {Math.round(win.triggeringReplyIntent.confidence * 100)}% confidence
                          </p>
                        </div>
                      ) : (
                        <span className="text-sm text-muted">None</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </HydrationGate>
    </div>
  );
}
