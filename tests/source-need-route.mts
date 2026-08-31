import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { NextRequest } from "next/server";

const TONY_AMACAN = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/tony-calypso-amacan-need.txt"),
  "utf8",
);

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

const routeModule = await import("../src/app/api/source/need/route");
const post = routeModule.POST;

function request(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/source/need", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

signedDemoSession = false;
const anonymous = await post(request({ jd: TONY_AMACAN, mode: "fixture" }));
ok("anonymous public-demo need POST is 401", anonymous.status === 401);

signedDemoSession = true;
const fixture = await post(request({ jd: TONY_AMACAN, mode: "fixture" }, "aria_demo=signed"));
const fixtureBody = (await fixture.json()) as {
  ok?: boolean;
  shortlist?: {
    score: number;
    provenance: string;
    evidence?: { skills?: string[]; cv?: string[]; linkedin?: string[] };
  }[];
  rejected?: { reason: string }[];
};
ok("signed demo session may run the fixture engine", fixture.status === 200 && fixtureBody.ok === true);
ok("fixture shortlist stays at or under 20", (fixtureBody.shortlist?.length ?? 99) <= 20);
ok(
  "fixture shortlist meets the 60 floor",
  (fixtureBody.shortlist ?? []).every((row) => row.score >= 60),
);
ok(
  "name-only is in rejected",
  (fixtureBody.rejected ?? []).some((row) => row.reason === "name_only"),
);
ok(
  "no invented live rows on the fixture path",
  (fixtureBody.shortlist ?? []).every((row) => row.provenance === "fixture"),
);
ok(
  "API shortlist rows carry per-row evidence citations",
  (fixtureBody.shortlist ?? []).every(
    (row) =>
      Array.isArray(row.evidence?.skills) &&
      Array.isArray(row.evidence?.cv) &&
      Array.isArray(row.evidence?.linkedin) &&
      (row.evidence?.cv.length ?? 0) > 0,
  ),
);
ok(
  "API shortlist scores are not two clustered buckets",
  new Set((fixtureBody.shortlist ?? []).map((row) => row.score)).size >= 8,
);

const live = await post(request({ jd: TONY_AMACAN, mode: "live" }, "aria_demo=signed"));
const liveBody = (await live.json()) as { ok?: boolean; code?: string; paths?: string[] };
ok("live mode without provider keys fail-closes", live.status === 503 && liveBody.code === "PROVIDER_NOT_CONFIGURED");
ok("live fail-closed returns three paths", liveBody.paths?.length === 3);

console.log(`RESULT source-need-route: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
