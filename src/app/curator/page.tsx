"use client";

import * as React from "react";
import { useHydrated } from "@/lib/store";
import { FileBrowser } from "@/components/curator/file-browser";
import { CuratorStatus } from "@/components/curator/curator-status";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/ui";

export default function CuratorPage() {
  const hydrated = useHydrated();

  return (
    <HydrationGate
      hydrated={hydrated}
      fallback={
        <EmptyState
          title="Loading curator…"
          description="Files and curator status appear after workspace hydrate — no placeholder panels."
        />
      }
    >
      <PageHeader
        eyebrow="System"
        title="Files & Curator"
        description="Browse managed files and inspect the Aria runtime curator state"
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <FileBrowser />
        <CuratorStatus />
      </div>
    </HydrationGate>
  );
}
