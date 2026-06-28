"use client";

import * as React from "react";
import { useHydrated } from "@/lib/store";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { HermesMemoryPanel } from "@/components/memory/hermes-memory-panel";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/ui";
import { Database } from "lucide-react";

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
        description="Long-term facts, preferences, instructions, and episodic memories for each Aria agent"
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <MemoryPanel />
        <HermesMemoryPanel />
      </div>
    </HydrationGate>
  );
}
