"use client";

import * as React from "react";
import {
  CalendarCheck,
  ClipboardCheck,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { Card, CardHeader, CardBody, CardTitle, Eyebrow } from "@/components/ui";
import type { CampaignMetrics, CandidateStage } from "@/lib/types";
import { cn, formatNumber, toneForStage, type Tone } from "@/lib/utils";

const TONE_SOLID: Record<Tone, string> = {
  neutral: "bg-ink text-paper",
  tangerine: "bg-tangerine text-white",
  electric: "bg-electric text-white",
  aqua: "bg-aqua text-white",
  violet: "bg-violet text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
};

const TONE_RING: Record<Tone, string> = {
  neutral: "ring-ink/40",
  tangerine: "ring-tangerine/50",
  electric: "ring-electric/50",
  aqua: "ring-aqua/50",
  violet: "ring-violet/50",
  success: "ring-success/50",
  warning: "ring-warning/50",
  danger: "ring-danger/50",
};

interface PipelineNode {
  stage: CandidateStage;
  count: number;
  icon: LucideIcon;
}

export function StagePipeline({
  metrics,
  currentStage,
}: {
  metrics: CampaignMetrics;
  currentStage?: CandidateStage;
}) {
  const nodes: PipelineNode[] = [
    { stage: "Sourced", count: metrics.sourced, icon: Search },
    { stage: "Contacted", count: metrics.contacted, icon: Send },
    { stage: "Replied", count: metrics.replied, icon: MessageSquare },
    { stage: "Interested", count: metrics.interested, icon: Sparkles },
    { stage: "Booked", count: metrics.booked, icon: CalendarCheck },
    { stage: "Interviewed", count: metrics.interviewed, icon: ClipboardCheck },
    { stage: "Hired", count: metrics.hired, icon: Trophy },
  ];

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <CardTitle className="mt-1">Candidate pipeline</CardTitle>
        </div>
        <p className="text-sm text-muted tabular-nums">
          <span className="font-semibold text-ink">{formatNumber(metrics.sourced)}</span> sourced
          {" → "}
          <span className="font-semibold text-ink">{formatNumber(metrics.hired)}</span> hired
        </p>
      </CardHeader>
      <CardBody>
        <ol className="flex flex-wrap items-start gap-y-6">
          {nodes.map((node, i) => {
            const Icon = node.icon;
            const tone = toneForStage(node.stage);
            const filled = node.count > 0;
            const isCurrent = currentStage === node.stage;
            const next = nodes[i + 1];
            const connectorActive = filled && !!next && next.count > 0;
            return (
              <li key={node.stage} className="flex flex-1 items-center" style={{ minWidth: "5rem" }}>
                <div className="flex w-full flex-col items-center gap-1.5 text-center">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full ring-1 ring-inset transition-colors",
                      filled ? TONE_SOLID[tone] + " ring-transparent" : "bg-ink/[0.05] text-ink/35 ring-ink/10",
                      isCurrent && "ring-2 ring-offset-2 ring-offset-surface " + TONE_RING[tone],
                    )}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <span className="text-xl font-extrabold leading-none tabular-nums text-ink">
                    {formatNumber(node.count)}
                  </span>
                  <span className="eyebrow text-[0.625rem] tracking-wide">{node.stage}</span>
                  {isCurrent && (
                    <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-tangerine">
                      Now
                    </span>
                  )}
                </div>
                {i < nodes.length - 1 && (
                  <div
                    className={cn(
                      "mt-6 h-0.5 w-3 shrink-0 rounded-full sm:w-6",
                      connectorActive ? "bg-ink/25" : "bg-line",
                    )}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}
