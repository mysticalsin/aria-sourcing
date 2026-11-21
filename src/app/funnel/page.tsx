"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { SkeletonCard } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { PipelineBoard } from "@/components/dashboard/pipeline-board";
import { ProcessingCandidateCard } from "@/components/dashboard/processing-candidate-card";
import { PipelineOverview } from "@/components/tania/pipeline-overview";
import { FlowMatrix } from "@/components/tania/flow-matrix";
import { processingStageIdFor, processingStageLabel } from "@/lib/processing-stages";
import { useCampaigns, useCandidates, useHydrated } from "@/lib/store";

export default function FunnelPage() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const campaigns = useCampaigns();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const people = React.useMemo(
    () =>
      candidates.flatMap((candidate) => {
        const stageId = processingStageIdFor(candidate.stage);
        if (!stageId) return [];
        return [
          {
            id: candidate.id,
            name: candidate.name,
            title: candidate.currentTitle,
            company: candidate.currentCompany,
            stageId,
            score: candidate.matchScore,
          },
        ];
      }),
    [candidates],
  );
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const selectedStage = selected ? processingStageIdFor(selected.stage) : null;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Recruit"
        title="Pipeline"
        description="To Rate, To Assess, To Interview, Shoot, QM, To Hire, Hired, Rejected, and Withdrawn. Open a name for the explainable score."
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        }
      >
        <div className="space-y-8">
          <PipelineBoard people={people} selectedId={selectedId} onSelect={setSelectedId} />
          {selected && selectedStage && (
            <ProcessingCandidateCard
              name={selected.name}
              title={selected.currentTitle}
              company={selected.currentCompany}
              stageLabel={processingStageLabel(selectedStage)}
              score={selected.matchScore}
              breakdown={selected.matchBreakdown}
            />
          )}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
              Campaign columns
            </summary>
            <div className="mt-4">
              <PipelineOverview campaigns={campaigns} candidates={candidates} />
            </div>
          </details>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
              How each stage works, and where a human decides
            </summary>
            <div className="mt-4">
              <FlowMatrix />
            </div>
          </details>
        </div>
      </HydrationGate>
    </div>
  );
}
