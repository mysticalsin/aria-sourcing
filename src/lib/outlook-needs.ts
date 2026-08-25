/**
 * Outlook / inbox → open-need helpers (pure).
 *
 * Filters synced inbound mail for hiring-need signals and formats them for
 * intake. Keeps mailbox GET sync (`email-sync` / `/api/email/sync`) read-only;
 * this module never talks to Graph itself.
 */

import { isNeedEmail } from "@/lib/mock-ai";
import type { InboundMessage } from "@/lib/email-sync";

export type OutlookNeedMessage = {
  messageId: string;
  seatId?: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  /** Short body preview for list UIs (plain text, truncated). */
  preview: string;
};

const PREVIEW_LEN = 160;

export function needPreview(body: string, max = PREVIEW_LEN): string {
  const plain = body.replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

/** Newest-first hiring-need messages from a sync payload. */
export function filterOutlookNeeds(
  messages: Array<InboundMessage & { seatId?: string }>,
): OutlookNeedMessage[] {
  return messages
    .filter((m) => isNeedEmail(m.subject ?? "", m.body ?? ""))
    .map((m) => ({
      messageId: m.messageId,
      seatId: m.seatId,
      from: m.from ?? "",
      subject: m.subject ?? "",
      body: m.body ?? "",
      receivedAt: m.receivedAt ?? "",
      preview: needPreview(m.body ?? ""),
    }))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

/** Paste-ready intake email block from a need message. */
export function formatNeedAsIntakeEmail(need: OutlookNeedMessage): string {
  return `From: ${need.from}\nSubject: ${need.subject}\n\n${need.body}`;
}

/**
 * Whether a seat looks like a live Outlook/Graph mailbox connection.
 * Demo seats with empty `connectedAccount` are not connected.
 */
export function seatHasOutlookMailbox(seat: {
  provider?: string;
  connectedAccount?: string;
}): boolean {
  if (seat.provider !== "Microsoft Graph") return false;
  return Boolean(seat.connectedAccount?.trim());
}
