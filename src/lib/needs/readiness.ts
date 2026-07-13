import type { JobAnalysis, ValidationWarning } from "@/lib/types";

export interface NeedReadiness {
  ready: boolean;
  issues: ValidationWarning[];
}

/**
 * Decide whether a parsed role contains enough explicit facts to authorize
 * candidate sourcing. This function evaluates values, not client-supplied
 * warning metadata, so callers cannot clear the gate by deleting warnings.
 */
export function evaluateNeedReadiness(
  job: Pick<
    JobAnalysis,
    "title" | "seniority" | "employmentType" | "locationType" | "requiredSkills"
  >,
): NeedReadiness {
  const issues: ValidationWarning[] = [];
  if (job.title.trim().length < 2) {
    issues.push({
      field: "title",
      severity: "critical",
      message: "Role title is missing and must be confirmed before sourcing.",
    });
  }
  if (job.seniority === "Unspecified") {
    issues.push({
      field: "seniority",
      severity: "critical",
      message: "Seniority was not stated and must be confirmed before sourcing.",
    });
  }
  if (job.employmentType === "Unspecified") {
    issues.push({
      field: "employmentType",
      severity: "critical",
      message: "Employment type was not stated and must be confirmed before sourcing.",
    });
  }
  if (job.locationType === "Unspecified") {
    issues.push({
      field: "locationType",
      severity: "critical",
      message: "Work location type was not stated and must be confirmed before sourcing.",
    });
  }
  if (!job.requiredSkills.some((skill) => skill.trim().length > 0)) {
    issues.push({
      field: "requiredSkills",
      severity: "critical",
      message: "No required skill was stated. Confirm at least one before sourcing.",
    });
  }
  return { ready: issues.length === 0, issues };
}
