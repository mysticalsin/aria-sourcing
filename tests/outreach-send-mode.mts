/**
 * Outreach send-mode honesty: force Dry-run when no mailbox is connected,
 * and surface Record legitimate interest when a draft exists.
 */
import { readFileSync } from "node:fs";
import {
  effectiveDryRunMode,
  hasConnectedMailbox,
  hasConnectedOutboundProvider,
  listConnectedMailboxes,
  listConnectedOutboundProviders,
  planOutreachApprovalDelivery,
  isLiveMailboxSeat,
} from "../src/lib/outreach-send-mode";
import { generateOutreach } from "../src/lib/mock-ai";
import { buildHistoricalDemoSeedState, buildSeedState } from "../src/lib/seed";
import { defaultIntegrations } from "../src/lib/integrations";
import type { AgentSeat, IntegrationStatus } from "../src/lib/types";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const emptySeats: AgentSeat[] = [];
const bareIntegrations = defaultIntegrations();

ok(
  "no mailbox → effectiveDryRunMode true even when setting is Live",
  effectiveDryRunMode(false, emptySeats, bareIntegrations) === true,
);
ok(
  "no mailbox → hasConnectedMailbox false",
  hasConnectedMailbox(emptySeats, bareIntegrations) === false,
);
ok(
  "no mailbox → hasConnectedOutboundProvider false",
  hasConnectedOutboundProvider(emptySeats, bareIntegrations) === false,
);
ok(
  "Queue Summary must label Dry-run (no providers)",
  listConnectedOutboundProviders(emptySeats, bareIntegrations).length === 0,
);
ok(
  "Queue Summary mailboxes empty without Outlook",
  listConnectedMailboxes(emptySeats, bareIntegrations).length === 0,
);

{
  const dryEmail = planOutreachApprovalDelivery({ channel: "Email", forceDryRun: true });
  ok("dry-run Email → Approved", dryEmail.finalStatus === "Approved");
  ok("dry-run Email → ledger claimed (not sent)", dryEmail.finalLedgerStatus === "claimed");
  ok("dry-run Email → no simulated send stamp", dryEmail.stampSimulatedSend === false);

  const liveEmail = planOutreachApprovalDelivery({ channel: "Email", forceDryRun: false });
  ok("live Email → Approved pending send", liveEmail.finalStatus === "Approved");
  ok("live Email → ledger claimed", liveEmail.finalLedgerStatus === "claimed");
  ok("live Email → no approve-time send stamp", liveEmail.stampSimulatedSend === false);

  const liveLi = planOutreachApprovalDelivery({ channel: "LinkedIn", forceDryRun: false });
  ok("live LinkedIn → Pending Manual Send", liveLi.finalStatus === "Pending Manual Send");
  ok("live LinkedIn → pending_manual ledger", liveLi.finalLedgerStatus === "pending_manual");

  const liveLiQueue = planOutreachApprovalDelivery({
    channel: "LinkedIn",
    forceDryRun: false,
    linkedInCanQueue: true,
  });
  ok("live LinkedIn + queue seat → Approved", liveLiQueue.finalStatus === "Approved");
  ok("live LinkedIn + queue seat → not manual", liveLiQueue.isLinkedInManual === false);

  const dryLi = planOutreachApprovalDelivery({ channel: "LinkedIn", forceDryRun: true });
  ok("dry-run LinkedIn → Pending Manual Send (not Approved)", dryLi.finalStatus === "Pending Manual Send");
  ok("dry-run LinkedIn → pending_manual ledger", dryLi.finalLedgerStatus === "pending_manual");
  ok("dry-run LinkedIn → no simulated send stamp", dryLi.stampSimulatedSend === false);
  ok("dry-run LinkedIn isLinkedInManual", dryLi.isLinkedInManual === true);
}

{
  const graphLive: AgentSeat = {
    ...buildSeedState().seats[0]!,
    provider: "Microsoft Graph",
    mode: "live",
    status: "active",
  };
  const linkedInLive: AgentSeat = {
    ...graphLive,
    provider: "LinkedIn Assisted Manual",
  };
  ok("Graph live seat is mailbox-send eligible", isLiveMailboxSeat(graphLive) === true);
  ok("LinkedIn live seat is NOT mailbox-send eligible", isLiveMailboxSeat(linkedInLive) === false);
}

{
  const sendRoute = readFileSync("src/app/api/outreach/send/route.ts", "utf8");
  ok(
    "Email send route rejects non-mailbox seats via isMailboxSeatProvider",
    /isMailboxSeatProvider/.test(sendRoute)
      && /Selected seat cannot send Email/.test(sendRoute),
  );
}

{
  // Status-only Outlook "connected" without connectedAccount must NOT claim Live.
  const fakeConnected: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_outlook"
      ? { ...i, status: "connected", mode: "live", connectedAccount: undefined }
      : i,
  );
  ok(
    "Outlook status=connected without account → still Dry-run",
    effectiveDryRunMode(false, emptySeats, fakeConnected) === true,
  );
  ok(
    "Outlook status=connected without account → zero providers",
    listConnectedOutboundProviders(emptySeats, fakeConnected).length === 0,
  );
}

{
  // SendGrid/Resend paste (status connected, mode=mock) must not unlock Live.
  const sendgridMock: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_sendgrid"
      ? { ...i, status: "connected", mode: "mock", connectedAccount: "sg@example.test" }
      : i,
  );
  ok(
    "SendGrid connectedAccount + mode=mock → still Dry-run",
    effectiveDryRunMode(false, emptySeats, sendgridMock) === true,
  );
  ok(
    "SendGrid connectedAccount + mode=mock → hasConnectedMailbox false",
    hasConnectedMailbox(emptySeats, sendgridMock) === false,
  );
  const sendgridLive: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_sendgrid"
      ? { ...i, status: "connected", mode: "live", connectedAccount: "sg@example.test" }
      : i,
  );
  ok(
    "SendGrid mode=live + account → Live allowed",
    effectiveDryRunMode(false, emptySeats, sendgridLive) === false
      && hasConnectedMailbox(emptySeats, sendgridLive) === true,
  );
}

{
  // Operator-typed Outlook account without mode=live must not unlock Live.
  const mockModeAccount: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_outlook"
      ? { ...i, status: "connected", mode: "mock", connectedAccount: "twalteur@amaris.com" }
      : i,
  );
  ok(
    "Outlook connectedAccount + mode=mock → still Dry-run",
    effectiveDryRunMode(false, emptySeats, mockModeAccount) === true,
  );
  ok(
    "Outlook connectedAccount + mode=mock → hasConnectedMailbox false",
    hasConnectedMailbox(emptySeats, mockModeAccount) === false,
  );
}

{
  const withAccount: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_outlook"
      ? { ...i, status: "connected", mode: "live", connectedAccount: "twalteur@amaris.com" }
      : i,
  );
  ok(
    "Outlook with connectedAccount → may leave Dry-run when setting is Live",
    effectiveDryRunMode(false, emptySeats, withAccount) === false,
  );
  ok(
    "Outlook with connectedAccount → hasConnectedMailbox true",
    hasConnectedMailbox(emptySeats, withAccount) === true,
  );
}

{
  // Live smoke regression: HeyReach MCP Live + connectedAccount, Outlook disconnected
  // must still force Dry-run in Queue Summary (no red Live pill).
  const heyReachLive: IntegrationStatus[] = bareIntegrations.map((i) => {
    if (i.id === "int_heyreach") {
      return {
        ...i,
        status: "connected",
        mode: "live",
        connectedAccount: "HeyReach MCP",
      };
    }
    if (i.id === "int_outlook") {
      return { ...i, status: "not_configured", mode: "mock", connectedAccount: undefined };
    }
    return i;
  });
  ok(
    "HeyReach live + no mailbox → still Dry-run",
    effectiveDryRunMode(false, emptySeats, heyReachLive) === true,
  );
  ok(
    "HeyReach live + no mailbox → hasConnectedMailbox false",
    hasConnectedMailbox(emptySeats, heyReachLive) === false,
  );
  ok(
    "HeyReach live alone is listed as linkedin tooling, not mailbox",
    listConnectedOutboundProviders(emptySeats, heyReachLive).every((p) => p.kind === "linkedin") &&
      listConnectedMailboxes(emptySeats, heyReachLive).length === 0,
  );
}

{
  // LinkedIn assisted-manual seat live without mailbox must not unlock Live.
  const liSeat: AgentSeat = {
    ...buildSeedState().seats[0]!,
    provider: "LinkedIn Assisted Manual",
    connectedAccount: "operator@linkedin",
    mode: "live",
    status: "active",
  };
  ok(
    "LinkedIn live seat + no mailbox → still Dry-run",
    effectiveDryRunMode(false, [liSeat], bareIntegrations) === true,
  );
  ok(
    "LinkedIn live seat → hasConnectedOutboundProvider true but no mailbox",
    hasConnectedOutboundProvider([liSeat], bareIntegrations) === true &&
      hasConnectedMailbox([liSeat], bareIntegrations) === false,
  );
}

{
  const seat: AgentSeat = {
    ...buildSeedState().seats[0]!,
    connectedAccount: "",
    mode: "live",
    status: "active",
    provider: "Microsoft Graph",
  };
  ok(
    "mailbox seat mode=live but empty connectedAccount → Dry-run",
    effectiveDryRunMode(false, [seat], bareIntegrations) === true,
  );
  seat.connectedAccount = "recruiter@amaris.com";
  ok(
    "mailbox seat with connectedAccount → Live allowed when setting off",
    effectiveDryRunMode(false, [seat], bareIntegrations) === false,
  );
  seat.mode = "mock";
  ok(
    "Graph seat with label but mode=mock → Dry-run (manual connect is not OAuth)",
    effectiveDryRunMode(false, [seat], bareIntegrations) === true &&
      hasConnectedMailbox([seat], bareIntegrations) === false,
  );
  const sgSeat: AgentSeat = {
    ...seat,
    provider: "SendGrid",
    connectedAccount: "sg@example.test",
    mode: "mock",
  };
  ok(
    "SendGrid seat mode=mock + account → still Dry-run",
    effectiveDryRunMode(false, [sgSeat], bareIntegrations) === true &&
      hasConnectedMailbox([sgSeat], bareIntegrations) === false,
  );
}

{
  // Generate a real draft (no live send) and prove UI surfaces legitimate interest.
  const seed = buildHistoricalDemoSeedState();
  const campaign = seed.campaigns[0]!;
  const candidate = seed.candidates.find((c) => c.campaignId === campaign.id) ?? seed.candidates[0]!;
  const draft = generateOutreach(candidate, campaign, "Casual Professional", "Email", 1);
  ok("generateOutreach produces a draft body", Boolean(draft.body?.trim()));
  ok("generateOutreach produces a subject", Boolean(draft.subject?.trim()));
  // Store attaches status=Pending Approval on enqueue; generator returns the draft payload.

  const outreachPage = readFileSync("src/app/outreach/page.tsx", "utf8");
  const card = readFileSync("src/components/outreach/outreach-message-card.tsx", "utf8");
  ok(
    "Queue Summary Send mode uses effectiveDryRunMode (not raw dryRunMode)",
    /effectiveDryRunMode\(settings\.dryRunMode,\s*seats,\s*integrations\)/.test(outreachPage) &&
      /previewOnly \? "Dry-run \/ preview" : "Live"/.test(outreachPage),
  );
  ok(
    "Queue Summary mailbox gate uses listConnectedMailboxes",
    /listConnectedMailboxes\(seats,\s*integrations\)/.test(outreachPage) &&
      /No mailbox connected/.test(outreachPage),
  );
  ok(
    "approval card shows Record legitimate interest when draft needs basis",
    /Record legitimate interest/.test(card) && /Record legitimate interest/.test(outreachPage),
  );
  ok(
    "draft + missing basis path is gated on Pending Approval actionable card",
    /missingLawfulBasis|showBasisPrompt/.test(card) && /Record legitimate interest/.test(card),
  );
  ok(
    "approval card mailbox copy visible when draft actionable",
    /No mailbox connected/.test(card) && /listConnectedMailboxes/.test(card),
  );
}

console.log(`RESULT outreach-send-mode: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
