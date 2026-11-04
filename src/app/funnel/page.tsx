"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { SkeletonCard } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { PipelineBoard } from "@/components/tania/pipeline-board";
import { FlowMatrix } from "@/components/tania/flow-matrix";
import {
  useCampaigns,
  useCandidates,
  useChatboxSubmissions,
  useHydrated,
} from "@/lib/store";

export default function FunnelPage() {
  const hydrated = useHydrated();
  const candidates = useCandidates();
  const campaigns = useCampaigns();
  const submissions = useChatboxSubmissions();

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Recruit"
        title="Pipeline"
        description="Everyone in progress, sorted by what you have to do next. Pick a campaign to focus on one role; late cards come first in each column."
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
          <PipelineBoard candidates={candidates} campaigns={campaigns} submissions={submissions} />
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
