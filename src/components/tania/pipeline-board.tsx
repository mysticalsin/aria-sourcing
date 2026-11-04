"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Inbox, Search } from "lucide-react";
import { Badge, Card, EmptyState, Input, Select, useToast } from "@/components/ui";
import { ScoreBadge, SourceBadge, StageBadge } from "@/components/tania/badges";
import { CandidateAvatar } from "@/components/candidates/candidate-avatar";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { useActions, useOutreach, useSettings } from "@/lib/store";
import { deriveLeadSource } from "@/lib/tania";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";
import { candidateReview } from "@/lib/candidate-review";
import {
  buildPipeline,
  PIPELINE_COLUMNS,
  pipelineColumnFor,
  type PipelineColumn,
  type PipelineEntry,
} from "@/lib/pipeline";
import {
  LEAD_SOURCES,
  type Campaign,
  type Candidate,
  type ChatboxSubmission,
  type LeadSource,
  type TaniaStage,
} from "@/lib/types";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn, pluralize, SEED_NOW, toneForStage } from "@/lib/utils";

/* ============================================================================
   Pipeline board — one campaign (or every open one) at a time, one column per
   next action, overdue cards on top. Cards open the candidate drawer in place.
   Only the human-decision stages (Interviewing, Offer, Hired) accept a drop;
   the earlier ones move through outreach and replies.
   ========================================================================== */

/** Campaign scope value for every campaign that is still hiring. */
const OPEN_SCOPE = "open";
const CLOSED_CAMPAIGN = new Set<Campaign["status"]>(["Filled", "Paused"]);

type SourceFilter = LeadSource | "all";

/** Consecutive columns sharing a TAnIA stage, for the group header band. */
const COLUMN_GROUPS = PIPELINE_COLUMNS.reduce<{ group: TaniaStage; columns: PipelineColumn[] }[]>((acc, col) => {
  const last = acc[acc.length - 1];
  if (last?.group === col.group) last.columns.push(col);
  else acc.push({ group: col.group, columns: [col] });
  return acc;
}, []);

export function PipelineBoard({
  candidates,
  campaigns,
  submissions,
}: {
  candidates: Candidate[];
  campaigns: Campaign[];
  submissions: ChatboxSubmission[];
}) {
  const settings = useSettings();
  const outreach = useOutreach();
  const actions = useActions();
  const { toast } = useToast();
  const [scope, setScope] = React.useState(OPEN_SCOPE);
  const [source, setSource] = React.useState<SourceFilter>("all");
  const [query, setQuery] = React.useState("");
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const campaignById = React.useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);

  const scoped = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (scope === OPEN_SCOPE) {
        const campaign = campaignById.get(c.campaignId);
        if (!campaign || CLOSED_CAMPAIGN.has(campaign.status)) return false;
      } else if (c.campaignId !== scope) return false;
      if (source !== "all" && deriveLeadSource(c) !== source) return false;
      if (!q) return true;
      return [c.name, c.currentTitle, c.currentCompany].some((v) => v.toLowerCase().includes(q));
    });
  }, [candidates, campaignById, scope, source, query]);

  const board = React.useMemo(
    () =>
      buildPipeline(scoped, {
        // The demo seed is dated; count days against its date, like the calendar does.
        now: supabaseEnabled ? Date.now() : SEED_NOW.getTime(),
        followUpGapDays: settings.rateLimits.followUpGapDays,
      }),
    [scoped, settings.rateLimits.followUpGapDays],
  );

  /** Candidates with a first message waiting for a human approval. */
  const awaitingApproval = React.useMemo(
    () => new Set(outreach.filter((m) => m.status === "Needs Approval").map((m) => m.candidateId)),
    [outreach],
  );

  const scopeOptions = React.useMemo(() => {
    const active = new Map<string, number>();
    for (const c of candidates) {
      if (pipelineColumnFor(c.stage)) active.set(c.campaignId, (active.get(c.campaignId) ?? 0) + 1);
    }
    return [
      { value: OPEN_SCOPE, label: "All open campaigns" },
      ...campaigns.map((c) => ({
        value: c.id,
        label: `${c.title} (${active.get(c.id) ?? 0})${CLOSED_CAMPAIGN.has(c.status) ? ` · ${c.status}` : ""}`,
      })),
    ];
  }, [candidates, campaigns]);

  const newApplications = submissions.filter((s) => s.status === "new" || s.status === "reviewed").length;
  const inPipeline = Object.values(board.columns).reduce((n, list) => n + list.length, 0);
  const singleCampaign = scope !== OPEN_SCOPE;

  const openCandidate = (c: Candidate) => {
    setSelected(c);
    setDrawerOpen(true);
  };

  const handleDrop = (candidateId: string, col: PipelineColumn) => {
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate || !col.dropStage || col.stages.includes(candidate.stage)) return;
    actions.setCandidateStage(candidateId, col.dropStage);
    toast({ title: `${candidate.name} moved to ${col.label}`, description: `Stage set to ${col.dropStage}.`, variant: "success" });
  };

  return (
    <div className="space-y-4" data-tour="pipeline-board">
      <Card className="p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,16rem)_1fr] lg:items-center">
          <Select
            aria-label="Campaign"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            options={scopeOptions}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              aria-label="Search the pipeline"
              placeholder="Name, title or company"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end" role="group" aria-label="Filter by lead source">
            {(["all", ...LEAD_SOURCES] as SourceFilter[]).map((key) => (
              <FilterChip key={key} active={source === key} onClick={() => setSource(key)}>
                {key === "all" ? "All sources" : key}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-muted">
          <span>
            <span className="font-bold tabular-nums text-ink">{inPipeline}</span> in progress
          </span>
          <button
            type="button"
            aria-pressed={overdueOnly}
            onClick={() => setOverdueOnly((v) => !v)}
            disabled={board.overdue === 0 && !overdueOnly}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ring-1 ring-inset transition-colors disabled:opacity-50",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
              overdueOnly ? "bg-warning text-white ring-warning" : "bg-warning-soft text-[hsl(32_90%_34%)] ring-warning/30 hover:bg-warning/20",
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {pluralize(board.overdue, "overdue card")}
            {overdueOnly ? " · show all" : ""}
          </button>
          <span>
            <span className="font-semibold tabular-nums text-ink-soft">{board.closed}</span> closed
          </span>
          <Link href="/vivier" className="hover:text-ink">
            <span className="font-semibold tabular-nums text-ink-soft">{board.pooled}</span> kept in the talent pool
          </Link>
          {newApplications > 0 && (
            <Link
              href="/applicants"
              className="ml-auto inline-flex items-center gap-1.5 font-semibold text-electric hover:underline"
            >
              <Inbox className="h-4 w-4" aria-hidden />
              {pluralize(newApplications, "new application")} to screen
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </Card>

      {inPipeline === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" aria-hidden />}
            title="Nobody in progress here"
            description={
              query || source !== "all"
                ? "No candidate matches these filters."
                : "Source candidates from a campaign and they will show up in “To contact”."
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {COLUMN_GROUPS.map(({ group, columns }) => (
              <section key={group} aria-label={group} className="rounded-3xl bg-canvas/50 p-2 ring-1 ring-inset ring-line">
                <div className="px-2 pb-2 pt-1">
                  <StageBadge stage={group} size="sm" />
                </div>
                <div className="flex gap-2">
                  {columns.map((col) => (
                    <Column
                      key={col.key}
                      column={col}
                      entries={board.columns[col.key]}
                      overdueOnly={overdueOnly}
                      followUpGapDays={settings.rateLimits.followUpGapDays}
                      onDrop={col.dropStage ? (id) => handleDrop(id, col) : undefined}
                      renderCard={(entry) => (
                        <PipelineCard
                          key={entry.candidate.id}
                          entry={entry}
                          campaign={singleCampaign ? undefined : campaignById.get(entry.candidate.campaignId)}
                          hint={
                            col.key === "toContact"
                              ? awaitingApproval.has(entry.candidate.id)
                                ? "Message awaiting approval"
                                : candidateReview(entry.candidate, campaignById.get(entry.candidate.campaignId), settings).label
                              : undefined
                          }
                          confidentialityMode={Boolean(settings.confidentialityMode)}
                          onOpen={() => openCandidate(entry.candidate)}
                        />
                      )}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      <CandidateDrawer candidate={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors whitespace-nowrap",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
        active ? "bg-ink text-paper ring-ink" : "bg-surface text-ink-soft ring-line hover:bg-canvas hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Column({
  column,
  entries,
  overdueOnly,
  followUpGapDays,
  onDrop,
  renderCard,
}: {
  column: PipelineColumn;
  entries: PipelineEntry[];
  overdueOnly: boolean;
  followUpGapDays: number;
  onDrop?: (candidateId: string) => void;
  renderCard: (entry: PipelineEntry) => React.ReactNode;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const overdue = entries.filter((e) => e.overdue).length;
  const shown = overdueOnly ? entries.filter((e) => e.overdue) : entries;
  const limit = column.overdueAfterDays === "followUpGap" ? followUpGapDays : column.overdueAfterDays;

  return (
    <div
      aria-label={`${column.label}, ${entries.length}`}
      role="group"
      className={cn(
        "flex w-[15rem] shrink-0 flex-col rounded-2xl p-1.5 transition-colors",
        dragOver && "bg-electric-soft ring-2 ring-electric",
      )}
      onDragOver={
        onDrop
          ? (e) => {
              e.preventDefault(); // required to allow a drop
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setDragOver(false) : undefined}
      onDrop={
        onDrop
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const id = e.dataTransfer.getData("text/plain");
              if (id) onDrop(id);
            }
          : undefined
      }
    >
      <header className="px-1.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">{column.label}</h3>
          <div className="flex items-center gap-1.5">
            {overdue > 0 && (
              <Badge tone="warning" size="sm" title={`${overdue} waiting ${limit}+ days`}>
                {overdue} late
              </Badge>
            )}
            <span className="tabular-nums text-sm font-extrabold text-ink">{entries.length}</span>
          </div>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted">
          {column.nextAction}
          {limit !== null && <span className="text-muted/80"> · late after {pluralize(limit, "day")}</span>}
        </p>
      </header>
      <ul className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto no-scrollbar">
        {shown.length > 0 ? (
          shown.map(renderCard)
        ) : (
          <li className="rounded-2xl border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
            {onDrop ? "Drop a candidate here" : overdueOnly ? "Nothing late" : "Empty"}
          </li>
        )}
      </ul>
    </div>
  );
}

function PipelineCard({
  entry,
  campaign,
  hint,
  confidentialityMode,
  onOpen,
}: {
  entry: PipelineEntry;
  /** Shown when the board spans several campaigns. */
  campaign?: Campaign;
  /** The concrete blocker or next step, when the column has one per card. */
  hint?: string;
  confidentialityMode: boolean;
  onOpen: () => void;
}) {
  const { candidate: c, waitingDays, overdue } = entry;
  const [dragging, setDragging] = React.useState(false);
  const display = applyConfidentiality(c, { confidentialityMode, reveal: hasOutreachPurpose(c.stage) });
  const showSubStage = (pipelineColumnFor(c.stage)?.stages.length ?? 0) > 1;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        aria-label={`Open ${display.name}${overdue ? `, waiting ${waitingDays} days` : ""}`}
        className={cn(
          "group block w-full cursor-pointer rounded-2xl border bg-surface p-3 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
          overdue ? "border-warning/60" : "border-line",
          dragging && "opacity-40",
        )}
      >
        <div className="flex items-start gap-2.5">
          <CandidateAvatar candidate={display} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-bold text-ink">{display.name}</p>
              <span
                className={cn(
                  "shrink-0 text-[0.6875rem] font-bold tabular-nums",
                  overdue ? "text-[hsl(32_90%_34%)]" : "text-muted",
                )}
                title={`${pluralize(waitingDays, "day")} since the last activity`}
              >
                {waitingDays === 0 ? "today" : `${waitingDays}d`}
              </span>
            </div>
            <p className="truncate text-xs text-muted">
              {[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ScoreBadge score={c.matchScore} size="sm" />
          <SourceBadge source={deriveLeadSource(c)} size="sm" showLabel={false} />
          {showSubStage && (
            <Badge tone={toneForStage(c.stage)} size="sm">
              {c.stage}
            </Badge>
          )}
        </div>
        {campaign && <p className="mt-2 truncate text-[0.6875rem] font-semibold text-ink-soft">{campaign.title}</p>}
        {hint && <p className="mt-1 truncate text-[0.6875rem] text-electric">{hint}</p>}
      </button>
    </li>
  );
}
