import { namedHiredStage } from "./hire-employee";
import type { CandidateStage } from "./types";

/** The candidate fields the list reads. No network. */
export interface CandidateListRow {
  stage: CandidateStage;
  /** hr.employee id already stored on the candidate. Absent until a hire writes one. */
  odooEmployeeId?: number;
}

export interface CandidateListHire {
  /** True when this row's stage is the hired stage. */
  hired: boolean;
  /** The stored positive hr.employee id, only for a hired row. */
  employeeId: number | null;
}

function storedEmployeeId(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Copy a successful hire's hr.employee id onto the candidate.
 * A missing or invalid id leaves the row unchanged. No network.
 */
export function storeHiredEmployeeId<T extends CandidateListRow>(row: T, employeeId: number | null): T {
  const stored = storedEmployeeId(employeeId);
  if (stored == null || row.odooEmployeeId === stored) return row;
  return { ...row, odooEmployeeId: stored };
}

/**
 * What the candidate list shows for a hire. A hired row is hired and shows
 * the employee id already stored on that row. Any other stage is not hired
 * and shows no employee id. Reads the in-memory record only.
 */
export function candidateListHire(row: CandidateListRow): CandidateListHire {
  const hiredStage = namedHiredStage();
  const hired = hiredStage != null && row.stage === hiredStage;
  if (!hired) return { hired: false, employeeId: null };
  return { hired: true, employeeId: storedEmployeeId(row.odooEmployeeId) };
}
