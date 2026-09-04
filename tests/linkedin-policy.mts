/* ============================================================================
   tests/linkedin-policy.mts
   Area: LinkedIn policy — scrape/session bots blocked; outbound delivery
   respects workspace deliveryMode (automatic default, manual → 409).
   ========================================================================== */

import { readFileSync } from "fs";
import * as linkedInPolicy from "../src/lib/linkedin-policy";

const { checkLinkedInPolicy, resolveLinkedInDeliveryMode } = linkedInPolicy;
type OutboundPolicy = { ok: boolean; reason?: string };
const getOutboundChannelPolicy = (linkedInPolicy as unknown as {
  getOutboundChannelPolicy?: (
    channel: string,
    opts?: { deliveryMode?: string },
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
ok("allows automatic vendor wording", checkLinkedInPolicy("Queue LinkedIn via the entitled vendor API seat").ok === true);

ok("resolve defaults to automatic", resolveLinkedInDeliveryMode(undefined) === "automatic");
ok("resolve accepts manual", resolveLinkedInDeliveryMode("manual") === "manual");
ok("resolve rejects unknown as automatic", resolveLinkedInDeliveryMode("weird") === "automatic");

ok("outbound policy exposes a delivery decision", typeof getOutboundChannelPolicy === "function");
if (getOutboundChannelPolicy) {
  const auto = getOutboundChannelPolicy("LinkedIn", { deliveryMode: "automatic" });
  ok("LinkedIn automatic delivery is allowed", auto.ok === true);
  const defaultMode = getOutboundChannelPolicy("LinkedIn");
  ok("LinkedIn default (no opts) is automatic-allowed", defaultMode.ok === true);
  const manual = getOutboundChannelPolicy("LinkedIn", { deliveryMode: "manual" });
  ok("LinkedIn manual delivery is rejected", manual.ok === false);
  ok("LinkedIn manual rejection mentions Manual", /manual/i.test(manual.reason ?? ""));
  ok("Email delivery is not rejected by the LinkedIn policy", getOutboundChannelPolicy("Email").ok === true);
}

const sendRoute = readFileSync(new URL("../src/app/api/outreach/send/route.ts", import.meta.url), "utf8");
ok("outreach route imports outbound channel policy", /getOutboundChannelPolicy/.test(sendRoute));
ok("outreach route resolves deliveryMode", /resolveLinkedInDeliveryMode/.test(sendRoute));
ok(
  "outreach route returns manual-required when policy blocks LinkedIn",
  /getOutboundChannelPolicy\([\s\S]*status:\s*"manual-required"/.test(sendRoute),
);
ok("outreach route enqueues LinkedIn automatic", /enqueue_linkedin_outbound/.test(sendRoute));
ok("outreach route refuses assisted-manual fallback for automatic", /linkedin-automatic-requires-vendor|LinkedIn Vendor API/.test(sendRoute));

const migration = readFileSync(
  new URL("../supabase/migrations/0062_linkedin_automatic_enqueue.sql", import.meta.url),
  "utf8",
);
ok("migration 0062 enqueue_linkedin_outbound", /enqueue_linkedin_outbound/.test(migration));
ok("migration 0062 vendor automatic", /LinkedIn Vendor API/.test(migration));
const migration63 = readFileSync(new URL("../supabase/migrations/0063_contact_lease_and_browser_computer.sql", import.meta.url), "utf8");
ok("migration 0063 browser-computer automatic", /LinkedIn Browser Computer/.test(migration63));
ok("migration 0063 claim_contact", /claim_contact/.test(migration63));

console.log(`RESULT linkedin-policy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
