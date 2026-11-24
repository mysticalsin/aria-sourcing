/* ============================================================================
   ROI estimate shared by the Trust & ROI calculator and the Exec report.

   Every output is an editable assumption multiplied by a real, auditable count
   from the workspace; nothing here is a hardcoded result.
   ========================================================================== */

export interface RoiAssumptions {
  /** Recruiter fully-loaded cost per hour. */
  hourlyCost: number;
  /** Recruiter hours saved per profile sourced and scored. */
  hoursPerSourced: number;
  /** Recruiter hours saved per outreach draft written. */
  hoursPerDraft: number;
  /** Recruiter hours saved per interview booked. */
  hoursPerBooking: number;
  /** Monthly cost of running ARIA. */
  monthlyCost: number;
}

/** Illustrative defaults; every one is editable in Trust & ROI. */
export const DEFAULT_ROI_ASSUMPTIONS: RoiAssumptions = {
  hourlyCost: 60,
  hoursPerSourced: 0.25,
  hoursPerDraft: 0.2,
  hoursPerBooking: 1.5,
  monthlyCost: 1500,
};

export interface RoiCounts {
  sourced: number;
  drafted: number;
  booked: number;
  /** Days of activity the counts were observed over (at least 1). */
  spanDays: number;
}

export interface RoiEstimate {
  hoursSaved: number;
  valueSaved: number;
  annualSaving: number;
  annualCost: number;
  /** Annual saving divided by annual cost; 0 when cost is 0. */
  multiple: number;
}

export function estimateRoi(counts: RoiCounts, assumptions: RoiAssumptions = DEFAULT_ROI_ASSUMPTIONS): RoiEstimate {
  const hoursSaved =
    counts.sourced * assumptions.hoursPerSourced +
    counts.drafted * assumptions.hoursPerDraft +
    counts.booked * assumptions.hoursPerBooking;
  const valueSaved = hoursSaved * assumptions.hourlyCost;
  const annualSaving = (valueSaved / Math.max(1, counts.spanDays)) * 365;
  const annualCost = assumptions.monthlyCost * 12;
  return {
    hoursSaved,
    valueSaved,
    annualSaving,
    annualCost,
    multiple: annualCost > 0 ? annualSaving / annualCost : 0,
  };
}

/** Days between the earliest and latest timestamp, at least 1. */
export function activitySpanDays(dates: string[]): number {
  const times = dates.map((date) => new Date(date).getTime()).filter(Number.isFinite);
  if (times.length === 0) return 1;
  return Math.max(1, Math.round(((Math.max(...times) - Math.min(...times)) / 86_400_000) * 10) / 10);
}
