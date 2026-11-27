import { candidateListHire, type CandidateListRow } from "@/lib/candidate-list-hire";

/** Stored hr.employee id in the candidate drawer. A hired candidate with a positive id shows it. */
export function CandidateDrawerEmployeeId({ candidate }: { candidate: CandidateListRow }) {
  const hire = candidateListHire(candidate);
  if (!hire.hired || hire.employeeId == null) return null;
  return (
    <span data-testid="drawer-employee-id" className="text-xs font-medium tabular-nums text-ink-soft">
      Employee {hire.employeeId}
    </span>
  );
}
