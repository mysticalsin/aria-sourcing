import { mock } from "node:test";
import { NextRequest } from "next/server";
import { mintDemoToken } from "../src/lib/demo-auth";

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
process.env.DEMO_SESSION_SECRET = "public-demo-session-secret-32-characters";
mock.module("@supabase/ssr", {
  namedExports: { createServerClient: () => { throw new Error("Supabase client must not be created"); } },
});
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    SUPABASE_ANON_KEY: "",
    SUPABASE_AUTH_COOKIE_NAME: "sb-auth-token",
    SUPABASE_URL: "",
    supabaseEnabled: false,
    ALLOWED_EMAIL_DOMAIN: "",
    isProduction: true,
    demoLoginEnabled: true,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});

const proxyModule = await import("../src/proxy");
const routeGate = ((proxyModule as any).proxy ?? (proxyModule as any).default?.proxy) as (request: NextRequest) => Promise<Response>;

const anonymousSource = await routeGate(new NextRequest("http://localhost/api/source", { method: "POST" }));
ok("public-demo source requires a demo session before its handler", anonymousSource.status === 401);

const forgedSource = await routeGate(new NextRequest("http://localhost/api/source", {
  method: "POST",
  headers: { cookie: "aria_demo=forged" },
}));
ok("forged demo cookie is rejected at the shared gate", forgedSource.status === 401);

const signedSource = await routeGate(new NextRequest("http://localhost/api/source", {
  method: "POST",
  headers: { cookie: `aria_demo=${mintDemoToken()}` },
}));
ok("signed demo cookie reaches the route handler", signedSource.status === 200);

const publicHealth = await routeGate(new NextRequest("http://localhost/api/health"));
ok("public-demo health remains public", publicHealth.status === 200);

const publicLogin = await routeGate(new NextRequest("http://localhost/api/auth/demo-login", { method: "POST" }));
ok("public-demo login endpoint remains public", publicLogin.status === 200);

const providerWebhook = await routeGate(new NextRequest("http://localhost/api/webhooks/whatsapp", { method: "POST" }));
ok("provider webhook still reaches its signature handler", providerWebhook.status === 200);

console.log(`RESULT api-domain-public-demo: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
