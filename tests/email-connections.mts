import {
  connectionHealth,
  defaultSeatNameFor,
  emailProviderReadiness,
  normalizeMailboxAddress,
  oauthAuthorizePath,
  oauthConfiguredFor,
  pickSeatForConnect,
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
  "microsoft oauth readiness",
  emailProviderReadiness({
    NODE_ENV: "test",
    MICROSOFT_CLIENT_ID: "id",
    MICROSOFT_CLIENT_SECRET: "sec",
  }).microsoftOAuth === true,
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

const testRoute = readFileSync("src/app/api/email/test/route.ts", "utf8");
ok("email test route probes profile", /users\/me\/profile|graph\.microsoft\.com\/v1\.0\/me/.test(testRoute));

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
ok("microsoft callback redirects to integrations", /tab=integrations/.test(msCb));

const panel = readFileSync("src/components/settings/email-connections-panel.tsx", "utf8");
ok("settings panel Connect Gmail", /Connect Gmail/.test(panel));
ok("settings panel Connect Outlook", /Connect Outlook/.test(panel));

console.log(`RESULT email-connections: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
