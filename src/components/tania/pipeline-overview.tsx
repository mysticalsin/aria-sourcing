"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Target } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import { CandidateAvatar } from "@/components/candidates/candidate-avatar";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { useActions, useSettings } from "@/lib/store";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { campaignHealth } from "@/lib/rules";
import {
  buildPipelineRows,
  campaignIsClosed,
  PIPELINE_STAGES,
  stageTotals,
  type PipelineRow,
  type PipelineStage,
} from "@/lib/pipeline";
import type { Campaign, Candidate } from "@/lib/types";
import { cn, pluralize, toneForStage, type Tone } from "@/lib/utils";

/* ============================================================================
   Pipeline overview — every campaign on one screen, one column per stage, so
   where each role stands reads at a glance. A row opens onto its candidates,
   laid out under the same columns; a name opens the candidate drawer.
   ========================================================================== */

/** Candidates shown per cell before "+N more". */
const CELL_PREVIEW = 5;

const TONE_SOLID: Record<Tone, string> = {
  neutral: "bg-ink/40",
  tangerine: "bg-tangerine",
  electric: "bg-electric",
  aqua: "bg-aqua",
  violet: "bg-violet",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-ink/[0.07] text-ink",
  tangerine: "bg-tangerine-soft text-tangerine",
  electric: "bg-electric-soft text-electric",
  aqua: "bg-aqua-soft text-aqua",
  violet: "bg-violet-soft text-violet",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[hsl(32_90%_34%)]",
  danger: "bg-danger-soft text-danger",
};

/** "Out" is context, not a signal: kept grey so it never competes with progress. */
function stageTone(stage: PipelineStage): Tone | null {
  return stage.key === "out" ? null : toneForStage(stage.tone);
}

const STATUS_TONE: Record<Campaign["status"], Tone> = {
  Intake: "neutral",
  Sourcing: "electric",
  Outreach: "tangerine",
  Interviewing: "violet",
  Closing: "aqua",
  Filled: "success",
  Paused: "warning",
};

export function PipelineOverview({ campaigns, candidates }: { campaigns: Campaign[]; candidates: Candidate[] }) {
  const settings = useSettings();
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [showClosed, setShowClosed] = React.useState(false);
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const rows = React.useMemo(() => buildPipelineRows(campaigns, candidates), [campaigns, candidates]);
  const openRows = rows.filter((r) => !campaignIsClosed(r.campaign));
  const closedRows = rows.filter((r) => campaignIsClosed(r.campaign));
  const visibleRows = showClosed ? rows : openRows;
  const totals = React.useMemo(() => stageTotals(openRows), [openRows]);
  const inProgress = openRows.reduce((n, r) => n + r.inProgress, 0);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCandidate = (c: Candidate) => {
    setSelected(c);
    setDrawerOpen(true);
  };

  if (campaigns.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Target className="h-6 w-6" aria-hidden />}
          title="No campaign yet"
          description="Create a campaign and source candidates: each one gets a row here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0" data-tour="pipeline-board">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <p className="text-sm text-muted">
          <span className="font-bold tabular-nums text-ink">{pluralize(openRows.length, "open campaign")}</span>
          {" · "}
          <span className="font-bold tabular-nums text-ink">{inProgress}</span> candidates in progress
        </p>
        <p className="text-xs text-muted">Click a campaign to see who is where.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] table-fixed sm:min-w-[64rem] border-collapse text-sm">
          <caption className="sr-only">Candidates per stage for each campaign</caption>
          <colgroup>
            <col className="w-[12rem] sm:w-[19rem]" />
            {PIPELINE_STAGES.map((stage) => (
              <col key={stage.key} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-3 text-left sm:px-5">
                <span className="eyebrow">Campaign</span>
              </th>
              {PIPELINE_STAGES.map((stage) => {
                const tone = stageTone(stage);
                return (
                  <th key={stage.key} scope="col" className="px-1.5 py-3 text-center font-normal">
                    <span className="flex items-center justify-center gap-1.5 text-xs font-semibold text-ink-soft">
                      <span className={cn("h-2 w-2 rounded-full", tone ? TONE_SOLID[tone] : "bg-line")} aria-hidden />
                      {stage.label}
                    </span>
                    <span
                      className={cn("mt-1 block text-xl font-extrabold tabular-nums", tone ? "text-ink" : "text-muted")}
                      title={`${totals[stage.key]} across open campaigns`}
                    >
                      {totals[stage.key]}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <React.Fragment key={row.campaign.id}>
                {showClosed && i === openRows.length && (
                  <tr>
                    <td colSpan={PIPELINE_STAGES.length + 1} className="bg-canvas/60 px-5 py-2">
                      <span className="eyebrow">Closed or paused</span>
                    </td>
                  </tr>
                )}
                <CampaignRow
                  row={row}
                  open={expanded.has(row.campaign.id)}
                  onToggle={() => toggle(row.campaign.id)}
                />
                {expanded.has(row.campaign.id) && (
                  <CandidatesRow
                    row={row}
                    confidentialityMode={Boolean(settings.confidentialityMode)}
                    onOpen={openCandidate}
                  />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {closedRows.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="text-sm font-semibold text-ink-soft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            {showClosed ? "Hide closed campaigns" : `Show ${pluralize(closedRows.length, "closed or paused campaign")}`}
          </button>
        </div>
      )}

      <CandidateDrawer candidate={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Card>
  );
}

function CampaignRow({ row, open, onToggle }: { row: PipelineRow; open: boolean; onToggle: () => void }) {
  const { campaign } = row;
  const health = campaignHealth(campaign);
  const closed = campaignIsClosed(campaign);
  const panelId = `pipeline-${campaign.id}`;

  return (
    <tr
      className={cn(
        "group cursor-pointer border-b border-line transition-colors",
        open ? "bg-canvas" : "bg-surface hover:bg-canvas",
        closed && "opacity-70",
      )}
      onClick={onToggle}
    >
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 px-3 py-3.5 text-left font-normal transition-colors sm:px-5",
          open ? "bg-canvas" : "bg-surface group-hover:bg-canvas",
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex w-full items-start gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
        >
          <ChevronDown
            className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold text-ink">{campaign.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[campaign.status]} size="sm">
                {campaign.status}
              </Badge>
              {!closed && (
                <Badge tone={health.tone} size="sm" dot title={health.detail}>
                  {health.label}
                </Badge>
              )}
            </span>
            <DistributionBar row={row} />
          </span>
        </button>
      </th>
      {PIPELINE_STAGES.map((stage) => {
        const count = row.buckets[stage.key].length;
        const tone = stageTone(stage);
        return (
          <td key={stage.key} className="px-1.5 py-3.5 text-center">
            {count > 0 ? (
              <span
                className={cn(
                  "inline-flex min-w-[2.75rem] justify-center rounded-xl px-2 py-1.5 text-base font-extrabold tabular-nums",
                  tone ? TONE_SOFT[tone] : "text-muted",
                )}
              >
                {count}
              </span>
            ) : (
              <span className="text-line" aria-label="none">
                –
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** Where this campaign's candidates sit, as one proportional bar. */
function DistributionBar({ row }: { row: PipelineRow }) {
  if (row.total === 0) return <span className="mt-2 block text-xs text-muted">No candidate sourced yet</span>;
  return (
    <span className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-line/60" aria-hidden>
      {PIPELINE_STAGES.map((stage) => {
        const count = row.buckets[stage.key].length;
        if (count === 0) return null;
        const tone = stageTone(stage);
        return (
          <span
            key={stage.key}
            className={tone ? TONE_SOLID[tone] : "bg-line"}
            style={{ width: `${(count / row.total) * 100}%` }}
          />
        );
      })}
    </span>
  );
}

function CandidatesRow({
  row,
  confidentialityMode,
  onOpen,
}: {
  row: PipelineRow;
  confidentialityMode: boolean;
  onOpen: (c: Candidate) => void;
}) {
  const { setActiveCampaign } = useActions();
  const [showAll, setShowAll] = React.useState(false);
  const hidden = PIPELINE_STAGES.some((s) => row.buckets[s.key].length > CELL_PREVIEW);

  return (
    <tr id={`pipeline-${row.campaign.id}`} className="border-b border-line bg-canvas align-top">
      <td className="sticky left-0 z-10 bg-canvas px-3 py-3 sm:px-5">
        <div className="flex flex-col gap-2 text-xs sm:pl-6">
          <span className="text-muted">
            {row.campaign.department}
            {row.campaign.hiringManager ? ` · ${row.campaign.hiringManager}` : ""}
          </span>
          <Link
            href={`/campaigns/${row.campaign.id}`}
            onClick={() => setActiveCampaign(row.campaign.id)}
            className="inline-flex items-center gap-1 font-semibold text-electric hover:underline"
          >
            Open campaign
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          {hidden && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="self-start font-semibold text-ink-soft hover:text-ink"
            >
              {showAll ? "Show fewer" : "Show everyone"}
            </button>
          )}
        </div>
      </td>
      {PIPELINE_STAGES.map((stage) => {
        const list = row.buckets[stage.key];
        const shown = showAll ? list : list.slice(0, CELL_PREVIEW);
        return (
          <td key={stage.key} className="px-1 py-3">
            <ul className="flex flex-col gap-1">
              {shown.map((c) => {
                const display = applyConfidentiality(c, { confidentialityMode, reveal: hasOutreachPurpose(c.stage) });
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(c)}
                      title={`${display.name} · ${c.currentTitle} · ${c.matchScore}/100${c.stage !== stage.label ? ` · ${c.stage}` : ""}`}
                      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                    >
                      <CandidateAvatar candidate={display} className="h-6 w-6 text-[9px]" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{display.name}</span>
                      <span className="shrink-0 text-[0.625rem] font-bold tabular-nums text-muted">{c.matchScore}</span>
                    </button>
                  </li>
                );
              })}
              {list.length > shown.length && (
                <li className="px-1 text-[0.6875rem] font-semibold text-muted">+{list.length - shown.length} more</li>
              )}
            </ul>
          </td>
        );
      })}
    </tr>
  );
}
