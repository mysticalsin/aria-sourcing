import { mock } from "node:test";
import { NextRequest } from "next/server";

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
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module("@supabase/ssr", {
  namedExports: {
    createServerClient: () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    }),
  },
});
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_AUTH_COOKIE_NAME: "sb-test-auth-token",
    SUPABASE_URL: "https://supabase.example.test",
    supabaseEnabled: true,
    ALLOWED_EMAIL_DOMAIN: "mantu.com",
    isProduction: true,
    demoLoginEnabled: false,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});

const proxyModule = await import("../src/proxy");
const routeGate = ((proxyModule as any).proxy ?? (proxyModule as any).default?.proxy) as (request: NextRequest) => Promise<Response>;
const matchers = ((proxyModule as any).config ?? (proxyModule as any).default?.config)?.matcher as string[];

ok("route matcher explicitly includes every API suffix", Array.isArray(matchers) && matchers.includes("/api/:path*"));

user = { id: "foreign-user", email: "person@outside.example" };
const blockedApi = await routeGate(new NextRequest("http://localhost/api/hermes/chat", { method: "POST" }));
const blockedApiBody = await blockedApi.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
ok("off-domain API session receives JSON 403", blockedApi.status === 403 && blockedApiBody?.ok === false);
ok("off-domain API denial does not redirect", !blockedApi.headers.has("location"));

user = { id: "allowed-user", email: "person@mantu.com" };
const allowedApi = await routeGate(new NextRequest("http://localhost/api/hermes/chat", { method: "POST" }));
ok("allowed-domain API session reaches its handler", allowedApi.status === 200);

user = null;
const anonymousApi = await routeGate(new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST" }));
ok("anonymous API request reaches its own route auth or signature gate", anonymousApi.status === 200 && !anonymousApi.headers.has("location"));

const anonymousPage = await routeGate(new NextRequest("http://localhost/fleet"));
ok("anonymous protected page still redirects to login", anonymousPage.status >= 300 && anonymousPage.status < 400);

user = { id: "foreign-user", email: "person@outside.example" };
const blockedPage = await routeGate(new NextRequest("http://localhost/fleet"));
ok("off-domain page session still redirects to signout", blockedPage.headers.get("location")?.includes("/auth/signout") === true);

console.log(`RESULT api-domain-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
