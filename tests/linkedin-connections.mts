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
ok("default assisted name", defaultLinkedInSeatName("LinkedIn Assisted Manual").includes("manual"));

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
    /session bots|PhantomBuster/i.test(linkedInGuardrailPrompt()),
);
ok(
  "guardrail prompt mentions Automatic default",
  /defaults to Automatic/i.test(linkedInGuardrailPrompt()),
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
ok("linkedin webhook multi-event", /record_linkedin_channel_event/.test(webhook));

const connections = readFileSync("src/app/api/linkedin/connections/route.ts", "utf8");
ok("connections ensure_connect", /ensure_connect/.test(connections));
ok("refuse LinkedIn login automation", !/puppeteer|playwright|cookie jar/i.test(connections));

const confirm = readFileSync("src/app/api/outreach/confirm-manual/route.ts", "utf8");
ok("confirm-manual uses assisted RPC", /record_linkedin_assisted_manual_send/.test(confirm));

const panel = readFileSync("src/components/settings/linkedin-connections-panel.tsx", "utf8");
ok("settings panel Sign in with LinkedIn", /Sign in with LinkedIn/.test(panel));
ok("settings panel refuses password storage", /never your password/i.test(panel));
ok("settings panel OIDC ensure_oauth", /ensure_oauth/.test(panel));
ok("demo seats not wiped by empty API seats array", /json\?\.demo \|\| !supabaseEnabled/.test(panel));
ok("simulate skips non-UUID demo seat ids", /uuidSeat/.test(panel));

const store = readFileSync("src/lib/store.ts", "utf8");
ok("toggleSeatLive skips mailbox for LinkedIn", /LinkedIn Assisted Manual/.test(store) && /no mailbox SPF required/i.test(store));
ok("confirmManualSend calls confirm-manual API", /\/api\/outreach\/confirm-manual/.test(store));
ok("draft injects linkedInGuardrailPrompt", /linkedInGuardrailPrompt\(\)/.test(store));

const sendOnly = readFileSync("docs/LINKEDIN_SEND_ONLY.md", "utf8");
ok("docs mention OIDC", /openid connect/i.test(sendOnly));
ok("docs refuse password\/cookie capture", /password|cookie|session/i.test(sendOnly));
ok("docs default automatic", /defaults to \*\*Automatic\*\*|Automatic outreach/i.test(sendOnly));
ok("docs manual optional", /Manual approve-and-send|deliveryMode/i.test(sendOnly));

const enqueueMigration = existsSync("supabase/migrations/0062_linkedin_automatic_enqueue.sql")
  ? readFileSync("supabase/migrations/0062_linkedin_automatic_enqueue.sql", "utf8")
  : "";
ok("migration 0062 exists", enqueueMigration.length > 0);
ok("0062 enqueue_linkedin_outbound", /enqueue_linkedin_outbound/.test(enqueueMigration));

const stack = readFileSync("src/components/settings/linkedin-outreach-stack.tsx", "utf8");
ok("settings stack Automatic outreach label", /Automatic outreach/.test(stack));
ok("settings stack Manual approve-and-send label", /Manual approve-and-send/.test(stack));
ok("settings stack writes deliveryMode", /deliveryMode/.test(stack));
ok(
  "settings stack Ready requires every LI desk healthy (not .some 1/N)",
  /browserSeats\.every\(\(s\) => s\.sessionHealthy === true\)/.test(stack) &&
    /browserSeats\.every\(/.test(stack) &&
    !/browserSeats\.some\(\(s\) => s\.sessionHealthy === true\)/.test(stack),
);

const oauthMigration = existsSync("supabase/migrations/0061_linkedin_oauth_connections.sql")
  ? readFileSync("supabase/migrations/0061_linkedin_oauth_connections.sql", "utf8")
  : "";
ok("migration 0061 exists", oauthMigration.length > 0);
ok("0061 linkedin_oauth_connections table", /linkedin_oauth_connections/.test(oauthMigration));

const oauthRoute = readFileSync("src/app/auth/linkedin/route.ts", "utf8");
ok("auth linkedin start route", /LINKEDIN_AUTHORIZE_URL|oauth\/v2\/authorization/.test(oauthRoute));
const oauthCb = readFileSync("src/app/auth/linkedin/callback/route.ts", "utf8");
ok("auth linkedin callback userinfo", /LINKEDIN_USERINFO_URL|userinfo/.test(oauthCb));
ok("auth linkedin encrypts tokens", /encryptSecret/.test(oauthCb));


ok("settings stack plug-and-play 2-step title", /Connect AriaBot in 2 steps/.test(stack));
ok(
  "settings panel primary CTA Open LinkedIn login for agents",
  /Open LinkedIn login for agents/.test(panel),
);

const setupGuide = readFileSync("src/components/settings/setup-guide-panel.tsx", "utf8");
ok("setup guide deep-links AriaBot stack", /linkedin-outreach-stack/.test(setupGuide));
ok("setup guide Connect AriaBot Browser Computer step", /Connect AriaBot Browser Computer/.test(setupGuide));
ok(
  "setup guide attach requires assignedCampaignIds.includes (not empty=attached)",
  /\.includes\(campaign!\.id\)/.test(setupGuide) &&
    /empty assignedCampaignIds is NOT attached/.test(setupGuide) &&
    !/assigned\.length === 0 \|\| assigned\.includes/.test(setupGuide),
);
ok(
  "setup guide take-control done requires attach + fleet sessionHealthy",
  /done: attachedOk && liSessionHealthy/.test(setupGuide) &&
    /sessionHealthy === true/.test(setupGuide) &&
    // All attached desks — not .some() 1/N theater.
    /attachedSeatIds\.size > 0/.test(setupGuide) &&
    /\[\.\.\.attachedSeatIds\]\.every/.test(setupGuide) &&
    /c\.seatId\.trim\(\) === seatId/.test(setupGuide) &&
    // Soft-nav: effect keys on campaignId (from campaign?.id), not campaign.id inline.
    /campaignId=\$\{encodeURIComponent\(campaignId\)\}/.test(setupGuide) &&
    /Array\.isArray\(data\.campaignSeats\)/.test(setupGuide),
);
ok(
  "setup guide ingests durable browserSeatBindings",
  /ingestDurableBrowserBindings/.test(setupGuide),
);
ok(
  "setup guide never classifies Browser Computer via computerId alone",
  /from "@\/lib\/campaign-seat-attach"/.test(setupGuide) &&
    /isBrowserComputerSeat/.test(setupGuide) &&
    !/Boolean\(seat\.computerId\)/.test(setupGuide) &&
    !/computerId/.test(
      readFileSync("src/lib/campaign-seat-attach.ts", "utf8").match(
        /export function isBrowserComputerSeat[\s\S]*?^\}/m,
      )?.[0] ?? "computerId",
    ),
);

const liPanel = readFileSync("src/components/settings/linkedin-connections-panel.tsx", "utf8");
ok(
  "linkedin connections clears fleetComputers on fleet GET fail",
  /!fleetRes\.ok|else \{/.test(liPanel) &&
    /setFleetComputers\(\[\]\)/.test(liPanel) &&
    /HTTP fail: clear prior fleet paint/.test(liPanel),
);
ok(
  "linkedin login fleetAct passes campaignId when seat attached",
  /assignedCampaignIds \?\? \[\]\)\.find/.test(liPanel) &&
    /\.\.\.\(campaignId \? \{ campaignId \} : \{\}\)/.test(liPanel) &&
    /gateCampaignId \? \{ campaignId: gateCampaignId \}/.test(liPanel),
);
ok(
  "linkedin connections ingests durable browserSeatBindings",
  /ingestDurableBrowserBindings/.test(liPanel) &&
    /browserSeatBindings/.test(liPanel),
);

console.log(`RESULT linkedin-connections: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
