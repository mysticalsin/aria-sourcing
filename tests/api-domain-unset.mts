import { mock } from "node:test";
import { NextRequest } from "next/server";

/* With no email-domain allow-list (the local Docker stack), the route gate
   skips its GoTrue round trip on API calls (handlers authenticate themselves)
   but still checks the session on pages. */

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

let user: { id: string; email?: string } | null = null;
let getUserCalls = 0;
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module("@supabase/ssr", {
  namedExports: {
    createServerClient: () => ({
      auth: { getUser: async () => { getUserCalls++; return { data: { user }, error: null }; } },
    }),
  },
});
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_AUTH_COOKIE_NAME: "sb-test-auth-token",
    SUPABASE_URL: "https://supabase.example.test",
    supabaseEnabled: true,
    ALLOWED_EMAIL_DOMAIN: "",
    isProduction: true,
    demoLoginEnabled: false,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});

const proxyModule = await import("../src/proxy");
const routeGate = ((proxyModule as any).proxy ?? (proxyModule as any).default?.proxy) as (request: NextRequest) => Promise<Response>;

user = { id: "user", email: "person@anywhere.example" };
const api = await routeGate(new NextRequest("http://localhost/api/ai/chat", { method: "POST" }));
ok("API call reaches its handler", api.status === 200 && !api.headers.has("location"));
ok("API call skips the gate's GoTrue round trip", getUserCalls === 0);

user = null;
const anonymousApi = await routeGate(new NextRequest("http://localhost/api/candidates"));
ok("anonymous API call is left to the handler's own auth", anonymousApi.status === 200 && getUserCalls === 0);

const anonymousPage = await routeGate(new NextRequest("http://localhost/fleet"));
ok("anonymous page still redirects to login", anonymousPage.status >= 300 && anonymousPage.status < 400 && getUserCalls === 1);

user = { id: "user", email: "person@anywhere.example" };
const page = await routeGate(new NextRequest("http://localhost/fleet"));
ok("signed-in page is served after a session check", page.status === 200 && getUserCalls === 2);

console.log(`RESULT api-domain-unset: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
