import assert from "node:assert/strict";
import { buildOutreachAccountSlots, outreachSendFromSummary } from "../src/lib/outreach-accounts";
import type { AgentSeat, ApiKey, IntegrationStatus } from "../src/lib/types";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    fail += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

check("buildOutreachAccountSlots marks Outlook when a live Graph seat exists", () => {
  const seats = [
    {
      id: "seat1",
      status: "active",
      mode: "live",
      provider: "Microsoft Graph",
      connectedAccount: "recruiter@amaris.com",
    },
  ] as unknown as AgentSeat[];
  const slots = buildOutreachAccountSlots({
    seats,
    integrations: [] as IntegrationStatus[],
    apiKeys: [] as ApiKey[],
  });
  const outlook = slots.find((s) => s.id === "outlook");
  assert.ok(outlook);
  assert.equal(outlook.connected, true);
  assert.equal(outlook.account, "recruiter@amaris.com");
  const summary = outreachSendFromSummary(slots);
  assert.equal(summary.liveReady, true);
  assert.match(summary.line, /recruiter@amaris.com/);
});

check("buildOutreachAccountSlots stays dry-run when no mailbox", () => {
  const slots = buildOutreachAccountSlots({
    seats: [] as AgentSeat[],
    integrations: [] as IntegrationStatus[],
    apiKeys: [{ id: "k1", provider: "Apify", status: "valid" } as ApiKey],
  });
  const outlook = slots.find((s) => s.id === "outlook");
  assert.equal(outlook?.connected, false);
  const apify = slots.find((s) => s.id === "apify-linkedin");
  assert.equal(apify?.connected, true);
  const summary = outreachSendFromSummary(slots);
  assert.equal(summary.liveReady, false);
});

console.log(`RESULT outreach-accounts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
