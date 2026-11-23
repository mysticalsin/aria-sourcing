import { createHash } from "crypto";

import { sanitizeOutreachSubject } from "../outreach-content";
import type { ExactMessage } from "./types";

type HashableMessage = Pick<ExactMessage, "channel" | "recipient" | "subject" | "body" | "noticeVersion"> & {
  approverId?: string;
  approvedAt?: string;
};

/** Notice version shared by the approve route and the send path. */
export const OUTREACH_NOTICE_VERSION = "outreach-v1";

/** Length-prefixed field so a delimiter inside one value cannot slide into the next. */
export function lengthPrefixed(value: string): string {
  const text = value ?? "";
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

function canonical(value: string | null | undefined): string {
  return (value ?? "").normalize("NFC");
}

/** UTC timestamp with millisecond precision, the form Postgres stores and returns. */
export function canonicalApprovalTimestamp(value: string | null | undefined): string {
  const text = canonical(value).trim();
  if (!text) return "";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toISOString();
}

/**
 * Hash of the exact text a send would deliver.
 *
 * Channel, recipient, subject, body, notice version, approver id, and approval
 * timestamp are each Unicode-normalized to NFC and then length-prefixed.
 * Subject bytes are the sanitized subject, so a reviewer cannot approve a
 * different header than the one that would be sent. Two strings that are the
 * same under NFC produce the same hash. A different approver or timestamp does not.
 */
export function exactBodyHash(message: HashableMessage): string {
  const channel = canonical(message.channel).trim();
  const recipient = canonical(message.recipient).trim().toLocaleLowerCase();
  const subject = sanitizeOutreachSubject(canonical(message.subject));
  const body = canonical(message.body);
  const noticeVersion = canonical(message.noticeVersion).trim();
  const approverId = canonical(message.approverId).trim();
  const approvedAt = canonicalApprovalTimestamp(message.approvedAt);
  return createHash("sha256")
    .update(
      lengthPrefixed(channel) +
        lengthPrefixed(recipient) +
        lengthPrefixed(subject) +
        lengthPrefixed(body) +
        lengthPrefixed(noticeVersion) +
        lengthPrefixed(approverId) +
        lengthPrefixed(approvedAt),
      "utf8",
    )
    .digest("hex");
}
