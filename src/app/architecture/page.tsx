"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Eyebrow } from "@/components/ui";
import { AgentOrg, GuardrailsPanel } from "@/components/tania/agent-org";
import { HUMAN_PRINCIPLE } from "@/lib/agents-org";

export default function ArchitecturePage() {
  return (
    <div className="space-y-8">
      <header className="animate-fade-in">
        <Eyebrow className="mb-2 block text-tangerine">Agent architecture</Eyebrow>
        <h1 className="display text-3xl text-ink sm:text-4xl lg:text-5xl">
          TAnIA — <span className="gradient-purple-text">one coordinated team</span>
        </h1>
        <p className="mt-4 inline-flex max-w-3xl items-start gap-2.5 rounded-2xl bg-canvas/70 px-4 py-3 text-sm leading-relaxed text-ink-soft ring-1 ring-inset ring-violet/10">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-electric" aria-hidden />
          <span>{HUMAN_PRINCIPLE}</span>
        </p>
      </header>

      {/* Coordinator + 6 managers + legend */}
      <AgentOrg />

      {/* Human Always Decides — guardrails */}
      <GuardrailsPanel />
    </div>
  );
}
