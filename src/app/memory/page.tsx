"use client";

import * as React from "react";
import { useHydrated } from "@/lib/store";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/ui";

export default function MemoryPage() {
  const hydrated = useHydrated();

  const fallback = (
    <div className="space-y-4">
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );

  return (
    <HydrationGate hydrated={hydrated} fallback={fallback}>
      <PageHeader
        eyebrow="System"
        title="Memory"
        description="Encrypted, reviewed memory owned by each AgentSpec"
      />
      <MemoryPanel />
    </HydrationGate>
  );
}
