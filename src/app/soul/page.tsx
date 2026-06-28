"use client";

import * as React from "react";
import { useHydrated } from "@/lib/store";
import { PersonaEditor } from "@/components/soul/persona-editor";
import { HermesConfigPanel } from "@/components/soul/hermes-config-panel";
import { HydrationGate, PageHeader } from "@/components/app/page-header";
import { SkeletonCard } from "@/components/ui";

export default function SoulPage() {
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
        title="Soul"
        description="Agent personas, Aria's master brain, and the guardrails that shape every Aria agent"
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <PersonaEditor />
        <HermesConfigPanel />
      </div>
    </HydrationGate>
  );
}
