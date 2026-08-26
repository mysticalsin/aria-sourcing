/**
 * Authoritative constants for the end-to-end Mantu recruiting loop.
 * Webhook-triggered intake → source → shortlist → outreach → first interview.
 */

/** Target shortlist size after sourcing and scoring (top N candidates). */
export const TOP_CANDIDATE_SHORTLIST_SIZE = 10;

/** Default batch size when sourcing from a parsed need email. */
export const DEFAULT_SOURCING_BATCH_SIZE = 15;

/** Minimum match score (0–100) to enter the top-10 shortlist. */
export const DEFAULT_SHORTLIST_MIN_SCORE = 70;

/** Pipeline stage kinds (mirror scripts/sourcing-loop-worker.mjs). */
export const RECRUITING_LOOP_STAGES = [
  "requisition_parse",
  "campaign_create",
  "sourcing_batch",
  "shortlist_build",
  "draft_generate",
  "inbound_classify",
] as const;

export type RecruitingLoopStage = (typeof RECRUITING_LOOP_STAGES)[number];
