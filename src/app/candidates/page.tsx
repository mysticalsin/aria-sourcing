"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardBody,
  Field,
  Input,
  Select,
  SkeletonCard,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { CandidateTable } from "@/components/candidates/candidate-table";
import { CandidateDrawer } from "@/components/candidates/candidate-drawer";
import { useCandidates, useHydrated } from "@/lib/store";
import { CANDIDATE_STAGES, SOURCE_PLATFORMS, type Candidate } from "@/lib/types";
import { pluralize } from "@/lib/utils";
import { Search } from "lucide-react";

const SORT_OPTIONS = [
  { value: "match", label: "Match score" },
  { value: "recent", label: "Most recent" },
];

function lastActivityIso(c: Candidate): number {
  return new Date(c.lastContactedAt ?? c.createdAt).getTime();
}

/** Reads `?focus=<id>` to auto-open a drawer. Must live under a Suspense boundary. */
function CandidatesView() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");

  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("match");
  const [stage, setStage] = React.useState("all");
  const [source, setSource] = React.useState("all");
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

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

  const stageOptions = [
    { value: "all", label: "All stages" },
    ...CANDIDATE_STAGES.map((s) => ({ value: s, label: s })),
  ];
  const sourceOptions = [
    { value: "all", label: "All sources" },
    ...SOURCE_PLATFORMS.map((s) => ({ value: s, label: s })),
  ];

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

      <p className="mb-4 text-sm text-muted">
        <span className="font-semibold text-ink">{filtered.length}</span> of{" "}
        {pluralize(candidates.length, "candidate")} across all campaigns
      </p>

      <Card className="overflow-x-auto">
        <CardBody>
          <CandidateTable
            candidates={filtered}
            showCampaign
            onSelect={(c) => {
              setSelected(c);
              setDrawerOpen(true);
            }}
          />
        </CardBody>
      </Card>

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
