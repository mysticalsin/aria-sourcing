import { createHash } from "crypto";
import { normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";

/**
 * Subjects enter email headers, so they are always reduced to one printable
 * line before both approval and delivery. Keeping this in one module prevents
 * a reviewer from approving content that differs from the eventual send.
 */
export function sanitizeOutreachSubject(value: string): string {
  return (value ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash the exact subject/body pair the operator reviewed. */
export function approvalHash(subject: string, body: string): string {
  return createHash("sha256").update(`${sanitizeOutreachSubject(subject)}\n${body ?? ""}`, "utf8").digest("hex");
}

export interface ApprovalScopeInput {
  candidateId: string;
  channel: string;
  recipient: string;
}

/**
 * Binds a human approval to the candidate, channel, and normalized destination.
 * The content hash alone is insufficient because identical copy could otherwise
 * be redirected to a different person after approval.
 */
export function approvalScopeHash(input: ApprovalScopeInput): string | null {
  const candidateId = input.candidateId.trim();
  const channel = input.channel.trim();
  if (!candidateId || !channel) return null;
  const recipient =
    channel === "WhatsApp" || channel === "SMS"
      ? normalizeWhatsAppAddress(input.recipient)
      : input.recipient.trim().toLocaleLowerCase();
  if (!recipient) return null;
  return createHash("sha256").update(`${candidateId}\n${channel}\n${recipient}`, "utf8").digest("hex");
}
