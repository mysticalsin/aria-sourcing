import { mock } from "node:test";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

let user: { id: string } | null = { id: "supabase-user-1" };
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    DEMO_COOKIE_NAME: "aria_demo",
    demoLoginEnabled: false,
    supabaseEnabled: true,
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    }),
  },
});
mock.module(moduleUrl("src/lib/demo-auth.ts"), {
  namedExports: {
    demoAuthConfigured: () => false,
    verifyDemoToken: () => false,
  },
});

const principalModule = await import("../src/lib/server/authenticated-principal");
const resolveAuthenticatedPrincipal =
  (principalModule as any).resolveAuthenticatedPrincipal ??
  (principalModule as any).default?.resolveAuthenticatedPrincipal;
const request = new NextRequest("http://localhost/api/voice/tts", { method: "POST" });

const authenticated = await resolveAuthenticatedPrincipal(request);
ok(
  "Supabase session resolves to a user-scoped principal",
  authenticated.ok && authenticated.principal.id === "user:supabase-user-1",
);

user = null;
const anonymous = await resolveAuthenticatedPrincipal(request);
ok("missing Supabase user is rejected", !anonymous.ok && anonymous.status === 401);

console.log(`RESULT authenticated-principal-supabase: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
