import type { LinkedInSenderState } from "./types";

/**
 * Connect LinkedIn card (docs/outreach/ARIA-LINKEDIN-CONNECT.md, section 2.1
 * and S4). One pure decision from three facts, in this order:
 *
 *   1. Is LinkedIn sending enabled on this deployment? The server answers
 *      (GET /api/outreach/linkedin/sender); the browser never infers it. An
 *      unknown answer (null, still loading, request failed) reads as not
 *      enabled, so the card can never show a connected state it did not earn.
 *   2. What did the delivery provider last report for the seat's sender?
 *      Only "connected" is connected. "paused" and "restricted" pause the card.
 *   3. Did the identity step (LinkedIn sign-in) finish? That alone is
 *      "Connecting": the sender is not attached yet and nothing sends.
 */
export type LinkedInCardState = "not-enabled" | "not-connected" | "connecting" | "connected" | "restricted";

export interface LinkedInCardInput {
  /** Server answer. null while unknown. */
  sendingEnabled: boolean | null;
  providerState: LinkedInSenderState | undefined;
  /** agent_seats.connected_account after the LinkedIn sign-in step. */
  connectedAccount: string;
}

export function linkedInCardState(input: LinkedInCardInput): LinkedInCardState {
  if (input.sendingEnabled !== true) return "not-enabled";
  if (input.providerState === "paused" || input.providerState === "restricted") return "restricted";
  if (input.providerState === "connected") return "connected";
  if (input.connectedAccount.trim()) return "connecting";
  return "not-connected";
}

/** Every claim holds unless the seat's sender is connected (0058 mirrors this in SQL). */
export function linkedInSenderCanSend(providerState: string | null | undefined): boolean {
  return providerState === "connected";
}

export const LINKEDIN_CARD_TITLE = "Connect LinkedIn";

export interface LinkedInCardCopy {
  headline: string;
  detail: string;
  /** null means no button in this state. */
  button: "Connect LinkedIn" | "Connecting" | "Disconnect" | "Retry connection" | null;
  buttonDisabled: boolean;
}

/** Operator copy per state. Original Aria copy, no vendor names, no em dashes. */
export function linkedInCardCopy(state: LinkedInCardState, accountName: string): LinkedInCardCopy {
  switch (state) {
    case "not-enabled":
      return {
        headline: "LinkedIn sending is not enabled on this workspace.",
        detail: "Ask your admin.",
        button: null,
        buttonDisabled: true,
      };
    case "not-connected":
      return {
        headline: "Connect your LinkedIn account.",
        detail: "Aria sends connection requests and messages from it, within the daily limits you set in Settings.",
        button: "Connect LinkedIn",
        buttonDisabled: false,
      };
    case "connecting":
      return {
        headline: "Finishing the connection. This can take a minute.",
        detail: "Sending stays off until it finishes.",
        button: "Connecting",
        buttonDisabled: true,
      };
    case "connected":
      return {
        headline: `Connected as ${accountName.trim() || "your LinkedIn account"}. Sending from this account.`,
        detail: "Sending runs from your LinkedIn account and follows your account's limits.",
        button: "Disconnect",
        buttonDisabled: false,
      };
    case "restricted":
      return {
        headline: "LinkedIn has paused sending from this account.",
        detail: "Aria has stopped every campaign until it clears.",
        button: "Retry connection",
        buttonDisabled: false,
      };
  }
}

export const LINKEDIN_SENDER_ENDPOINT = "/api/outreach/linkedin/sender";

/** Parse the server answer. Anything but an explicit true is not enabled. */
export function sendingEnabledFromResponse(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { ok?: unknown; enabled?: unknown }).ok === true &&
    (body as { enabled?: unknown }).enabled === true;
}
