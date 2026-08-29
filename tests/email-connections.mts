import {
  connectionHealth,
  defaultSeatNameFor,
  emailProviderReadiness,
  isInboxPollAllowed,
  normalizeMailboxAddress,
  oauthAuthorizePath,
  oauthConfiguredFor,
  pickSeatForConnect,
  resolveMicrosoftOAuthAuthority,
  resolveMicrosoftTenantId,
  summarizeEmailValidation,
} from "../src/lib/email-connections";
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "gmail oauth requires both client id and secret",
  emailProviderReadiness({
    NODE_ENV: "test",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "sec",
  }).gmailOAuth === true,
);
ok(
  "gmail oauth incomplete without secret",
  emailProviderReadiness({ NODE_ENV: "test", GOOGLE_CLIENT_ID: "id" }).gmailOAuth === false,
);
ok(
  "microsoft oauth readiness requires redirect uri",
  emailProviderReadiness({
    NODE_ENV: "test",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "http://localhost:3000/auth/microsoft/callback",
  }).microsoftOAuth === true,
);
ok(
  "microsoft oauth incomplete without redirect uri",
  emailProviderReadiness({
    NODE_ENV: "test",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
  }).microsoftOAuth === false,
);
ok(
  "production microsoft oauth rejects localhost redirect",
  emailProviderReadiness({
    NODE_ENV: "production",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "http://localhost:3000/auth/microsoft/callback",
  }).microsoftOAuth === false,
);
ok(
  "production microsoft oauth incomplete without tenant (authorize would 500)",
  emailProviderReadiness({
    NODE_ENV: "production",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "https://aria-mantu-app.fly.dev/auth/microsoft/callback",
  }).microsoftOAuth === false,
);
ok(
  "production microsoft oauth accepts public https redirect + tenant",
  emailProviderReadiness({
    NODE_ENV: "production",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "https://aria-mantu-app.fly.dev/auth/microsoft/callback",
    MICROSOFT_TENANT_ID: "ce57ebe3-a63d-4708-b5cf-c274b48bd26c",
  }).microsoftOAuth === true,
);
ok(
  "production microsoft oauth rejects monotonous demo client_id UUID",
  emailProviderReadiness({
    NODE_ENV: "production",
    MICROSOFT_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "https://aria-mantu-app.fly.dev/auth/microsoft/callback",
    MICROSOFT_TENANT_ID: "ce57ebe3-a63d-4708-b5cf-c274b48bd26c",
  }).microsoftOAuth === false,
);
ok(
  "production microsoft oauth accepts tenant derived from GOTRUE_EXTERNAL_AZURE_URL",
  emailProviderReadiness({
    NODE_ENV: "production",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
    MICROSOFT_REDIRECT_URI: "https://aria-mantu-app.fly.dev/auth/microsoft/callback",
    GOTRUE_EXTERNAL_AZURE_URL:
      "https://login.microsoftonline.com/ce57ebe3-a63d-4708-b5cf-c274b48bd26c/v2.0",
  }).microsoftOAuth === true,
);
ok(
  "resolveMicrosoftTenantId prefers MICROSOFT_TENANT_ID",
  resolveMicrosoftTenantId({
    MICROSOFT_TENANT_ID: "864aa37f-ea3f-4c0f-998f-457b1a268762",
    GOTRUE_EXTERNAL_AZURE_URL: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
  }) === "864aa37f-ea3f-4c0f-998f-457b1a268762",
);
ok(
  "resolveMicrosoftTenantId parses GOTRUE_EXTERNAL_AZURE_URL",
  resolveMicrosoftTenantId({
    GOTRUE_EXTERNAL_AZURE_URL: "https://login.microsoftonline.com/ce57ebe3-a63d-4708-b5cf-c274b48bd26c/v2.0",
  }) === "ce57ebe3-a63d-4708-b5cf-c274b48bd26c",
);
ok(
  "production resolveMicrosoftOAuthAuthority fail-closed without tenant",
  resolveMicrosoftOAuthAuthority({ NODE_ENV: "production" }) === null,
);
ok(
  "production resolveMicrosoftOAuthAuthority uses tenant path (not /common/)",
  resolveMicrosoftOAuthAuthority({
    NODE_ENV: "production",
    MICROSOFT_TENANT_ID: "864aa37f-ea3f-4c0f-998f-457b1a268762",
  }) === "https://login.microsoftonline.com/864aa37f-ea3f-4c0f-998f-457b1a268762/oauth2/v2.0",
);
ok(
  "non-prod resolveMicrosoftOAuthAuthority falls back to organizations (not common)",
  resolveMicrosoftOAuthAuthority({ NODE_ENV: "test" }) ===
    "https://login.microsoftonline.com/organizations/oauth2/v2.0",
);
ok(
  "Microsoft authorize route uses tenant authority helper (no hardcoded /common/)",
  !readFileSync("src/app/auth/microsoft/route.ts", "utf8").includes("/common/oauth2")
    && readFileSync("src/app/auth/microsoft/route.ts", "utf8").includes("resolveMicrosoftOAuthAuthority"),
);
ok(
  "Microsoft callback + refresh use tenant authority helper (no hardcoded /common/)",
  !readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8").includes("/common/oauth2")
    && !readFileSync("src/lib/email-oauth.ts", "utf8").includes("/common/oauth2"),
);
ok(
  "production encryption requires key",
  emailProviderReadiness({ NODE_ENV: "production" }).encryptionReady === false,
);
ok(
  "production encryption ok with key",
  emailProviderReadiness({
    NODE_ENV: "production",
    DATA_ENCRYPTION_KEY: "abc",
  }).encryptionReady === true,
);
ok(
  "inbound webhook secret boolean",
  emailProviderReadiness({ NODE_ENV: "test", EMAIL_INBOUND_WEBHOOK_SECRET: "x" })
    .inboundWebhookSecret === true,
);
ok(
  "inbox poll off by default",
  isInboxPollAllowed({}) === false
    && emailProviderReadiness({ NODE_ENV: "test" }).inboxPollAllowed === false,
);
ok(
  "inbox poll only when ARIA_ALLOW_INBOX_SYNC=1",
  isInboxPollAllowed({ ARIA_ALLOW_INBOX_SYNC: "1" }) === true
    && isInboxPollAllowed({ ARIA_ALLOW_INBOX_SYNC: "true" }) === false,
);

ok("gmail authorize path", oauthAuthorizePath("Gmail API") === "/auth/google");
ok("outlook authorize path", oauthAuthorizePath("Microsoft Graph") === "/auth/microsoft");
ok(
  "oauthConfiguredFor gmail",
  oauthConfiguredFor("Gmail API", {
    gmailOAuth: true,
    microsoftOAuth: false,
    sendgridApiKey: false,
    resendApiKey: false,
    encryptionReady: true,
    inboundWebhookSecret: false,
    inboxPollAllowed: false,
  }),
);

const seats = [
  { id: "1", name: "A", provider: "Gmail API", connectedAccount: "a@x.com" },
  { id: "2", name: "B", provider: "Gmail API", connectedAccount: "" },
  { id: "3", name: "C", provider: "Microsoft Graph", connectedAccount: null },
];
ok("pick free gmail seat", pickSeatForConnect(seats, "Gmail API")?.id === "2");
ok("pick free outlook seat", pickSeatForConnect(seats, "Microsoft Graph")?.id === "3");
ok("no seat returns null", pickSeatForConnect([], "Gmail API") === null);
ok("default gmail seat name", defaultSeatNameFor("Gmail API") === "Gmail mailbox");
ok("normalize mailbox", normalizeMailboxAddress("  Foo@Bar.COM ") === "foo@bar.com");

ok(
  "health connected when refresh + route",
  connectionHealth({
    accountEmail: "a@b.com",
    hasRefreshToken: true,
    expiresAt: null,
    inboundRouteActive: true,
  }) === "connected",
);
ok(
  "health degraded without inbound route",
  connectionHealth({
    accountEmail: "a@b.com",
    hasRefreshToken: true,
    expiresAt: null,
    inboundRouteActive: false,
  }) === "degraded",
);
ok(
  "health error without refresh",
  connectionHealth({
    accountEmail: "a@b.com",
    hasRefreshToken: false,
    expiresAt: null,
    inboundRouteActive: true,
  }) === "error",
);

const summaryOk = summarizeEmailValidation([
  { id: "a", ok: true, detail: "ok" },
  { id: "b", ok: true, detail: "ok2" },
]);
ok("summary ok when all pass", summaryOk.ok === true);

const summaryBad = summarizeEmailValidation([
  { id: "a", ok: true, detail: "ok" },
  { id: "b", ok: false, detail: "token dead" },
]);
ok("summary fails with detail", summaryBad.ok === false && /token dead/.test(summaryBad.message));

const migration = existsSync("supabase/migrations/0057_inbound_mailbox_route_upsert.sql")
  ? readFileSync("supabase/migrations/0057_inbound_mailbox_route_upsert.sql", "utf8")
  : "";
ok("migration 0057 exists", migration.length > 0);
ok(
  "0057 defines upsert_inbound_mailbox_route",
  /create or replace function public\.upsert_inbound_mailbox_route/i.test(migration),
);
ok(
  "0057 defines deactivate_inbound_mailbox_route_for_connection",
  /create or replace function public\.deactivate_inbound_mailbox_route_for_connection/i.test(migration),
);
ok(
  "0057 grants execute to service_role and authenticated",
  /grant execute on function public\.upsert_inbound_mailbox_route[\s\S]*to service_role, authenticated/i.test(
    migration,
  ),
);

const connectionsRoute = readFileSync("src/app/api/email/connections/route.ts", "utf8");
ok("connections GET exists", /export async function GET/.test(connectionsRoute));
ok("connections ensure_connect", /ensure_connect/.test(connectionsRoute));
ok("connections register_inbound", /register_inbound/.test(connectionsRoute));
ok("connections register_hmac_mailbox", /register_hmac_mailbox/.test(connectionsRoute));
ok(
  "connections HMAC route uses upsert_hmac_inbound_mailbox_route",
  /upsert_hmac_inbound_mailbox_route/.test(connectionsRoute)
    && /hmacRoutes/.test(connectionsRoute)
    && /hmacOnly/.test(connectionsRoute),
);
ok("connections ensure_graph_webhook", /ensure_graph_webhook/.test(connectionsRoute));
ok("connections ensureGraphMailSubscription", /ensureGraphMailSubscription/.test(connectionsRoute));
ok("connections send_graph_need_probe", /send_graph_need_probe/.test(connectionsRoute));
ok(
  "send_graph_need_probe uses sendGraphJsonMail self-delivery",
  /sendGraphJsonMail/.test(connectionsRoute)
    && /E2E Graph Push/.test(connectionsRoute)
    && /seat\.mode !== "live"/.test(connectionsRoute),
);
ok(
  "ensure_graph_webhook promotes seat to live after inbound + Graph sub",
  /promoteMicrosoftGraphSeatLive/.test(connectionsRoute)
    && /assertMicrosoftGraphSeatLiveReady/.test(connectionsRoute)
    && /seatMode/.test(connectionsRoute)
    && /upsert_inbound_mailbox_route/.test(connectionsRoute),
);

const seatLive = readFileSync("src/lib/microsoft-seat-live.ts", "utf8");
ok("microsoft-seat-live assert helper", /export async function assertMicrosoftGraphSeatLiveReady/.test(seatLive));
ok("microsoft-seat-live promote helper", /export async function promoteMicrosoftGraphSeatLive/.test(seatLive));
ok(
  "microsoft-seat-live requires OnlineMeetings.ReadWrite before live promote",
  /OnlineMeetings\.ReadWrite/.test(seatLive) && /Calendars\.ReadWrite/.test(seatLive) && /select\("id, account_email, refresh_token, scope"\)/.test(seatLive),
);

const fleetSeats = readFileSync("src/app/api/fleet/seats/route.ts", "utf8");
ok(
  "fleet seats PATCH gates Microsoft Graph mode=live on webhook readiness",
  /assertMicrosoftGraphSeatLiveReady/.test(fleetSeats) && /mode === "live"/.test(fleetSeats),
);
ok(
  "fleet seats POST refuses already-live Microsoft Graph create",
  /Microsoft Graph seats start in mock/.test(fleetSeats),
);

const disconnectRoute = readFileSync("src/app/api/email/disconnect/route.ts", "utf8");
ok(
  "email disconnect demotes seat mode to mock",
  /connected_account:\s*null,\s*mode:\s*"mock"/.test(disconnectRoute),
);

const graphSubs = readFileSync("src/lib/email-graph-subscriptions.ts", "utf8");
ok("ensureGraphMailSubscription helper", /export async function ensureGraphMailSubscription/.test(graphSubs));

const testRoute = readFileSync("src/app/api/email/test/route.ts", "utf8");
ok("email test route probes profile", /users\/me\/profile|graph\.microsoft\.com\/v1\.0\/me/.test(testRoute));
ok(
  "email test route fail-closes without active Graph webhook subscription",
  /graph_subscription/.test(testRoute) && /graph_mail_subscriptions/.test(testRoute),
);
ok(
  "email test HMAC secret is optional for Graph Outlook intake",
  /hmacOptional/.test(testRoute)
    && /Graph webhook uses clientState/.test(testRoute)
    && /graphNeedReady/.test(testRoute),
);

const syncRoute = readFileSync("src/app/api/email/sync/route.ts", "utf8");
ok(
  "email sync refuses inbox list-poll unless ARIA_ALLOW_INBOX_SYNC=1",
  /isInboxPollAllowed/.test(syncRoute)
    && /inbox_poll_disabled/.test(syncRoute)
    && syncRoute.indexOf("inbox_poll_disabled") < syncRoute.indexOf("listInboundGraph(token"),
);

const googleCb = readFileSync("src/app/auth/google/callback/route.ts", "utf8");
ok(
  "google callback registers inbound route",
  /upsert_inbound_mailbox_route/.test(googleCb),
);
ok(
  "google callback redirects to integrations",
  /tab=integrations/.test(googleCb),
);
const msCb = readFileSync("src/app/auth/microsoft/callback/route.ts", "utf8");
ok("microsoft callback registers inbound route", /upsert_inbound_mailbox_route/.test(msCb));
ok(
  "microsoft callback promotes seat to live only after Graph webhook succeeds",
  /Promote seat to live only after inbound route/.test(msCb)
    && /assertMicrosoftGraphSeatLiveReady/.test(msCb)
    && /await promoteMicrosoftGraphSeatLive/.test(msCb)
    && /ensureGraphMailSubscription/.test(msCb)
    && msCb.indexOf("ensureGraphMailSubscription") < msCb.indexOf("await promoteMicrosoftGraphSeatLive"),
);
ok(
  "microsoft callback fails closed when inbound route upsert fails",
  /inbound mailbox route failed/.test(msCb) && /redirectError/.test(msCb),
);
ok(
  "microsoft callback fails closed when Graph webhook subscription fails",
  /Graph webhook failed|Graph webhook setup failed/.test(msCb)
    && /ensureGraphMailSubscription/.test(msCb)
    && /redirectError/.test(msCb)
    && !/Graph webhook not enabled/.test(msCb),
);
ok("microsoft callback redirects to integrations", /tab=integrations/.test(msCb));

const panel = readFileSync("src/components/settings/email-connections-panel.tsx", "utf8");
ok("settings panel Connect Gmail", /Connect Gmail/.test(panel));
ok("settings panel Connect Outlook", /Connect Outlook/.test(panel));
ok(
  "settings panel honest when Outlook OAuth missing",
  /MICROSOFT_CLIENT_ID/.test(panel)
    && /Connect Outlook stays disabled/.test(panel)
    && /Entra admin must register ARIA Mantu Graph/.test(panel),
);
ok("settings panel Enable webhook", /Enable webhook/.test(panel));
ok("settings panel ensure_graph_webhook", /ensure_graph_webhook/.test(panel));
ok(
  "settings panel HMAC mailbox registration without OAuth",
  /register_hmac_mailbox/.test(panel)
    && /Register HMAC mailbox/.test(panel)
    && /HMAC inbound mailbox/.test(panel)
    && /No Connect Outlook needed/.test(panel),
);
ok(
  "settings panel Enable webhook when sub active but seat not live",
  /seatMode !== "live"/.test(panel) && /Repair live seat/.test(panel),
);

const sendMode = readFileSync("src/lib/outreach-send-mode.ts", "utf8");
ok("effectiveDryRunMode helper", /export function effectiveDryRunMode/.test(sendMode));
ok("listConnectedOutboundProviders helper", /export function listConnectedOutboundProviders/.test(sendMode));
ok("listConnectedMailboxes helper", /export function listConnectedMailboxes/.test(sendMode));
ok("hasConnectedMailbox helper", /export function hasConnectedMailbox/.test(sendMode));
ok(
  "integrations fallback requires connectedAccount (no status-only Live)",
  /integ\.connectedAccount\?\.trim\(\)/.test(sendMode) &&
    /Status-only/.test(sendMode),
);
ok(
  "Live send mode requires mailbox — HeyReach alone must not unlock Live",
  /hasConnectedMailbox/.test(sendMode) &&
    /HeyReach/.test(sendMode) &&
    /return !hasConnectedMailbox/.test(sendMode),
);
ok(
  "Mailbox integrations require mode=live (SMTP/API paste alone does not unlock Live)",
  /seat\.mode !== "live"/.test(sendMode) &&
    /MAILBOX_INTEGRATION_IDS\.has\(integ\.id\) && integ\.mode !== "live"/.test(sendMode),
);

const storeSrc = readFileSync("src/lib/store.ts", "utf8");
ok(
  "manual connectSeatAccount does not claim official API mailbox connect",
  /Operator mailbox label saved/.test(storeSrc) &&
    /not Graph\/Gmail OAuth/.test(storeSrc) &&
    !/`Mailbox connected: \$\{seat/.test(storeSrc),
);

const seatCard = readFileSync("src/components/fleet/seat-card.tsx", "utf8");
ok(
  "fleet OAuth start checks microsoftOAuth/gmailOAuth readiness",
  /microsoftOAuth/.test(seatCard) && /Outlook OAuth not configured|Gmail OAuth not configured/.test(seatCard),
);
ok(
  "fleet manual save does not toast Mailbox connected",
  /Operator mailbox label saved/.test(seatCard) && !/title: "Mailbox connected"/.test(seatCard),
);
ok(
  "fleet OAuth seats show label-only when mode is not live",
  /Dry-run · label only/.test(seatCard) && /Operator mailbox label \(not OAuth\)/.test(seatCard),
);

const intakePanel = readFileSync("src/components/intake/outlook-needs-panel.tsx", "utf8");
ok(
  "intake Connect Outlook gated on microsoftOAuthReady",
  /microsoftOAuthReady/.test(intakePanel) &&
    /Outlook OAuth not configured/.test(intakePanel),
);

const settingsPage = readFileSync("src/app/settings/page.tsx", "utf8");
ok(
  "settings oauth=success confirms live connection before success toast",
  /oauth === "success"/.test(settingsPage) &&
    /\/api\/email\/connections/.test(settingsPage) &&
    /Mailbox not confirmed|no live connection/.test(settingsPage),
);

const bootstrapCache = readFileSync("src/lib/workspace-bootstrap-cache.ts", "utf8");
ok("workspace bootstrap session cache", /readWorkspaceBootstrapCache/.test(bootstrapCache));
ok(
  "workspace bootstrap also writes localStorage (survives hard reload)",
  /localStorage/.test(bootstrapCache) && /sessionStorage/.test(bootstrapCache),
);

const sidebar = readFileSync("src/components/app/sidebar.tsx", "utf8");
ok(
  "sidebar Integrations chip links to settings integrations",
  /href="\/settings\?tab=integrations"/.test(sidebar),
);

const outreachCard = readFileSync("src/components/outreach/outreach-message-card.tsx", "utf8");
ok(
  "approval card surfaces send mode + legitimate interest CTA",
  /Dry-run \/ preview/.test(outreachCard) && /Record legitimate interest/.test(outreachCard),
);

ok("campaign bulk lawful basis action", /recordCampaignLawfulBasis/.test(storeSrc));
ok(
  "demo hydrate skips loading gate",
  /Demo state is local\/synchronous/.test(storeSrc) && /useLayoutEffect/.test(storeSrc),
);

const appShell = readFileSync("src/components/app/app-shell.tsx", "utf8");
ok(
  "loading phase paints shell chrome not full-page gate",
  /workspaceStatus\.phase === "loading"/.test(appShell)
    && /Refreshing workspace/.test(appShell)
    && /<Sidebar \/>/.test(appShell),
);
ok(
  "loading phase still renders page children (HydrationGate skeletons)",
  /phase === "loading"[\s\S]{0,1200}\{children\}/.test(appShell),
);

const storeSrc2 = readFileSync("src/lib/store.ts", "utf8");
ok(
  "hydrate paints ready before awaiting agent_seats",
  /setWorkspaceStatus\(\{ phase: "ready", mode: "live" \}\)[\s\S]{0,400}loadRemoteAgentSeats\(/.test(storeSrc2),
);

console.log(`RESULT email-connections: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
