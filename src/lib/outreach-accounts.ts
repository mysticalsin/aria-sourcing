/**
 * Outreach / sourcing account slots — pure helpers for the operator-facing
 * "which account am I sending/sourcing with?" panel.
 */

import type { AgentSeat, ApiKey, IntegrationStatus } from "@/lib/types";
import {
  listConnectedLinkedInProviders,
  listConnectedMailboxes,
} from "@/lib/outreach-send-mode";

export type OutreachAccountKind = "send" | "linkedin" | "source";

export interface OutreachAccountSlot {
  id: string;
  kind: OutreachAccountKind;
  title: string;
  blurb: string;
  /** Connected identity (email / handle) when known. */
  account: string | null;
  connected: boolean;
  /** Where to finish setup — Settings deep-link. */
  setupHref: string;
  setupLabel: string;
}

function hasValidKey(apiKeys: ApiKey[], provider: string): boolean {
  return apiKeys.some((k) => k.provider === provider && k.status === "valid");
}

function integrationConnected(integrations: IntegrationStatus[], id: string): boolean {
  const integ = integrations.find((i) => i.id === id);
  if (!integ || !integ.real) return false;
  if (integ.status !== "connected" && integ.status !== "degraded") return false;
  return integ.mode === "live" || Boolean(integ.connectedAccount?.trim());
}

/**
 * Build the operator checklist of accounts needed to source + send.
 * Order: send-from mailboxes first, then LinkedIn, then sourcing providers.
 */
export function buildOutreachAccountSlots(input: {
  seats: AgentSeat[];
  integrations: IntegrationStatus[];
  apiKeys: ApiKey[];
}): OutreachAccountSlot[] {
  const mailboxes = listConnectedMailboxes(input.seats, input.integrations);
  const linkedIn = listConnectedLinkedInProviders(input.seats, input.integrations);

  const outlookLive = mailboxes.find(
    (m) => /microsoft|outlook|graph/i.test(m.label),
  );
  const gmailLive = mailboxes.find((m) => /gmail/i.test(m.label));
  const otherMail = mailboxes.filter(
    (m) => m !== outlookLive && m !== gmailLive,
  );

  const slots: OutreachAccountSlot[] = [
    {
      id: "outlook",
      kind: "send",
      title: "Outlook / Microsoft 365",
      blurb: "Sends approved emails from your work mailbox and books Teams interviews.",
      account: outlookLive?.detail ?? null,
      connected: Boolean(outlookLive),
      setupHref: "/settings?tab=integrations#email-connections-panel",
      setupLabel: outlookLive ? "Manage" : "Connect Outlook",
    },
    {
      id: "gmail",
      kind: "send",
      title: "Gmail",
      blurb: "Optional alternate mailbox for send + read.",
      account: gmailLive?.detail ?? null,
      connected: Boolean(gmailLive),
      setupHref: "/settings?tab=integrations#email-connections-panel",
      setupLabel: gmailLive ? "Manage" : "Connect Gmail",
    },
  ];

  for (const m of otherMail) {
    slots.push({
      id: `mail-${m.label}`,
      kind: "send",
      title: m.label,
      blurb: "API mailbox for outbound email.",
      account: m.detail,
      connected: true,
      setupHref: "/settings?tab=integrations#email-connections-panel",
      setupLabel: "Manage",
    });
  }

  const liAccount = linkedIn[0]?.detail ?? null;
  const liConnected =
    linkedIn.length > 0 ||
    integrationConnected(input.integrations, "int_heyreach") ||
    integrationConnected(input.integrations, "int_linkedin_rsc");

  slots.push({
    id: "linkedin",
    kind: "linkedin",
    title: "LinkedIn",
    blurb: "Sign in to draft LinkedIn messages (paste-send) or connect HeyReach for sequences.",
    account: liAccount,
    connected: liConnected,
    setupHref: "/settings?tab=integrations#linkedin-outreach-stack",
    setupLabel: liConnected ? "Manage" : "Connect LinkedIn",
  });

  const apifyOk =
    hasValidKey(input.apiKeys, "Apify") ||
    integrationConnected(input.integrations, "int_apify");
  slots.push({
    id: "apify-linkedin",
    kind: "source",
    title: "LinkedIn profile search",
    blurb: "Find public LinkedIn profiles for a role (Apify key — no LinkedIn password).",
    account: apifyOk ? "API key on file" : null,
    connected: apifyOk,
    setupHref: "/settings?tab=access",
    setupLabel: apifyOk ? "Manage key" : "Add Apify key",
  });

  const githubOk = integrationConnected(input.integrations, "int_github");
  slots.push({
    id: "github",
    kind: "source",
    title: "GitHub",
    blurb: "Source engineers from public GitHub profiles and repos.",
    account: githubOk ? "Connected" : null,
    connected: githubOk,
    setupHref: "/settings?tab=integrations#integrations-catalog",
    setupLabel: githubOk ? "Manage" : "Open Integrations",
  });

  const tavilyOk = hasValidKey(input.apiKeys, "Tavily");
  slots.push({
    id: "tavily",
    kind: "source",
    title: "Web research (Tavily)",
    blurb: "Optional — enrich sourcing queries with live web search.",
    account: tavilyOk ? "API key on file" : null,
    connected: tavilyOk,
    setupHref: "/settings?tab=access",
    setupLabel: tavilyOk ? "Manage key" : "Add Tavily key",
  });

  const heyreachKey = hasValidKey(input.apiKeys, "HeyReach");
  if (heyreachKey || integrationConnected(input.integrations, "int_heyreach")) {
    slots.push({
      id: "heyreach",
      kind: "linkedin",
      title: "HeyReach",
      blurb: "LinkedIn outreach sequences via HeyReach MCP.",
      account: heyreachKey ? "API key on file" : "Connected",
      connected: true,
      setupHref: "/settings?tab=integrations#linkedin-outreach-stack",
      setupLabel: "Manage",
    });
  }

  return slots;
}

/** One-line operator summary for the queue sidebar. */
export function outreachSendFromSummary(slots: OutreachAccountSlot[]): {
  liveReady: boolean;
  line: string;
} {
  const send = slots.filter((s) => s.kind === "send" && s.connected);
  if (send.length === 0) {
    return {
      liveReady: false,
      line: "No mailbox connected — emails stay in dry-run until you connect Outlook or Gmail.",
    };
  }
  const primary = send[0];
  return {
    liveReady: true,
    line: `Sending as ${primary.account ?? primary.title} via ${primary.title}.`,
  };
}
