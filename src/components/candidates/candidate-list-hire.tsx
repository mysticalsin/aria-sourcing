import { Badge } from "@/components/ui/badge";
import { candidateListHire, type CandidateListRow } from "@/lib/candidate-list-hire";
import { toneForStage } from "@/lib/utils";

/** Stage cell for the candidate list: hired rows say Hired and show the stored employee id. */
export function CandidateListHireStatus({ candidate }: { candidate: CandidateListRow }) {
  const hire = candidateListHire(candidate);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={toneForStage(candidate.stage)} size="sm" dot>
        {candidate.stage}
      </Badge>
      {hire.hired && hire.employeeId != null ? (
        <span data-testid="candidate-employee-id" className="text-xs font-medium tabular-nums text-ink-soft">
          Employee {hire.employeeId}
        </span>
      ) : null}
    </span>
  );
}
