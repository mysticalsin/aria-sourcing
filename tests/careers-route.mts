import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const routePath = new URL("../src/app/api/careers/route.ts", import.meta.url);
const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";

ok("public careers route requires an explicit workspace configuration", route.includes("CAREERS_WORKSPACE_ID"));
ok("public careers route uses only the server-side service client", route.includes("getServiceSupabase") && !route.includes("getServerSupabase"));
ok("public careers writes are rate limited", route.includes("checkRateLimit") && route.includes("tooManyRequests"));
ok("public careers writes require JSON validation", route.includes("validateBody") && route.includes("application/json"));
ok("public careers writes reject cross-origin browser requests", route.includes("origin") && route.includes("req.nextUrl.origin"));
ok("public careers writes use the optimistic-concurrency submission service", route.includes("submitPublicCareerApplication"));
ok("public careers responses are never cached", route.includes("Cache-Control") && route.includes("no-store"));

console.log(`RESULT careers-route: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
