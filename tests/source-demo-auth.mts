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

let signedDemoSession = false;
let providerCalls = 0;
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: false,
    prodFailClosed: () => null,
    demoLoginEnabled: true,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: { getServerSupabase: async () => null },
});
mock.module(moduleUrl("src/lib/demo-auth.ts"), {
  namedExports: {
    demoAuthConfigured: () => true,
    verifyDemoToken: () => signedDemoSession,
  },
});
mock.module(moduleUrl("src/lib/sourcing/github.ts"), {
  namedExports: {
    GITHUB_USERNAME_RE: /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/,
    getGithubUser: async () => { providerCalls++; return null; },
    searchGithubUsers: async () => { providerCalls++; return []; },
  },
});
mock.module(moduleUrl("src/lib/ai/web-tools.ts"), {
  namedExports: {
    runWebTool: async () => { providerCalls++; return { ok: true, content: { results: [] } }; },
  },
});

const routeModule = await import("../src/app/api/source/route");
const post = ((routeModule as any).POST ?? (routeModule as any).default?.POST) as (request: NextRequest) => Promise<Response>;
const get = ((routeModule as any).GET ?? (routeModule as any).default?.GET) as (request: NextRequest) => Promise<Response>;

const postRequest = (cookie?: string) => new NextRequest("http://localhost/api/source", {
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify({ query: "language:typescript", count: 1, platform: "GitHub" }),
});

signedDemoSession = false;
const anonymousPost = await post(postRequest());
ok("anonymous public-demo source POST is rejected", anonymousPost.status === 401 && providerCalls === 0);

const forgedPost = await post(postRequest("aria_demo=forged"));
ok("invalid demo cookie cannot spend sourcing quota", forgedPost.status === 401 && providerCalls === 0);

signedDemoSession = true;
const signedPost = await post(postRequest("aria_demo=signed"));
ok("signed demo session may source", signedPost.status === 200 && providerCalls === 1);

signedDemoSession = false;
const anonymousGet = await get(new NextRequest("http://localhost/api/source"));
ok("anonymous public-demo source probe is rejected", anonymousGet.status === 401 && providerCalls === 1);

console.log(`RESULT source-demo-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
