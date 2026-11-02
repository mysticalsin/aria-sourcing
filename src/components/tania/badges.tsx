import * as React from "react";
import { UserRoundCheck, UserRoundPlus, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEAD_SOURCE_META,
  TANIA_STAGE_META,
} from "@/lib/tania";
import type { LeadSource, TaniaStage } from "@/lib/types";

/* ============================================================================
   Pipeline badges — reuse the Mantu design tokens (globals.css) so new surfaces
   inherit the existing visual language. No new palette.
   ========================================================================== */

/** Match score bands, shared by every surface that rates a person: one scale,
 *  the /100 score, instead of tiers, letters or stars. */
export const SCORE_BANDS = [
  { id: "strong", label: "80+", min: 80, className: "bg-success-soft text-success ring-success/25" },
  { id: "fair", label: "60–79", min: 60, className: "bg-electric-soft text-electric ring-electric/25" },
  { id: "weak", label: "Under 60", min: 0, className: "bg-ink/[0.06] text-ink-soft ring-ink/10" },
] as const;

export function scoreBand(score: number) {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function ScoreBadge({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const value = Math.round(score);
  return (
    <span
      className={cn(
        "inline-flex items-baseline rounded-full font-semibold tabular-nums ring-1 ring-inset whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs",
        scoreBand(value).className,
        className,
      )}
      title={`Match score ${value} of 100`}
    >
      {value}
      <span className="opacity-60">/100</span>
    </span>
  );
}

const SOURCE_CLASSES: Record<LeadSource, string> = {
  Applicant: "bg-electric-soft text-electric ring-electric/25",
  Referral: "bg-violet-soft text-violet ring-violet/25",
  Outbound: "bg-tangerine-soft text-tangerine ring-tangerine/25",
};

const SOURCE_ICON: Record<LeadSource, React.ComponentType<{ className?: string }>> = {
  Applicant: UserRoundCheck,
  Referral: UserRoundPlus,
  Outbound: Radar,
};

export function SourceBadge({
  source,
  size = "md",
  showLabel = true,
  className,
}: {
  source: LeadSource;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  const meta = LEAD_SOURCE_META[source];
  const Icon = SOURCE_ICON[source];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs",
        SOURCE_CLASSES[source],
        className,
      )}
      title={`${meta.label}: ${meta.entry}. ${meta.tone}`}
    >
      <Icon className={cn("shrink-0", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      {showLabel ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

const STAGE_CLASSES: Record<TaniaStage, string> = {
  Chatbox: "bg-ink/[0.06] text-ink-soft ring-ink/10",
  Need: "bg-electric-soft text-electric ring-electric/25",
  Leads: "bg-aqua-soft text-aqua ring-aqua/25",
  Candidates: "bg-violet-soft text-violet ring-violet/25",
  Offered: "bg-tangerine-soft text-tangerine ring-tangerine/25",
  Employees: "bg-success-soft text-success ring-success/25",
};

export function StageBadge({
  stage,
  size = "md",
  className,
}: {
  stage: TaniaStage;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = TANIA_STAGE_META[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs",
        STAGE_CLASSES[stage],
        className,
      )}
      title={meta.description}
    >
      <span className="tabular-nums font-bold opacity-70">{meta.roman}</span>
      {meta.label}
    </span>
  );
}
