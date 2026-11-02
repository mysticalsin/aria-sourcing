"use client";

import * as React from "react";
import { SkeletonCard } from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { FunnelBoard } from "@/components/tania/funnel-board";
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
        description="The hiring pipeline: from the chatbox and open needs through Leads, Candidates, Offered and Employees, with the stage × source flow that keeps a human in the loop at every gate."
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
          <FunnelBoard
            candidates={candidates}
            submissions={submissions}
            campaigns={campaigns}
          />
          <FlowMatrix />
        </div>
      </HydrationGate>
    </div>
  );
}
