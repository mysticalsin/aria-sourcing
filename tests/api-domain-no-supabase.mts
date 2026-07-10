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

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
mock.module("@supabase/ssr", {
  namedExports: { createServerClient: () => { throw new Error("Supabase client must not be created"); } },
});
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    SUPABASE_ANON_KEY: "",
    SUPABASE_AUTH_COOKIE_NAME: "sb-auth-token",
    SUPABASE_URL: "",
    supabaseEnabled: false,
    ALLOWED_EMAIL_DOMAIN: "mantu.com",
    isProduction: true,
    demoLoginEnabled: false,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});

const proxyModule = await import("../src/proxy");
const routeGate = ((proxyModule as any).proxy ?? (proxyModule as any).default?.proxy) as (request: NextRequest) => Promise<Response>;

const health = await routeGate(new NextRequest("http://localhost/api/health"));
ok("API liveness keeps its own handler contract without Supabase", health.status === 200);

const cron = await routeGate(new NextRequest("http://localhost/api/cron/dispatch-outbound"));
ok("cron authentication remains owned by the cron handler", cron.status === 200);

const page = await routeGate(new NextRequest("http://localhost/fleet"));
ok("protected page still fails closed without Supabase", page.status === 503);

console.log(`RESULT api-domain-no-supabase: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
