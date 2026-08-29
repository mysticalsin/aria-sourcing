"use client";

import * as React from "react";
import { useHydrated } from "@/lib/store";
import { MemoryPanel } from "@/components/memory/memory-panel";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui";

export default function MemoryPage() {
  const hydrated = useHydrated();

  return (
    <HydrationGate
      hydrated={hydrated}
      fallback={
        <EmptyState
          title="Loading memory…"
          description="Agent memory appears after workspace hydrate — no placeholder panels."
        />
      }
    >
      <PageHeader
        eyebrow="System"
        title="Memory"
        description="Encrypted, reviewed memory owned by each AgentSpec"
      />
      <MemoryPanel />
    </HydrationGate>
  );
}
