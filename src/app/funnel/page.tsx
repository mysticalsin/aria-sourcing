"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { SkeletonCard } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { PipelineOverview } from "@/components/tania/pipeline-overview";
import { FlowMatrix } from "@/components/tania/flow-matrix";
import { useCampaigns, useCandidates, useHydrated } from "@/lib/store";

export default function FunnelPage() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const campaigns = useCampaigns();

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Recruit"
        title="Pipeline"
        description="Where every campaign stands and where its candidates are, at a glance. Open a campaign to see who is at each stage."
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
          <PipelineOverview campaigns={campaigns} candidates={candidates} />
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
