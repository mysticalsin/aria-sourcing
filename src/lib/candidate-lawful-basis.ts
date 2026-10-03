import type { Candidate, CandidateLawfulBasis } from "./types";

type CandidateLawfulBasisRecord = Pick<
  Candidate,
  "lawfulBasis" | "lawfulBasisRecordedAt" | "lawfulBasisSource"
>;

const CANONICAL_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Returns a complete operator-recorded basis, or null for partial/invalid state. */
export function recordedCandidateLawfulBasis(
  candidate: CandidateLawfulBasisRecord,
): CandidateLawfulBasis | null {
  if (
    candidate.lawfulBasis !== "consent" &&
    candidate.lawfulBasis !== "legitimate_interest"
  ) {
    return null;
  }
  if (candidate.lawfulBasisSource !== "operator_selection") return null;
  if (!isCanonicalIsoTimestamp(candidate.lawfulBasisRecordedAt)) return null;
  return candidate.lawfulBasis;
}
