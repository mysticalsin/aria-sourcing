/**
 * Effective outreach send mode: never claim Live when no mailbox is connected.
 * HeyReach / LinkedIn assisted-manual "live" toggles do not unlock Queue Summary Live.
 */

import type { AgentSeat, IntegrationStatus, LedgerStatus, OutreachChannel, OutreachStatus } from "@/lib/types";

export type ConnectedOutboundProvider = {
  kind: "mailbox" | "linkedin";
  label: string;
  detail: string;
};

const MAILBOX_INTEGRATION_IDS = new Set([
  "int_outlook",
  "int_gmail",
  "int_sendgrid",
  "int_resend",
]);

/** True when seat provider can send Email via Graph/Gmail/API mail (not LinkedIn/WA). */
export function isMailboxSeatProvider(provider: string | null | undefined): boolean {
  return (
    provider === "Microsoft Graph" ||
    provider === "Gmail API" ||
    provider === "SendGrid" ||
    provider === "Resend"
  );
}

/** Live mailbox seats eligible for Email send (not LinkedIn/WA/SMS seats). */
export function isLiveMailboxSeat(seat: AgentSeat): boolean {
  return seat.status === "active" && seat.mode === "live" && isMailboxSeatProvider(seat.provider);
}

function isLinkedInSeatProvider(provider: AgentSeat["provider"]): boolean {
  return (
    provider === "LinkedIn Assisted Manual" ||
    provider === "LinkedIn Vendor API" ||
    provider === "HeyReach"
  );
}

function integrationAccountReady(integ: IntegrationStatus): string | null {
  if (!integ.real) return null;
  const account = integ.connectedAccount?.trim();
  if (!account) return null;
  if (integ.status !== "connected" && integ.status !== "degraded") return null;
  // Graph/Gmail OAuth and API-key mailboxes require mode=live before Live send.
  // Pasted SMTP/API credentials alone must not unlock Queue Summary Live.
  if (MAILBOX_INTEGRATION_IDS.has(integ.id) && integ.mode !== "live") return null;
  return account;
}

/** Mailboxes only — Outlook / Gmail / SendGrid / Resend with a real account. */
export function listConnectedMailboxes(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): ConnectedOutboundProvider[] {
  const out: ConnectedOutboundProvider[] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    if (seat.status !== "active") continue;
    if (!isMailboxSeatProvider(seat.provider)) continue;
    const account = seat.connectedAccount?.trim();
    if (!account) continue;
    // Every mailbox seat needs mode=live — pasted SendGrid/Resend labels must not unlock Live.
    if (seat.mode !== "live") continue;
    const key = `${seat.provider}:${account.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "mailbox", label: seat.provider, detail: account });
  }

  // Integrations cards are NOT authority for Live send unless they carry a real
  // connectedAccount (mailbox email). Status-only "connected"/"degraded" without
  // an account must not flip Queue Summary to Live.
  if (integrations) {
    for (const integ of integrations) {
      if (!MAILBOX_INTEGRATION_IDS.has(integ.id)) continue;
      const account = integrationAccountReady(integ);
      if (!account) continue;
      const key = `${integ.id}:${account.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "mailbox", label: integ.name, detail: account });
    }
  }

  return out;
}

/** LinkedIn / HeyReach tooling — informational only; never unlocks Send mode Live alone. */
export function listConnectedLinkedInProviders(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): ConnectedOutboundProvider[] {
  const out: ConnectedOutboundProvider[] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    if (seat.status !== "active") continue;
    if (!isLinkedInSeatProvider(seat.provider)) continue;
    const account = seat.connectedAccount?.trim();
    if (!account) continue;
    const key = `${seat.provider}:${account.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "linkedin", label: seat.provider, detail: account });
  }

  if (out.length === 0 && integrations) {
    for (const integ of integrations) {
      if (integ.id !== "int_heyreach" && integ.id !== "int_linkedin_rsc") continue;
      const account = integrationAccountReady(integ);
      if (!account) continue;
      out.push({ kind: "linkedin", label: integ.name, detail: account });
    }
  }

  return out;
}

/** Live mailbox (Email) or LinkedIn seat ready for assisted-manual outreach. */
export function listConnectedOutboundProviders(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): ConnectedOutboundProvider[] {
  return [
    ...listConnectedMailboxes(seats, integrations),
    ...listConnectedLinkedInProviders(seats, integrations),
  ];
}

export function hasConnectedOutboundProvider(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): boolean {
  return listConnectedOutboundProviders(seats, integrations).length > 0;
}

export function hasConnectedMailbox(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): boolean {
  return listConnectedMailboxes(seats, integrations).length > 0;
}

/**
 * True when settings ask for dry-run OR no mailbox is connected (force preview).
 * LinkedIn / HeyReach live alone must not claim Live in Queue Summary.
 */
export function effectiveDryRunMode(
  dryRunSetting: boolean,
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): boolean {
  if (dryRunSetting) return true;
  return !hasConnectedMailbox(seats, integrations);
}

/**
 * Pure approve→delivery plan. Dry-run never stamps a simulated send
 * (no Scheduled/sentAt/ledger sent). Live Email/WA/SMS stay Approved until
 * explicit send; LinkedIn stays Pending Manual Send unless a HeyReach/vendor
 * seat can queue durable delivery (then Approved → Send like Email).
 */
export function planOutreachApprovalDelivery(input: {
  channel: OutreachChannel;
  forceDryRun: boolean;
  /** Live HeyReach / LinkedIn Vendor seat present — LinkedIn can queue after Approve. */
  linkedInCanQueue?: boolean;
}): {
  isLinkedInManual: boolean;
  isLiveSendChannel: boolean;
  finalStatus: OutreachStatus;
  finalLedgerStatus: LedgerStatus;
  stampSimulatedSend: boolean;
} {
  const isLive = !input.forceDryRun;
  const linkedInCanQueue = input.linkedInCanQueue === true;
  const isLinkedInManual = input.channel === "LinkedIn" && !linkedInCanQueue;
  const isLiveSendChannel =
    ((input.channel === "Email" || input.channel === "WhatsApp" || input.channel === "SMS") && isLive)
    || (input.channel === "LinkedIn" && linkedInCanQueue && isLive);
  const finalStatus: OutreachStatus = isLinkedInManual
    ? "Pending Manual Send"
    : isLiveSendChannel || input.forceDryRun
      ? "Approved"
      : "Scheduled";
  const finalLedgerStatus: LedgerStatus = isLinkedInManual
    ? "pending_manual"
    : isLiveSendChannel || input.forceDryRun
      ? "claimed"
      : "sent";
  const stampSimulatedSend = !input.forceDryRun && !isLinkedInManual && !isLiveSendChannel;
  return { isLinkedInManual, isLiveSendChannel, finalStatus, finalLedgerStatus, stampSimulatedSend };
}

export function isLinkedInDeliverySeat(seat: AgentSeat): boolean {
  return (
    seat.status === "active" &&
    seat.mode === "live" &&
    (seat.provider === "HeyReach" ||
      seat.provider === "LinkedIn Vendor API" ||
      seat.provider === "LinkedIn Assisted Manual")
  );
}

export function hasLiveLinkedInQueueSeat(seats: AgentSeat[]): boolean {
  return seats.some(
    (seat) =>
      seat.status === "active" &&
      seat.mode === "live" &&
      (seat.provider === "HeyReach" || seat.provider === "LinkedIn Vendor API"),
  );
}
