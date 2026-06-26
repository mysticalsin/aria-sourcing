"use client";

import { Progress } from "@/components/ui";
import { scoreTone } from "@/lib/utils";
import type { MatchBreakdownItem } from "@/lib/types";

/**
 * Per-dimension match explanation. Each row shows the dimension label, its
 * weight, the 0–100 dimension score (tinted by scoreTone), and the rationale.
 */
export function ScoreBreakdown({ breakdown }: { breakdown: MatchBreakdownItem[] }) {
  if (breakdown.length === 0) {
    return (
      <p className="text-sm text-muted">
        No scoring breakdown available for this candidate yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {breakdown.map((item) => {
        const tone = scoreTone(item.score);
        const value = Math.round(item.score);
        return (
          <div key={item.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="truncate text-sm font-semibold text-ink">{item.label}</span>
                <span className="shrink-0 text-[0.6875rem] font-medium uppercase tracking-wide text-muted">
                  {Math.round(item.weight * 100)}% weight
                </span>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{value}</span>
            </div>
            <Progress value={item.score} tone={tone} aria-label={`${item.label}: ${value} of 100`} />
            <p className="text-xs leading-relaxed text-muted">{item.rationale}</p>
          </div>
        );
      })}
    </div>
  );
}
