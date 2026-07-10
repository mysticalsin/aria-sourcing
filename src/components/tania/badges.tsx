import * as React from "react";
import { Star, UserRoundCheck, UserRoundPlus, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEAD_SOURCE_META,
  STAR_RATING_META,
  TANIA_STAGE_META,
} from "@/lib/tania";
import type { LeadSource, StarRating, TaniaStage } from "@/lib/types";

/* ============================================================================
   TAnIA badges — reuse the Mantu design tokens (globals.css) so new surfaces
   inherit the existing visual language. No new palette.
   ========================================================================== */

const STAR_CLASSES: Record<StarRating, string> = {
  TopGun: "bg-mantu-yellow text-mantu-yellow-ink ring-mantu-yellow/50",
  A: "bg-electric-soft text-electric ring-electric/25",
  B: "bg-aqua-soft text-aqua ring-aqua/25",
  C: "bg-ink/[0.06] text-ink-soft ring-ink/10",
  D: "bg-danger-soft text-danger ring-danger/20",
};

export function StarBadge({
  rating,
  size = "md",
  showLabel = true,
  className,
}: {
  rating: StarRating;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  const meta = STAR_RATING_META[rating];
  const filled = { TopGun: 5, A: 4, B: 3, C: 2, D: 1 }[rating];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem]" : "px-2.5 py-1 text-xs",
        STAR_CLASSES[rating],
        className,
      )}
      title={`${meta.label}: ${meta.criteria} (${meta.yes})`}
    >
      <Star
        className={cn("shrink-0", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")}
        fill={rating === "TopGun" || rating === "A" ? "currentColor" : "none"}
        strokeWidth={2}
        aria-hidden
      />
      {showLabel && (rating === "TopGun" ? "Top Gun" : rating === "A" || rating === "B" ? `${rating} Player` : rating)}
      {!showLabel && <span className="sr-only">{meta.label}</span>}
      {size === "md" && showLabel && rating !== "C" && rating !== "D" && (
        <span className="tabular-nums opacity-70">{filled}★</span>
      )}
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
