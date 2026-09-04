/**
 * LinkedIn Aria vault credential resolution — plug-and-play Settings keys with env fallback.
 */
import {
  browserComputerConfigured,
  extractLinkedInCredentialRefs,
  linkedInReadinessFromCredentials,
  vendorApiConfigured,
  type LinkedInResolvedCredentials,
} from "../src/lib/linkedin-credentials";

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
  "extract empty settings",
  Object.values(extractLinkedInCredentialRefs(undefined)).every((v) => v === "" || v == null),
);

const refs = extractLinkedInCredentialRefs({
  linkedinClientId: "cid",
  linkedinClientSecretKeyId: "sec-id",
  linkedinVendorApiUrl: "https://vendor.example/send",
  linkedinVendorApiKeyId: "vend-id",
  computerSupervisorUrl: "https://computers.example",
  computerSupervisorTokenKeyId: "tok-id",
});
ok("extract client id", refs.clientId === "cid");
ok("extract vendor key id", refs.vendorApiKeyId === "vend-id");
ok("extract supervisor url", refs.computerSupervisorUrl === "https://computers.example");

const emptyCreds: LinkedInResolvedCredentials = {
  clientId: "",
  clientSecret: "",
  vendorApiUrl: "",
  vendorApiKey: "",
  computerSupervisorUrl: "",
  computerSupervisorToken: "",
  computerSupervisorMockSend: false,
};

ok("vendor dark without credentials", vendorApiConfigured(emptyCreds) === false);
ok(
  "vendor ready with vault-shaped creds",
  vendorApiConfigured({
    vendorApiUrl: "https://vendor.example/send",
    vendorApiKey: "secret",
  }) === true,
);

ok("browser computer dark without supervisor", browserComputerConfigured(emptyCreds) === false);
ok(
  "browser computer ready with supervisor url",
  browserComputerConfigured({ computerSupervisorUrl: "https://computers.example" }) === true,
);
ok(
  "browser computer ready with mock flag",
  browserComputerConfigured({ computerSupervisorMockSend: true }) === true,
);

const ready = linkedInReadinessFromCredentials(
  {
    clientId: "cid",
    clientSecret: "sec",
    vendorApiUrl: "https://vendor.example/send",
    vendorApiKey: "k",
    computerSupervisorUrl: "https://computers.example",
    computerSupervisorToken: "t",
    computerSupervisorMockSend: false,
  },
  { DATA_ENCRYPTION_KEY: "x".repeat(32), LINKEDIN_INBOUND_WEBHOOK_SECRET: "wh" },
);

ok("readiness oauth from vault creds", ready.oauthConfigured === true);
ok("readiness vendor from vault creds", ready.vendorApiConfigured === true);
ok("readiness browser from vault creds", ready.browserComputerConfigured === true);
ok("readiness encryption", ready.encryptionReady === true);
ok("readiness inbound", ready.inboundWebhookSecret === true);

const prevUrl = process.env.LINKEDIN_VENDOR_API_URL;
const prevKey = process.env.LINKEDIN_VENDOR_API_KEY;
process.env.LINKEDIN_VENDOR_API_URL = "https://env-vendor.example";
process.env.LINKEDIN_VENDOR_API_KEY = "env-key";
ok("vendor falls back to env when creds empty", vendorApiConfigured({}) === true);
if (prevUrl === undefined) delete process.env.LINKEDIN_VENDOR_API_URL;
else process.env.LINKEDIN_VENDOR_API_URL = prevUrl;
if (prevKey === undefined) delete process.env.LINKEDIN_VENDOR_API_KEY;
else process.env.LINKEDIN_VENDOR_API_KEY = prevKey;

console.log(`linkedin-credentials: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
