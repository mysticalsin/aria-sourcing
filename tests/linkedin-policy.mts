/* ============================================================================
   tests/linkedin-policy.mts
   Area: LinkedIn policy — ensures skills / prompts cannot bypass the
   assisted-manual rule or instruct LinkedIn session automation.
   ========================================================================== */

import { readFileSync } from "fs";
import * as linkedInPolicy from "../src/lib/linkedin-policy";

const { checkLinkedInPolicy } = linkedInPolicy;
type OutboundPolicy = { ok: boolean; reason?: string };
const getOutboundChannelPolicy = (linkedInPolicy as unknown as {
  getOutboundChannelPolicy?: (
    channel: string,
    opts?: { heyReachConfigured?: boolean; linkedInVendorConfigured?: boolean },
  ) => OutboundPolicy;
}).getOutboundChannelPolicy;

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("empty text is allowed", checkLinkedInPolicy("").ok === true);
ok("normal outreach copy is allowed", checkLinkedInPolicy("Hi Jane, loved your recent Go post.").ok === true);

const forbidden = [
  "automate linkedin outreach",
  "scrape LinkedIn profiles",
  "login to LinkedIn with credentials",
  "use puppeteer to message people on LinkedIn",
  "send bulk linkedin messages",
  "bypass LinkedIn rate limit",
  "LinkedIn recruiter automation",
  "use a headless browser for LinkedIn",
];
for (const text of forbidden) {
  const res = checkLinkedInPolicy(text);
  ok(`blocks: "${text}"`, res.ok === false && res.matched != null);
}

ok("allows official RSC wording", checkLinkedInPolicy("Use LinkedIn Recruiter System Connect API").ok === true);
ok("allows assisted-manual wording", checkLinkedInPolicy("Operator copies the LinkedIn message and pastes it manually").ok === true);

ok("outbound policy exposes a delivery decision", typeof getOutboundChannelPolicy === "function");
if (getOutboundChannelPolicy) {
  const linkedInDelivery = getOutboundChannelPolicy("LinkedIn");
  ok("LinkedIn without vendor/HeyReach is rejected", linkedInDelivery.ok === false);
  ok("LinkedIn rejection mentions manual or HeyReach", /manual|HeyReach/i.test(linkedInDelivery.reason ?? ""));
  ok(
    "LinkedIn allowed when HeyReach configured",
    getOutboundChannelPolicy("LinkedIn", { heyReachConfigured: true }).ok === true,
  );
  ok(
    "LinkedIn allowed when vendor configured",
    getOutboundChannelPolicy("LinkedIn", { linkedInVendorConfigured: true }).ok === true,
  );
  ok("Email delivery is not rejected by the LinkedIn policy", getOutboundChannelPolicy("Email").ok === true);
}

const sendRoute = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
ok("outreach route imports outbound channel policy", /getOutboundChannelPolicy/.test(sendRoute));
ok(
  "outreach route returns manual-required when policy blocks LinkedIn",
  /getOutboundChannelPolicy\([\s\S]*status:\s*"manual-required"/.test(sendRoute),
);
ok("outreach route wires HeyReach readiness into policy", /heyReachDeliveryReadyFromEnv/.test(sendRoute));

console.log(`RESULT linkedin-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
