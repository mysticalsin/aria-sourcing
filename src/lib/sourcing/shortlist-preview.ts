import type { Candidate } from "@/lib/types";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";

/** Use the same identity/purpose policy as the candidate list and drawer. */
export function shortlistIdentity(candidate: Candidate, confidentialityMode: boolean) {
  const reveal = hasOutreachPurpose(candidate.stage);
  const display = applyConfidentiality(candidate, { confidentialityMode, reveal });
  return {
    name: display.name,
    profileUrl: !confidentialityMode || reveal
      ? candidate.linkedinUrl || candidate.githubUrl || candidate.sourceUrl || ""
      : "",
  };
}
