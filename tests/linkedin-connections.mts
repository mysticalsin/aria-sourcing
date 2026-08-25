import { existsSync, readFileSync } from "node:fs";
import {
  defaultLinkedInSeatName,
  isLinkedInSeatProvider,
  linkedInProviderReadiness,
  linkedInSeatCanGoLive,
  normalizeLinkedInProfileUrl,
  pickLinkedInSeat,
  summarizeLinkedInValidation,
} from "../src/lib/linkedin-connections";
import { linkedInGuardrailPrompt } from "../src/lib/linkedin-policy";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("assisted-manual always ready", linkedInProviderReadiness({}).assistedManual === true);
ok(
  "vendor dark without keys",
  linkedInProviderReadiness({}).vendorApiConfigured === false,
);
ok(
  "vendor configured with both keys",
  linkedInProviderReadiness({
    LINKEDIN_VENDOR_API_URL: "https://vendor.example/send",
    LINKEDIN_VENDOR_API_KEY: "k",
  }).vendorApiConfigured === true,
);
ok(
  "inbound secret from LINKEDIN_ or EMAIL_",
  linkedInProviderReadiness({ EMAIL_INBOUND_WEBHOOK_SECRET: "x" }).inboundWebhookSecret === true,
);

ok("is LinkedIn Assisted Manual", isLinkedInSeatProvider("LinkedIn Assisted Manual"));
ok("is LinkedIn Vendor API", isLinkedInSeatProvider("LinkedIn Vendor API"));
ok("not Gmail", !isLinkedInSeatProvider("Gmail API"));
ok("default assisted name", defaultLinkedInSeatName("LinkedIn Assisted Manual").includes("assisted"));

const seats = [
  { id: "1", name: "A", provider: "Gmail API", status: "active", mode: "mock" },
  { id: "2", name: "B", provider: "LinkedIn Assisted Manual", status: "active", mode: "mock" },
];
ok("pick assisted seat", pickLinkedInSeat(seats)?.id === "2");
ok("can go live without mailbox", linkedInSeatCanGoLive({ provider: "LinkedIn Assisted Manual", status: "active" }).ok);

ok(
  "normalize profile url",
  normalizeLinkedInProfileUrl("https://www.linkedin.com/in/Jane-Doe/") ===
    "https://www.linkedin.com/in/jane-doe",
);
ok("reject non-linkedin", normalizeLinkedInProfileUrl("https://example.com/in/x") === null);

const summary = summarizeLinkedInValidation([
  { id: "a", ok: true, detail: "ok" },
  { id: "b", ok: false, detail: "seat mock" },
]);
ok("summary fails", summary.ok === false && /seat mock/.test(summary.message));

ok(
  "guardrail prompt forbids login/scrape",
  /never attempt to log in/i.test(linkedInGuardrailPrompt()) &&
    /assisted-manual/i.test(linkedInGuardrailPrompt()),
);

const migration = existsSync("supabase/migrations/0058_linkedin_assisted_and_inbound.sql")
  ? readFileSync("supabase/migrations/0058_linkedin_assisted_and_inbound.sql", "utf8")
  : "";
ok("migration 0058 exists", migration.length > 0);
ok("0058 upsert_linkedin_inbound_route", /upsert_linkedin_inbound_route/i.test(migration));
ok("0058 record_linkedin_assisted_manual_send", /record_linkedin_assisted_manual_send/i.test(migration));
ok("0058 record_linkedin_inbound", /record_linkedin_inbound/i.test(migration));

const webhook = readFileSync("src/app/api/webhooks/linkedin/route.ts", "utf8");
ok("linkedin webhook exists", /resolve_linkedin_inbound_route/.test(webhook));
ok("linkedin webhook HMAC", /x-aria-signature/.test(webhook));

const connections = readFileSync("src/app/api/linkedin/connections/route.ts", "utf8");
ok("connections ensure_connect", /ensure_connect/.test(connections));
ok("refuse LinkedIn login automation", !/puppeteer|playwright|cookie jar/i.test(connections));

const confirm = readFileSync("src/app/api/outreach/confirm-manual/route.ts", "utf8");
ok("confirm-manual uses assisted RPC", /record_linkedin_assisted_manual_send/.test(confirm));

const panel = readFileSync("src/components/settings/linkedin-connections-panel.tsx", "utf8");
ok("settings panel Connect my LinkedIn", /Connect my LinkedIn/.test(panel));
ok("settings panel refuses password framing", /never logs into LinkedIn/i.test(panel));

const store = readFileSync("src/lib/store.ts", "utf8");
ok("toggleSeatLive skips mailbox for LinkedIn", /LinkedIn Assisted Manual/.test(store) && /no mailbox SPF required/i.test(store));
ok("confirmManualSend calls confirm-manual API", /\/api\/outreach\/confirm-manual/.test(store));
ok("draft injects linkedInGuardrailPrompt", /linkedInGuardrailPrompt\(\)/.test(store));

const sendOnly = readFileSync("docs/LINKEDIN_SEND_ONLY.md", "utf8");
ok("docs mention webhook path", /\/api\/webhooks\/linkedin/.test(sendOnly));

console.log(`RESULT linkedin-connections: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
