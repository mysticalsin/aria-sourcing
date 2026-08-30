/**
 * LinkedIn OIDC helper unit tests (no network).
 */
import {
  displayNameFromLinkedInProfile,
  linkedInOAuthConfigured,
  linkedInOAuthRedirectUri,
  linkedInProviderReadinessFull,
} from "../src/lib/linkedin-oauth";
import { linkedInProviderReadiness } from "../src/lib/linkedin-connections";

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
  "oauthConfigured false without client id/secret",
  !linkedInOAuthConfigured({ LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "" }),
);
ok(
  "oauthConfigured true when both set",
  linkedInOAuthConfigured({
    LINKEDIN_CLIENT_ID: "abc",
    LINKEDIN_CLIENT_SECRET: "secret-long-enough",
  }),
);

ok(
  "redirect defaults to site /auth/linkedin/callback",
  linkedInOAuthRedirectUri({ NEXT_PUBLIC_SITE_URL: "https://example.com" }) ===
    "https://example.com/auth/linkedin/callback",
);

ok(
  "displayName prefers name",
  displayNameFromLinkedInProfile({ sub: "x", name: "Ada Lovelace", email: "a@b.c" }) === "Ada Lovelace",
);
ok(
  "displayName falls back to email",
  displayNameFromLinkedInProfile({ sub: "x", email: "ada@example.com" }) === "ada@example.com",
);

const ready = linkedInProviderReadiness({
  LINKEDIN_CLIENT_ID: "id",
  LINKEDIN_CLIENT_SECRET: "secret",
  DATA_ENCRYPTION_KEY: "x".repeat(32),
});
ok("readiness.oauthConfigured", ready.oauthConfigured);
ok("readiness.encryptionReady", ready.encryptionReady);

const full = linkedInProviderReadinessFull({
  LINKEDIN_CLIENT_ID: "id",
  LINKEDIN_CLIENT_SECRET: "secret",
  DATA_ENCRYPTION_KEY: "x".repeat(32),
});
ok("full readiness matches", full.oauthConfigured && full.encryptionReady);

console.log(`RESULT linkedin-oauth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
