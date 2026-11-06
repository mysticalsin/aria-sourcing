import type { Candidate } from "@/lib/types";
import { applyConfidentiality, hasOutreachPurpose } from "@/lib/confidential";

/** Use the same identity/purpose policy as the candidate list and drawer. */
export function shortlistIdentity(candidate: Candidate, confidentialityMode: boolean) {
  const reveal = hasOutreachPurpose(candidate.stage);
  const display = applyConfidentiality(candidate, { confidentialityMode, reveal });
  const visible = !confidentialityMode || reveal;
  const [profileUrl, profileLabel] = !visible ? ["", ""]
    : candidate.linkedinUrl ? [candidate.linkedinUrl, "LinkedIn"]
    : candidate.githubUrl ? [candidate.githubUrl, "GitHub"]
    : candidate.sourceUrl ? [candidate.sourceUrl, "Source profile"]
    : ["", ""];
  return { name: display.name, display, profileUrl, profileLabel };
}
