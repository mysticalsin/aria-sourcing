/**
 * In-product Connect → source → outreach. Official OAuth only.
 * LinkedIn is assisted-manual after connect. Outlook is Microsoft mailbox OAuth.
 * Never auto-send. Never scrape. Do not complete OAuth from a VM.
 */
import type {
  AgentSeat,
  ApiKey,
  IntegrationStatus,
  OutreachChannel,
  OutreachMessage,
} from "@/lib/types";

export function providerIsApify(provider: string): boolean {
  return provider === "Apify" || /^apify(\b|\s|$|\()/i.test(provider);
}

export function hasValidApifyKey(
  apiKeys: readonly { provider: string; status: string }[] = [],
): boolean {
  return apiKeys.some((key) => providerIsApify(key.provider) && key.status === "valid");
}

/** Connected+Mock is not a live harvest key. */
export function apifyIntegrationIsMock(
  integrations: readonly Pick<IntegrationStatus, "id" | "mode">[] = [],
): boolean {
  return integrations.some((item) => item.id === "int_apify" && item.mode === "mock");
}

export function hasLiveApifyHarvest(
  integrations: readonly Pick<IntegrationStatus, "id" | "mode">[] = [],
  apiKeys: readonly { provider: string; status: string }[] = [],
): boolean {
  if (apifyIntegrationIsMock(integrations)) return false;
  return hasValidApifyKey(apiKeys);
}

/** Raw workspace_state.integrations — projection does not include cards. */
export function workspaceApifyIsMock(state: unknown): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const integrations = (state as { integrations?: unknown }).integrations;
  if (!Array.isArray(integrations)) return false;
  return apifyIntegrationIsMock(
    integrations.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; mode?: unknown };
      if (typeof row.id !== "string" || typeof row.mode !== "string") return [];
      return [{ id: row.id, mode: row.mode as IntegrationStatus["mode"] }];
    }),
  );
}

export function hasValidHeyReachKey(
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  return apiKeys.some(
    (key) =>
      (key.provider === "HeyReach" || key.provider === "HeyReach MCP") &&
      key.status === "valid",
  );
}

const SYNTHETIC_EMAIL_HOSTS = new Set(["example.com", "fixture.example"]);

export function isSyntheticRecipientEmail(email: string): boolean {
  const host = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!host) return false;
  return SYNTHETIC_EMAIL_HOSTS.has(host) || host.endsWith(".example.com");
}

export const CONNECT_CHANNELS_COPY =
  "Connect LinkedIn and Outlook in-product to search live people and send. Source next batch still runs a dry-run shortlist. Email also needs Verify domain in Fleet. Send stays dry-run until the channel is connected and you approve.";

export const CONNECT_LINKEDIN_LABEL = "Connect LinkedIn";
export const CONNECT_OUTLOOK_LABEL = "Connect Outlook";

const LINKEDIN_SEAT_PROVIDERS = new Set(["LinkedIn Vendor API", "LinkedIn Assisted Manual"]);
const OUTLOOK_SEAT_PROVIDERS = new Set(["Microsoft Graph"]);
const MAILBOX_SEAT_PROVIDERS = new Set(["Microsoft Graph", "Gmail API"]);

function firstSeatId(
  seats: readonly Pick<AgentSeat, "id" | "provider">[],
  providers: ReadonlySet<string>,
): string {
  return seats.find((seat) => providers.has(seat.provider))?.id ?? "";
}

export function linkedinConnectHref(
  seats: readonly Pick<AgentSeat, "id" | "provider">[],
): string {
  const seatId = firstSeatId(seats, LINKEDIN_SEAT_PROVIDERS);
  return seatId
    ? `/auth/linkedin?seat_id=${encodeURIComponent(seatId)}`
    : "/fleet?connect=linkedin";
}

export function outlookConnectHref(
  seats: readonly Pick<AgentSeat, "id" | "provider">[],
): string {
  const seatId = firstSeatId(seats, OUTLOOK_SEAT_PROVIDERS);
  return seatId
    ? `/auth/microsoft?seat_id=${encodeURIComponent(seatId)}`
    : "/fleet?connect=outlook";
}

function accountConnected(seat: Pick<AgentSeat, "connectedAccount" | "status">): boolean {
  return seat.status === "active" && Boolean(seat.connectedAccount?.trim());
}

export function isOutlookMailboxConnected(seats: readonly AgentSeat[]): boolean {
  return seats.some(
    (seat) =>
      MAILBOX_SEAT_PROVIDERS.has(seat.provider) &&
      seat.mode === "live" &&
      accountConnected(seat),
  );
}

export function needsDomainVerify(seats: readonly AgentSeat[]): boolean {
  return seats.some(
    (seat) =>
      MAILBOX_SEAT_PROVIDERS.has(seat.provider) &&
      seat.mode === "live" &&
      accountConnected(seat) &&
      !seat.domainVerified,
  );
}

export function isOutlookReadyToSend(seats: readonly AgentSeat[]): boolean {
  return seats.some(
    (seat) =>
      MAILBOX_SEAT_PROVIDERS.has(seat.provider) &&
      seat.mode === "live" &&
      accountConnected(seat) &&
      seat.domainVerified,
  );
}

export function isLinkedInMessagingConnected(
  seats: readonly AgentSeat[],
  integrations: readonly IntegrationStatus[] = [],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (hasValidHeyReachKey(apiKeys)) return true;
  const seatOk = seats.some(
    (seat) => LINKEDIN_SEAT_PROVIDERS.has(seat.provider) && accountConnected(seat),
  );
  const rscOk = integrations.some(
    (row) =>
      (row.id === "int_heyreach" ||
        row.id === "int_linkedin_rsc" ||
        row.id.startsWith("int_linkedin")) &&
      row.status === "connected" &&
      row.mode === "live",
  );
  return seatOk || rscOk;
}

export function needsChannelConnect(
  seats: readonly AgentSeat[],
  integrations: readonly IntegrationStatus[] = [],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  return (
    !isLinkedInMessagingConnected(seats, integrations, apiKeys) ||
    !isOutlookMailboxConnected(seats)
  );
}

export function channelReadyForLiveSend(
  channel: OutreachChannel,
  seats: readonly AgentSeat[],
  integrations: readonly IntegrationStatus[] = [],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): boolean {
  if (channel === "Email") return isOutlookReadyToSend(seats);
  if (channel === "LinkedIn") return isLinkedInMessagingConnected(seats, integrations, apiKeys);
  if (channel === "WhatsApp") {
    return seats.some(
      (seat) =>
        seat.provider === "WhatsApp Cloud" &&
        seat.mode === "live" &&
        accountConnected(seat),
    );
  }
  return seats.some(
    (seat) => seat.provider === "Twilio SMS" && seat.mode === "live" && accountConnected(seat),
  );
}

export function liveMailboxSeat(seats: readonly AgentSeat[]): AgentSeat | undefined {
  return seats.find(
    (seat) =>
      MAILBOX_SEAT_PROVIDERS.has(seat.provider) &&
      seat.status === "active" &&
      seat.mode === "live" &&
      Boolean(seat.connectedAccount?.trim()) &&
      seat.domainVerified,
  );
}

/** Hard gate: send cannot fire without channel-connect AND the right approval status. */
export function liveSendBlocker(
  channel: OutreachChannel,
  status: OutreachMessage["status"],
  seats: readonly AgentSeat[],
  integrations: readonly IntegrationStatus[] = [],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
  recipientEmail?: string,
): string | null {
  if (channel === "Email" && recipientEmail && isSyntheticRecipientEmail(recipientEmail)) {
    return "Cannot send to a synthetic example.com address. Enrich a real mailbox first.";
  }
  if (channel === "Email") {
    if (status !== "Approved") return "Only an approved message can be sent.";
    if (!isOutlookMailboxConnected(seats)) {
      return "Connect Outlook in Fleet (Microsoft account), then Verify domain. Approval alone never sends.";
    }
    if (!isOutlookReadyToSend(seats)) {
      return "Verify domain in Fleet before a live email send. Approval alone never sends.";
    }
    return null;
  }
  if (channel === "LinkedIn") {
    if (status !== "Pending Manual Send") return "Message is not awaiting manual send.";
    if (!channelReadyForLiveSend("LinkedIn", seats, integrations, apiKeys)) {
      return "Connect LinkedIn or HeyReach in-product before confirming a send. Approval alone never sends.";
    }
    return null;
  }
  if (status !== "Approved") return "Only an approved message can be sent.";
  if (!channelReadyForLiveSend(channel, seats, integrations, apiKeys)) {
    return `Connect ${channel} in-product before sending. Approval alone never sends.`;
  }
  return null;
}

export function isConnectOrDryRunCopy(text: string): boolean {
  return /connect linkedin and outlook|dry-run shortlist/i.test(text);
}

/** A valid Access & Keys row is the working surface — mark the matching card connected. */
export function applyHarvestKeysToIntegrations(
  integrations: IntegrationStatus[],
  apiKeys: readonly Pick<ApiKey, "provider" | "status">[] = [],
): IntegrationStatus[] {
  const apify = hasValidApifyKey(apiKeys);
  if (!apify) return integrations;
  return integrations.map((row) => {
    if (row.id === "int_apify") {
      return { ...row, status: "connected" as const, errors: [] };
    }
    return row;
  });
}
