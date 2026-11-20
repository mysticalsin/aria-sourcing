import { createHash } from "crypto";

import { sanitizeOutreachSubject } from "../outreach-content";
import type { ExactMessage } from "./types";

type HashableMessage = Pick<ExactMessage, "channel" | "recipient" | "subject" | "body" | "noticeVersion">;

/** Length-prefixed field so a delimiter inside one value cannot slide into the next. */
export function lengthPrefixed(value: string): string {
  const text = value ?? "";
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

/**
 * Hash of the exact text a send would deliver.
 *
 * Channel, recipient, subject, body, and notice version are each length-prefixed.
 * Subject bytes are the sanitized subject Michael's approvalHash already uses,
 * so a reviewer cannot approve a different header than the one that would be sent.
 */
export function exactBodyHash(message: HashableMessage): string {
  const channel = (message.channel ?? "").trim();
  const recipient = (message.recipient ?? "").trim().toLocaleLowerCase();
  const subject = sanitizeOutreachSubject(message.subject ?? "");
  const body = message.body ?? "";
  const noticeVersion = (message.noticeVersion ?? "").trim();
  return createHash("sha256")
    .update(
      lengthPrefixed(channel) +
        lengthPrefixed(recipient) +
        lengthPrefixed(subject) +
        lengthPrefixed(body) +
        lengthPrefixed(noticeVersion),
      "utf8",
    )
    .digest("hex");
}
