import { mock } from "node:test";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => ({
      auth: { exchangeCodeForSession: async () => ({ data: {}, error: null }) },
    }),
  },
});

const route = await import("../src/app/auth/callback/route");

const exploit = new URL("https://aria.example.test/auth/callback");
exploit.searchParams.set("code", "oauth-code");
exploit.searchParams.set("redirect", "/\\evil.example/phish");
const exploitResponse = await route.GET(new NextRequest(exploit));
const exploitLocation = exploitResponse.headers.get("location") ?? "";

ok("OAuth callback returns a redirect", exploitResponse.status >= 300 && exploitResponse.status < 400);
ok(
  "OAuth callback backslash payload stays on the application origin",
  new URL(exploitLocation).origin === exploit.origin,
);
ok("OAuth callback rejects the ambiguous redirect path", new URL(exploitLocation).pathname === "/");

const safe = new URL("https://aria.example.test/auth/callback");
safe.searchParams.set("code", "oauth-code");
safe.searchParams.set("redirect", "/campaigns?status=active#results");
const safeResponse = await route.GET(new NextRequest(safe));
ok(
  "OAuth callback preserves a valid same-origin relative target",
  safeResponse.headers.get("location") === "https://aria.example.test/campaigns?status=active#results",
);

console.log(`RESULT auth-callback-redirect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
