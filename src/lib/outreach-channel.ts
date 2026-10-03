import type { Candidate, OutreachChannel } from "@/lib/types";

/**
 * Prefer a channel the candidate can actually receive.
 * LinkedIn-sourced profiles often lack email — defaulting to Email would
 * block Approve with a dead-end "no email" rule. Prefer LinkedIn when a
 * profile URL exists and email is blank.
 */
export function preferredOutreachChannel(
  candidate: Pick<Candidate, "email" | "linkedinUrl" | "phone">,
): OutreachChannel {
  const email = candidate.email.trim();
  const linkedin = candidate.linkedinUrl.trim();
  if (email) return "Email";
  if (linkedin) return "LinkedIn";
  if ((candidate.phone ?? "").trim()) return "WhatsApp";
  return "Email";
}
