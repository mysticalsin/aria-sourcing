import assert from "node:assert/strict";

// Keep the route in its existing non-production test harness: no Supabase env
// means requireAdmin() returns the local admin demo session, while the public
// demo flag stays false so publicDemoSideEffectsDisabled() does not block.
process.env.NODE_ENV = "test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "false";
process.env.GOOGLE_CLIENT_ID = "dummy-google-client-id.apps.googleusercontent.com";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3003/auth/google/callback";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const { NextRequest } = await import("next/server");
const googleRoute = await import("../src/app/auth/google/route");

const response = await googleRoute.GET(
  new NextRequest("http://localhost:3003/auth/google?seat_id=seat_test_123", {
    method: "GET",
  }),
);

const location = response.headers.get("location");
ok("Google OAuth start returns a redirect", response.status >= 300 && response.status < 400);
ok("redirect location is present", typeof location === "string" && location.length > 0);

assert.ok(location, "redirect location is required for the remaining assertions");
const redirect = new URL(location);
const scopes = (redirect.searchParams.get("scope") ?? "").split(/\s+/);

ok("redirect host is accounts.google.com", redirect.host === "accounts.google.com");
ok("redirect path is Google OAuth v2 auth", redirect.pathname === "/o/oauth2/v2/auth");
ok("redirect includes configured client id", redirect.searchParams.get("client_id") === process.env.GOOGLE_CLIENT_ID);
ok("redirect includes configured callback", redirect.searchParams.get("redirect_uri") === process.env.GOOGLE_REDIRECT_URI);
ok("redirect requests gmail.send scope", scopes.includes("https://www.googleapis.com/auth/gmail.send"));
ok("redirect keeps gmail.readonly scope", scopes.includes("https://www.googleapis.com/auth/gmail.readonly"));
ok("redirect keeps calendar.events scope", scopes.includes("https://www.googleapis.com/auth/calendar.events"));
ok("redirect includes state", Boolean(redirect.searchParams.get("state")));
ok("redirect includes PKCE challenge", Boolean(redirect.searchParams.get("code_challenge")));
ok("redirect uses S256 PKCE", redirect.searchParams.get("code_challenge_method") === "S256");

console.log(`RESULT auth-google-redirect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
