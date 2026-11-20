import { createHash } from "crypto";

import { approvalHash } from "../outreach-content";
import type { ExactMessage } from "./types";

type HashableMessage = Pick<ExactMessage, "channel" | "recipient" | "subject" | "body" | "noticeVersion">;

/**
 * Hash of the exact text a send would deliver.
 *
 * The subject/body pair reuses `approvalHash`, including its header
 * sanitization, and the outer digest binds channel, recipient, and notice
 * version. Any edit of those fields produces a different hash.
 */
export function exactBodyHash(message: HashableMessage): string {
  const content = approvalHash(message.subject ?? "", message.body ?? "");
  const channel = (message.channel ?? "").trim();
  const recipient = (message.recipient ?? "").trim().toLocaleLowerCase();
  const noticeVersion = (message.noticeVersion ?? "").trim();
  return createHash("sha256")
    .update(`${channel}\n${recipient}\n${content}\n${noticeVersion}`, "utf8")
    .digest("hex");
}
