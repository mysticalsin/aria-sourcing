import { candidateListHire, type CandidateListRow } from "@/lib/candidate-list-hire";

/** The hire result the command center panel is showing. Absent before a result exists. */
export interface CommandHireResult {
  ok?: boolean;
  erp?: string;
  transport?: string;
}

/**
 * Employee id for the command center hire result.
 * A successful hire shows the positive id it returned. A skipped or failed
 * hire shows none. Reads the in-memory record only.
 */
export function commandHireEmployeeId(
  candidate: CandidateListRow | null | undefined,
  result?: CommandHireResult | null,
): number | null {
  if (!candidate) return null;
  if (result && result.ok === false) return null;
  if (result && result.erp === "skipped" && result.transport !== "fixture") return null;
  const hire = candidateListHire(candidate);
  if (!hire.hired || hire.employeeId == null) return null;
  return hire.employeeId;
}

/** Stored hr.employee id on the command center hire result. */
export function CommandHireEmployeeId({
  candidate,
  result = null,
}: {
  candidate: CandidateListRow | null;
  result?: CommandHireResult | null;
}) {
  const employeeId = commandHireEmployeeId(candidate, result);
  if (employeeId == null) return null;
  return (
    <span data-testid="command-hire-employee-id" className="mt-3 block text-xs font-medium tabular-nums text-ink-soft">
      Employee {employeeId}
    </span>
  );
}
