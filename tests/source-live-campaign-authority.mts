import { mock } from "node:test";
import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL: ${name}`);
}

let providerCalls = 0;
let tavilySecretReads = 0;
let sessionReads = 0;
const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: true,
    prodFailClosed: () => null,
    demoLoginEnabled: false,
    DEMO_COOKIE_NAME: "aria_demo",
  },
});
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServerSupabase: async () => {
      sessionReads += 1;
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: "member-1" } }, error: null }),
        },
        rpc: async () => ({ data: "member", error: null }),
      };
    },
  },
});
mock.module(moduleUrl("src/lib/demo-auth.ts"), {
  namedExports: {
    demoAuthConfigured: () => false,
    verifyDemoToken: () => false,
  },
});
mock.module(moduleUrl("src/lib/sourcing/tavily.ts"), {
  namedExports: {
    resolveStoredTavilyKey: async () => {
      tavilySecretReads += 1;
      return "should-not-be-read";
    },
  },
});
mock.module(moduleUrl("src/lib/sourcing/github.ts"), {
  namedExports: {
    GITHUB_USERNAME_RE: /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/,
    getGithubUser: async (_clearance: unknown, login: string) => {
      providerCalls += 1;
      return { login, id: 1, html_url: `https://github.com/${login}` };
    },
    searchGithubUsers: async () => {
      providerCalls += 1;
      return [];
    },
  },
});
mock.module(moduleUrl("src/lib/ai/web-tools.ts"), {
  namedExports: {
    runWebTool: async () => {
      providerCalls += 1;
      return { ok: true, content: { results: [] } };
    },
  },
});

const route = await import("../src/app/api/source/route");

function request(body: Record<string, unknown>, origin = "http://localhost") {
  return new NextRequest("http://localhost/api/source", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

providerCalls = 0;
tavilySecretReads = 0;
sessionReads = 0;
const rawSearch = await route.POST(
  request({ query: "staff typescript engineer", count: 5, platform: "GitHub" }),
);
const rawSearchBody = (await rawSearch.json()) as { code?: string };
ok(
  "live raw search requires the reviewed campaign authority route",
  rawSearch.status === 409 && rawSearchBody.code === "CAMPAIGN_AUTHORITY_REQUIRED",
);
ok(
  "blocked live raw search performs no provider or workspace-secret access",
  providerCalls === 0 && tavilySecretReads === 0,
);
ok("blocked live raw search still authenticates and authorizes the caller", sessionReads === 1);

providerCalls = 0;
sessionReads = 0;
const forgedOrigin = await route.POST(
  request({ username: "octocat", platform: "GitHub" }, "https://attacker.example"),
);
ok(
  "live exact-profile lookup rejects cross-origin requests before auth or egress",
  forgedOrigin.status === 403 && sessionReads === 0 && providerCalls === 0,
);

providerCalls = 0;
sessionReads = 0;
const exactProfile = await route.POST(
  request({ username: "octocat", platform: "GitHub" }),
);
const exactProfileBody = (await exactProfile.json()) as { ok?: boolean; source?: string };
ok(
  "same-origin exact GitHub intake remains available to an authorized member",
  exactProfile.status === 200 &&
    exactProfileBody.ok === true &&
    exactProfileBody.source === "github" &&
    sessionReads === 1 &&
    providerCalls === 1,
);

console.log(`RESULT source-live-campaign-authority: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
