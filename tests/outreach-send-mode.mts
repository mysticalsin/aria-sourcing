/**
 * Outreach send-mode honesty: force Dry-run when no mailbox is connected,
 * and surface Record legitimate interest when a draft exists.
 */
import { readFileSync } from "node:fs";
import {
  effectiveDryRunMode,
  hasConnectedOutboundProvider,
  listConnectedOutboundProviders,
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
  "no mailbox → hasConnectedOutboundProvider false",
  hasConnectedOutboundProvider(emptySeats, bareIntegrations) === false,
);
ok(
  "Queue Summary must label Dry-run (no providers)",
  listConnectedOutboundProviders(emptySeats, bareIntegrations).length === 0,
);

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
  const withAccount: IntegrationStatus[] = bareIntegrations.map((i) =>
    i.id === "int_outlook"
      ? { ...i, status: "connected", mode: "live", connectedAccount: "twalteur@amaris.com" }
      : i,
  );
  ok(
    "Outlook with connectedAccount → may leave Dry-run when setting is Live",
    effectiveDryRunMode(false, emptySeats, withAccount) === false,
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
    "approval card shows Record legitimate interest when draft needs basis",
    /Record legitimate interest/.test(card) && /Record legitimate interest/.test(outreachPage),
  );
  ok(
    "draft + missing basis path is gated on Pending Approval actionable card",
    /missingLawfulBasis|showBasisPrompt/.test(card) && /Record legitimate interest/.test(card),
  );
}

console.log(`RESULT outreach-send-mode: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
