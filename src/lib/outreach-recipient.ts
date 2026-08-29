/**
 * Resolve the outbound address for Autopilot / Approve→Send.
 * Interviewer prep must never fall back to the candidate's contact.
 */

import type { Candidate, OutreachChannel, OutreachMessage } from "@/lib/types";

export function outreachDispatchRecipient(
  message: Pick<OutreachMessage, "channel" | "recipientOverride" | "prepPurpose">,
  candidate: Pick<Candidate, "email" | "phone" | "linkedinUrl">,
): string {
  const override = message.recipientOverride?.trim() ?? "";
  if (override) return override;
  // Fail-closed: interviewer prep without override must not use candidate email.
  if (message.prepPurpose === "interviewer") return "";

  const channel = (message.channel ?? "Email") as OutreachChannel;
  if (channel === "WhatsApp" || channel === "SMS") return candidate.phone?.trim() ?? "";
  if (channel === "LinkedIn") return candidate.linkedinUrl?.trim() ?? "";
  return candidate.email?.trim() ?? "";
}
