"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, Eyebrow } from "@/components/ui";
import { StarBadge, SourceBadge, StageBadge } from "@/components/tania/badges";
import {
  TANIA_STAGE_META,
  LEAD_SOURCE_META,
  DEFAULT_STAR_THRESHOLDS,
  taniaStageForCandidate,
  deriveLeadSource,
  deriveStarRating,
  type StarThresholds,
} from "@/lib/tania";
import {
  LEAD_SOURCES,
  type Candidate,
  type Campaign,
  type ChatboxSubmission,
  type LeadSource,
  type TaniaStage,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/* ============================================================================
   TAnIA funnel board — a kanban of the Mantu 4-stage hiring funnel.
   Chatbox (pre-Stage I) · Need (Stage 0) · Leads (I) · Candidates (II) ·
   Offered (III) · Employees (IV). Candidate columns group by
   taniaStageForCandidate; a source-filter chip row narrows the visible cards.
   Reuses the Mantu tokens + TAnIA badges — no new palette.
   ========================================================================== */

/** The four funnel stages that hold real candidate cards. */
const CANDIDATE_STAGES = ["Leads", "Candidates", "Offered", "Employees"] as const;
type CandidateFunnelStage = (typeof CANDIDATE_STAGES)[number];

type SourceFilter = LeadSource | "all";

const EMPTY_SOURCE_COUNTS: Record<LeadSource, number> = {
  Applicant: 0,
  Referral: 0,
  Outbound: 0,
};

const SOURCE_ACTIVE_CLASSES: Record<LeadSource, string> = {
  Applicant: "bg-electric text-white ring-electric",
  Referral: "bg-violet text-white ring-violet",
  Outbound: "bg-tangerine text-white ring-tangerine",
};

function sourceBreakdown(list: Candidate[]): Record<LeadSource, number> {
  const counts: Record<LeadSource, number> = { ...EMPTY_SOURCE_COUNTS };
  for (const c of list) counts[deriveLeadSource(c)] += 1;
  return counts;
}

export function FunnelBoard({
  candidates,
  submissions,
  campaigns,
  thresholds = DEFAULT_STAR_THRESHOLDS,
}: {
  candidates: Candidate[];
  submissions: ChatboxSubmission[];
  campaigns: Campaign[];
  thresholds?: StarThresholds;
}) {
  const [source, setSource] = React.useState<SourceFilter>("all");

  // Active candidates grouped onto the funnel (rejected/pooled map to null → dropped).
  const byStage = React.useMemo(() => {
    const groups: Record<CandidateFunnelStage, Candidate[]> = {
      Leads: [],
      Candidates: [],
      Offered: [],
      Employees: [],
    };
    for (const c of candidates) {
      const stage = taniaStageForCandidate(c);
      if (stage && stage in groups) groups[stage as CandidateFunnelStage].push(c);
    }
    return groups;
  }, [candidates]);

  // Chatbox pre-stage: submissions still awaiting recruiter handoff.
  const chatbox = React.useMemo(
    () => submissions.filter((s) => s.status === "new" || s.status === "reviewed"),
    [submissions],
  );

  // Need (Stage 0): open needs = every campaign that isn't already filled.
  const needs = React.useMemo(() => campaigns.filter((c) => c.status !== "Filled"), [campaigns]);

  // Source totals across the whole active funnel — power the filter chip counts.
  const sourceTotals = React.useMemo(() => {
    const totals: Record<LeadSource, number> = { ...EMPTY_SOURCE_COUNTS };
    for (const c of candidates) {
      if (taniaStageForCandidate(c)) totals[deriveLeadSource(c)] += 1;
    }
    totals.Applicant += chatbox.length; // chatbox applications are inbound applicants
    return totals;
  }, [candidates, chatbox]);

  const totalActive = sourceTotals.Applicant + sourceTotals.Referral + sourceTotals.Outbound;

  const filters: { key: SourceFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: totalActive },
    { key: "Applicant", label: "Applicant", count: sourceTotals.Applicant },
    { key: "Referral", label: "Referral", count: sourceTotals.Referral },
    { key: "Outbound", label: "Outbound", count: sourceTotals.Outbound },
  ];

  const visible = (list: Candidate[]): Candidate[] =>
    source === "all" ? list : list.filter((c) => deriveLeadSource(c) === source);

  return (
    <Card className="p-4 animate-fade-in sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <h2 className="mt-1 text-lg font-bold text-ink">Funnel board</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by lead source">
          {filters.map((f) => {
            const active = source === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSource(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition-all",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
                  active
                    ? f.key === "all"
                      ? "bg-ink text-paper ring-ink"
                      : SOURCE_ACTIVE_CLASSES[f.key]
                    : "bg-surface text-ink-soft ring-line hover:bg-canvas hover:text-ink",
                )}
              >
                {f.label}
                <span className="tabular-nums opacity-80">{f.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto no-scrollbar pb-1">
        <div className="flex min-w-max gap-4">
          {/* Chatbox — pre-Stage I (Applicant only) */}
          <Column
            stage="Chatbox"
            count={chatbox.length}
            sourceChips={
              chatbox.length > 0 ? (
                <SourceMini counts={{ Applicant: chatbox.length, Referral: 0, Outbound: 0 }} />
              ) : null
            }
          >
            {source !== "all" && source !== "Applicant" ? (
              <ColumnEmpty label="Applicants only" />
            ) : chatbox.length > 0 ? (
              chatbox.map((s) => <ChatboxCard key={s.id} submission={s} />)
            ) : (
              <ColumnEmpty label="No new applications" />
            )}
          </Column>

          {/* Need — Stage 0 (campaigns, source-agnostic) */}
          <Column stage="Need" count={needs.length}>
            {needs.length > 0 ? (
              needs.map((c) => <NeedCard key={c.id} campaign={c} />)
            ) : (
              <ColumnEmpty label="No open needs" />
            )}
          </Column>

          {/* Candidate stages — Leads / Candidates / Offered / Employees */}
          {CANDIDATE_STAGES.map((stage) => {
            const all = byStage[stage];
            const shown = visible(all);
            return (
              <Column
                key={stage}
                stage={stage}
                count={all.length}
                sourceChips={<SourceMini counts={sourceBreakdown(all)} />}
              >
                {shown.length > 0 ? (
                  shown.map((c) => <CandidateCard key={c.id} candidate={c} thresholds={thresholds} />)
                ) : (
                  <ColumnEmpty label={source === "all" ? "Empty" : `No ${source} here`} />
                )}
              </Column>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Column({
  stage,
  count,
  sourceChips,
  children,
}: {
  stage: TaniaStage;
  count: number;
  sourceChips?: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = TANIA_STAGE_META[stage];
  return (
    <section
      aria-label={`${meta.label} — ${count}`}
      className="flex w-[15.5rem] shrink-0 flex-col rounded-3xl bg-canvas/50 p-3 ring-1 ring-inset ring-line"
    >
      <header className="px-1">
        <div className="flex items-center justify-between gap-2">
          <StageBadge stage={stage} size="sm" />
          <span className="tabular-nums text-sm font-extrabold text-ink">{count}</span>
        </div>
        <p className="mt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
          {meta.sub}
        </p>
        {sourceChips && <div className="mt-2 flex flex-wrap items-center gap-2">{sourceChips}</div>}
      </header>
      <ul className="mt-3 flex max-h-[30rem] flex-col gap-2 overflow-y-auto no-scrollbar pr-0.5">
        {children}
      </ul>
    </section>
  );
}

function SourceMini({ counts }: { counts: Record<LeadSource, number> }) {
  const shown = LEAD_SOURCES.filter((s) => counts[s] > 0);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1"
          title={`${LEAD_SOURCE_META[s].label}: ${counts[s]}`}
        >
          <SourceBadge source={s} size="sm" showLabel={false} />
          <span className="tabular-nums text-[0.6875rem] font-semibold text-ink-soft">
            {counts[s]}
          </span>
        </span>
      ))}
    </>
  );
}

function CandidateCard({ candidate, thresholds }: { candidate: Candidate; thresholds: StarThresholds }) {
  const rating = candidate.starRating ?? deriveStarRating(candidate.matchScore, thresholds);
  const src = deriveLeadSource(candidate);
  return (
    <li>
      <Link
        href={`/candidates?focus=${candidate.id}`}
        aria-label={`Open ${candidate.name}`}
        className="group block rounded-2xl border border-line bg-surface p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-bold text-ink">{candidate.name}</p>
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-ink"
            aria-hidden
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StarBadge rating={rating} size="sm" />
          <SourceBadge source={src} size="sm" />
        </div>
        <p className="mt-2 truncate text-xs text-muted">{candidate.currentTitle}</p>
      </Link>
    </li>
  );
}

function ChatboxCard({ submission }: { submission: ChatboxSubmission }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-3 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-bold text-ink">
          {submission.firstName} {submission.lastName}
        </p>
        <span
          className="shrink-0 rounded-full bg-ink/[0.05] px-1.5 py-0.5 text-[0.625rem] font-bold tabular-nums text-ink-soft"
          title="Chatbox screening score (0–100)"
        >
          {submission.score.total}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StarBadge rating={submission.starRating} size="sm" />
        <SourceBadge source="Applicant" size="sm" />
      </div>
      <p className="mt-2 truncate text-xs text-muted">{submission.roleTitle}</p>
    </li>
  );
}

function NeedCard({ campaign }: { campaign: Campaign }) {
  return (
    <li>
      <Link
        href={`/campaigns/${campaign.id}`}
        aria-label={`Open need ${campaign.title}`}
        className="group block rounded-2xl border border-line bg-surface p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-bold text-ink">{campaign.title}</p>
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-muted transition-colors group-hover:text-ink"
            aria-hidden
          />
        </div>
        <p className="mt-1 truncate text-xs text-muted">{campaign.department}</p>
        <p className="mt-2 text-[0.6875rem] font-semibold text-muted">
          <span className="tabular-nums font-bold text-ink">{campaign.metrics.sourced}</span> sourced ·{" "}
          {campaign.status}
        </p>
      </Link>
    </li>
  );
}

function ColumnEmpty({ label }: { label: string }) {
  return (
    <li className="rounded-2xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
      {label}
    </li>
  );
}
