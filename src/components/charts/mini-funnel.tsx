"use client";

import type { CampaignMetrics } from "@/lib/types";
import type { Tone } from "@/lib/utils";
import { formatNumber } from "@/lib/utils";

const TONE_VAR: Record<Tone, string> = {
  neutral: "--muted",
  tangerine: "--tangerine",
  electric: "--electric",
  aqua: "--aqua",
  violet: "--violet",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

export function MiniFunnel({ metrics }: { metrics: CampaignMetrics }) {
  const rows: { label: string; value: number; tone: Tone }[] = [
    { label: "Sourced", value: metrics.sourced, tone: "neutral" },
    { label: "Contacted", value: metrics.contacted, tone: "electric" },
    { label: "Replied", value: metrics.replied, tone: "aqua" },
    { label: "Booked", value: metrics.booked, tone: "violet" },
  ];
  const max = Math.max(metrics.sourced, 1);

  return (
    <div className="flex flex-col gap-2" aria-label="Sourcing funnel snapshot">
      {rows.map((row) => {
        const pct = Math.round((row.value / max) * 100);
        return (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
              {row.label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.max(pct, row.value > 0 ? 6 : 0)}%`,
                  backgroundColor: `hsl(var(${TONE_VAR[row.tone]}))`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums text-ink">
              {formatNumber(row.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
