/**
 * Effective outreach send mode: never claim Live when no outbound provider
 * (mailbox / LinkedIn seat) is actually connected.
 */

import type { AgentSeat, IntegrationStatus } from "@/lib/types";

export type ConnectedOutboundProvider = {
  kind: "mailbox" | "linkedin";
  label: string;
  detail: string;
};

/** Live mailbox (Email) or LinkedIn seat ready for assisted-manual outreach. */
export function listConnectedOutboundProviders(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): ConnectedOutboundProvider[] {
  const out: ConnectedOutboundProvider[] = [];
  for (const seat of seats) {
    if (seat.status !== "active") continue;
    const isLinkedIn =
      seat.provider === "LinkedIn Assisted Manual" || seat.provider === "LinkedIn Vendor API";
    if (isLinkedIn) {
      if (seat.mode === "live" || Boolean(seat.connectedAccount?.trim())) {
        out.push({
          kind: "linkedin",
          label: seat.provider,
          detail: seat.connectedAccount?.trim() || seat.name,
        });
      }
      continue;
    }
    const mailboxReady =
      Boolean(seat.connectedAccount?.trim()) &&
      (seat.provider === "Microsoft Graph" ||
        seat.provider === "Gmail API" ||
        seat.provider === "SendGrid" ||
        seat.provider === "Resend");
    if (mailboxReady) {
      out.push({
        kind: "mailbox",
        label: seat.provider,
        detail: seat.connectedAccount.trim(),
      });
    }
  }
  if (out.length === 0 && integrations) {
    for (const integ of integrations) {
      if (!integ.real) continue;
      if (integ.status !== "connected" && integ.status !== "degraded") continue;
      if (
        integ.id === "int_outlook" ||
        integ.id === "int_gmail" ||
        integ.id === "int_sendgrid" ||
        integ.id === "int_resend" ||
        integ.id === "int_heyreach"
      ) {
        out.push({
          kind: integ.id === "int_heyreach" ? "linkedin" : "mailbox",
          label: integ.name,
          detail: integ.status,
        });
      }
    }
  }
  return out;
}

export function hasConnectedOutboundProvider(
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): boolean {
  return listConnectedOutboundProviders(seats, integrations).length > 0;
}

/** True when settings ask for dry-run OR no provider is connected (force preview). */
export function effectiveDryRunMode(
  dryRunSetting: boolean,
  seats: AgentSeat[],
  integrations?: IntegrationStatus[],
): boolean {
  if (dryRunSetting) return true;
  return !hasConnectedOutboundProvider(seats, integrations);
}
