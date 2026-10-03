import type { Candidate } from "./types";

type CandidateFitEndorsementRecord = Pick<Candidate, "fitEndorsedAt" | "fitEndorsedSource">;

const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Returns true when an operator endorsed role fit for outreach. */
export function recordedCandidateFitEndorsement(
  candidate: CandidateFitEndorsementRecord,
): boolean {
  if (candidate.fitEndorsedSource !== "operator_selection") return false;
  return isCanonicalIsoTimestamp(candidate.fitEndorsedAt);
}
