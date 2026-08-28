/**
 * Outlook / inbox → open-need helpers (pure).
 *
 * Filters synced inbound mail for hiring-need signals and formats them for
 * intake. Keeps mailbox GET sync (`email-sync` / `/api/email/sync`) read-only;
 * this module never talks to Graph itself.
 */

import { isNeedEmail, SAMPLE_INTAKE_EMAIL, SAMPLE_MANTU_EMAIL } from "@/lib/mock-ai";
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
  /** True when this is a labelled demo sample, not a live mailbox message. */
  demo?: boolean;
};

const PREVIEW_LEN = 160;

export function needPreview(body: string, max = PREVIEW_LEN): string {
  const plain = body.replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

function subjectFromBlock(block: string, fallback: string): string {
  return block.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || fallback;
}

function fromFromBlock(block: string, fallback: string): string {
  return block.match(/^From:\s*(.+)$/im)?.[1]?.trim() || fallback;
}

function bodyWithoutHeaders(block: string): string {
  return block.replace(/^From:.*$/im, "").replace(/^Subject:.*$/im, "").trim();
}

/**
 * Labelled demo open needs for plug-and-play walkthroughs when Graph isn't
 * connected. Never presented as live mailbox mail.
 */
export function demoOutlookNeeds(nowIso = new Date().toISOString()): OutlookNeedMessage[] {
  const backendBody = bodyWithoutHeaders(SAMPLE_INTAKE_EMAIL);
  const mantuBody = bodyWithoutHeaders(SAMPLE_MANTU_EMAIL);
  return [
    {
      messageId: "demo-need-backend",
      from: fromFromBlock(SAMPLE_INTAKE_EMAIL, "daniela.brandt@northwind.example"),
      subject: subjectFromBlock(SAMPLE_INTAKE_EMAIL, "Senior Backend Engineer"),
      body: backendBody,
      receivedAt: nowIso,
      preview: needPreview(backendBody),
      demo: true,
    },
    {
      messageId: "demo-need-mantu",
      from: fromFromBlock(SAMPLE_MANTU_EMAIL, "noreply@mantu.example"),
      subject:
        subjectFromBlock(SAMPLE_MANTU_EMAIL, "This need is now ACTIVE") ||
        "This need is now ACTIVE: Credit Agricole - Murex Support",
      body: mantuBody,
      receivedAt: nowIso,
      preview: needPreview(mantuBody),
      demo: true,
    },
  ];
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
 * Whether a seat is a live Outlook/Graph mailbox (OAuth callback promoted mode=live).
 * Operator-typed labels alone (`connectedAccount` without mode=live) are not Outlook.
 */
export function seatHasOutlookMailbox(seat: {
  provider?: string;
  connectedAccount?: string;
  mode?: string;
}): boolean {
  if (seat.provider !== "Microsoft Graph") return false;
  if (seat.mode !== "live") return false;
  return Boolean(seat.connectedAccount?.trim());
}
