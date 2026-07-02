"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Eyebrow,
  Field,
  Input,
  Select,
  SkeletonCard,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { CandidateTable } from "@/components/candidates/candidate-table";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { SourcingFeed } from "@/components/tania/sourcing-feed";
import { useActions, useActiveCampaign, useCandidates, useHydrated } from "@/lib/store";
import { CANDIDATE_STAGES, SOURCE_PLATFORMS, type Candidate, type CandidateStage } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { Bookmark, Radar, Search } from "lucide-react";

const SORT_OPTIONS = [
  { value: "match", label: "Match score" },
  { value: "recent", label: "Most recent" },
];

/** Manual, human-decided forward-progression stages — mirrors the same set the
 *  candidate drawer's Interview stage panel exposes, so bulk moves can't reach
 *  a stage that's normally only driven by outreach/reply automation. */
const BULK_STAGE_OPTIONS: { value: CandidateStage; label: string }[] = [
  { value: "Interviewed", label: "Interviewed" },
  { value: "Offer", label: "Offer" },
  { value: "Hired", label: "Hired" },
  { value: "Rejected", label: "Rejected" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "25", label: "25 / page" },
  { value: "50", label: "50 / page" },
  { value: "100", label: "100 / page" },
];
const DEFAULT_PAGE_SIZE = 50;

function lastActivityIso(c: Candidate): number {
  return new Date(c.lastContactedAt ?? c.createdAt).getTime();
}

/** Reads `?focus=<id>` to auto-open a drawer. Must live under a Suspense boundary. */
function CandidatesView() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const actions = useActions();
  const activeCampaign = useActiveCampaign();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("match");
  const [stage, setStage] = React.useState("all");
  const [source, setSource] = React.useState("all");
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = React.useState<CandidateStage | "">("");
  const [bulkReason, setBulkReason] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  const [sourcing, setSourcing] = React.useState(false);
  // The just-sourced batch, staged for the streaming reveal below — purely a
  // display buffer; `sourceNextBatch` already committed these candidates for
  // real. `sourceBatchKey` remounts <SourcingFeed> on every new batch (even
  // one of the same size as the last) so the reveal always replays.
  const [justSourced, setJustSourced] = React.useState<Candidate[]>([]);
  const [sourceBatchKey, setSourceBatchKey] = React.useState(0);

  const handledFocus = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!hydrated || !focus) return;
    if (handledFocus.current === focus) return;
    const found = candidates.find((c) => c.id === focus);
    if (found) {
      setSelected(found);
      setDrawerOpen(true);
      handledFocus.current = focus;
    }
  }, [hydrated, focus, candidates]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = candidates.filter((c) => {
      if (stage !== "all" && c.stage !== stage) return false;
      if (source !== "all" && c.sourcePlatform !== source) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.currentTitle.toLowerCase().includes(q) ||
        c.currentCompany.toLowerCase().includes(q)
      );
    });
    result.sort((a, b) =>
      sort === "match" ? b.matchScore - a.matchScore : lastActivityIso(b) - lastActivityIso(a),
    );
    return result;
  }, [candidates, query, stage, source, sort]);

  // Reset to page 1 whenever the result set could reshuffle out from under the
  // current page (filter/sort change or a bigger page size) — never leave the
  // user staring at a page that's now past the end.
  React.useEffect(() => {
    setPage(0);
  }, [query, stage, source, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const paged = React.useMemo(
    () => filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize),
    [filtered, clampedPage, pageSize],
  );

  const stageOptions = [
    { value: "all", label: "All stages" },
    ...CANDIDATE_STAGES.map((s) => ({ value: s, label: s })),
  ];
  const sourceOptions = [
    { value: "all", label: "All sources" },
    ...SOURCE_PLATFORMS.map((s) => ({ value: s, label: s })),
  ];

  const hasActiveFilters = query.trim() !== "" || stage !== "all" || source !== "all";

  function clearFilters() {
    setQuery("");
    setStage("all");
    setSource("all");
  }

  // Filtering can drop selected rows out of view (e.g. move a stage filter
  // after selecting); drop stale ids so "N selected" never counts hidden rows.
  const filteredIds = React.useMemo(() => new Set(filtered.map((c) => c.id)), [filtered]);
  const visibleSelectedIds = React.useMemo(
    () => new Set(Array.from(selectedIds).filter((id) => filteredIds.has(id))),
    [selectedIds, filteredIds],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selects the current PAGE (standard pagination convention), not every
  // filtered result — selections still persist across pages via selectedIds.
  function toggleSelectAll() {
    const allPageSelected = paged.length > 0 && paged.every((c) => visibleSelectedIds.has(c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((c) => (allPageSelected ? next.delete(c.id) : next.add(c.id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkStage("");
    setBulkReason("");
  }

  /** Sources the active campaign's next batch via the SAME unchanged
   *  `sourceNextBatch` action the campaign page and dashboard already use —
   *  then stages the exact, already-committed result for the streaming
   *  reveal below instead of only a toast. */
  async function handleSourceBatch() {
    if (sourcing) return;
    if (!activeCampaign) {
      toast({
        title: "No active campaign",
        description: "Open a campaign (or start a new intake) to source its next batch.",
        variant: "warning",
      });
      return;
    }
    setSourcing(true);
    const res = await actions.sourceNextBatch(activeCampaign.id);
    setSourcing(false);
    if (!res.ok) {
      toast({
        title:
          res.source === "paused"
            ? "Campaign is paused"
            : `${res.source === "github" ? "GitHub" : "Web"} sourcing failed`,
        description: res.error,
        variant: "error",
      });
      return;
    }
    setJustSourced(res.accepted);
    setSourceBatchKey((k) => k + 1);
    const isLive = res.source === "github" || res.source === "web";
    toast({
      title: `Sourced ${pluralize(res.accepted.length, "candidate")}${isLive ? " (live)" : ""}`,
      description: `${activeCampaign.title} · ${pluralize(res.skipped.length, "candidate")} skipped by dedupe & exclusions.`,
      variant: res.accepted.length > 0 ? "success" : "info",
    });
  }

  /** Bulk stage move — routes every selected candidate through the SAME
   *  setCandidateStage the drawer's per-candidate buttons use (preserves the
   *  maxStageRank high-water mark via withStage), reusing outreach's
   *  commit-loop pattern (handleBulkApprove) for triaging a sourced batch. */
  function handleBulkStageApply() {
    if (!bulkStage) return;
    const ids = Array.from(visibleSelectedIds);
    if (ids.length === 0) return;
    ids.forEach((id) => {
      actions.setCandidateStage(id, bulkStage);
      if (bulkStage === "Rejected" && bulkReason.trim()) {
        actions.setRejectionReason(id, bulkReason.trim());
      }
    });
    toast({
      title: `Moved ${pluralize(ids.length, "candidate")} to ${bulkStage}`,
      variant: bulkStage === "Rejected" ? "warning" : "success",
    });
    clearSelection();
  }

  function handleBulkVivier() {
    const ids = Array.from(visibleSelectedIds).filter(
      (id) => !candidates.find((c) => c.id === id)?.vivier,
    );
    if (ids.length === 0) {
      toast({ title: "Selected candidates are already in #Vivier", variant: "info" });
      return;
    }
    ids.forEach((id) => actions.toggleVivier(id));
    toast({ title: `Added ${pluralize(ids.length, "candidate")} to #Vivier`, variant: "success" });
    clearSelection();
  }

  const tableEmptyState =
    filtered.length === 0 && candidates.length > 0 && hasActiveFilters
      ? {
          title: "No candidates match your filters",
          description: "Try a different search term, or reset the filters below.",
          action: (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ),
        }
      : undefined;

  return (
    <HydrationGate
      hydrated={hydrated}
      fallback={
        <div className="space-y-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      }
    >
      <Card className="mb-6">
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="candidate-search">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                id="candidate-search"
                className="pl-10"
                placeholder="Name, title, company"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Sort by" htmlFor="candidate-sort">
            <Select
              id="candidate-sort"
              options={SORT_OPTIONS}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            />
          </Field>
          <Field label="Stage" htmlFor="candidate-stage">
            <Select
              id="candidate-stage"
              options={stageOptions}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            />
          </Field>
          <Field label="Source" htmlFor="candidate-source">
            <Select
              id="candidate-source"
              options={sourceOptions}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{filtered.length}</span> of{" "}
          {pluralize(candidates.length, "candidate")} across all campaigns
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Radar className="h-4 w-4" />}
          onClick={handleSourceBatch}
          loading={sourcing}
          disabled={sourcing}
          title={activeCampaign ? `Source the next batch for ${activeCampaign.title}` : "No active campaign"}
        >
          {sourcing ? "Sourcing…" : "Source next batch"}
        </Button>
      </div>

      {justSourced.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2">
            <Eyebrow>Just sourced</Eyebrow>
            <Badge tone="electric" size="sm">
              {justSourced.length}
            </Badge>
          </div>
          <SourcingFeed
            key={sourceBatchKey}
            candidates={justSourced}
            campaignId={activeCampaign?.id}
          />
        </div>
      )}

      {visibleSelectedIds.size > 0 && (
        <Card className="mb-4 border-electric/30 bg-electric-soft/40">
          <CardBody className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-ink">
              {pluralize(visibleSelectedIds.size, "candidate")} selected
            </span>
            <Select
              aria-label="Bulk move to stage"
              className="w-48"
              options={[{ value: "", label: "Move to stage…" }, ...BULK_STAGE_OPTIONS]}
              value={bulkStage}
              onChange={(e) => setBulkStage(e.target.value as CandidateStage | "")}
            />
            {bulkStage === "Rejected" && (
              <Input
                aria-label="Shared rejection reason"
                className="w-64"
                placeholder="Shared rejection reason (optional)"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            )}
            <Button size="sm" variant="primary" onClick={handleBulkStageApply} disabled={!bulkStage}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
              onClick={handleBulkVivier}
            >
              Add to #Vivier
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear selection
            </Button>
          </CardBody>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <CardBody>
          <CandidateTable
            candidates={paged}
            showCampaign
            emptyState={tableEmptyState}
            selectedIds={visibleSelectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onSelect={(c) => {
              setSelected(c);
              setDrawerOpen(true);
            }}
          />
        </CardBody>
      </Card>

      {filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Select
            aria-label="Rows per page"
            className="w-36"
            options={PAGE_SIZE_OPTIONS}
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted tabular-nums">
              Page {clampedPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <CandidateDrawer candidate={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </HydrationGate>
  );
}

export default function CandidatesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Talent pool"
        title="Candidates"
        description="Every sourced candidate, ranked by fit across all campaigns. Filter, sort, and open a profile to score, message, or book."
      />
      <React.Suspense
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        }
      >
        <CandidatesView />
      </React.Suspense>
    </div>
  );
}
