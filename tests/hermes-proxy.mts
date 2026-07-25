/* ============================================================================
   tests/hermes-proxy.mts
   Area: Aria runtime proxy — path allow-list and URL helpers.
   ========================================================================== */

import { isAllowedHermesPath, HERMES_PROXY_ALLOW_LIST } from "../src/lib/api/hermes-proxy";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const allowedPaths = HERMES_PROXY_ALLOW_LIST.map((entry) => entry.path);
const baseFor = (path: string) => HERMES_PROXY_ALLOW_LIST.find((entry) => entry.path === path)?.base;

ok("allow-list includes api/status", allowedPaths.includes("api/status"));
ok("allow-list includes api/sessions", allowedPaths.includes("api/sessions"));
ok("allow-list includes api/memory", allowedPaths.includes("api/memory"));
ok("allow-list includes api/config", allowedPaths.includes("api/config"));
ok("allow-list includes api/skills", allowedPaths.includes("api/skills"));

ok("allows api/status", isAllowedHermesPath(["api", "status"]).ok === true);
ok("allows api/sessions", isAllowedHermesPath(["api", "sessions"]).ok === true);
ok("allows api/memory", isAllowedHermesPath(["api", "memory"]).ok === true);
ok("blocks arbitrary path", isAllowedHermesPath(["api", "admin", "users"]).ok === false);
ok("blocks path traversal attempt", isAllowedHermesPath(["..", "etc", "passwd"]).ok === false);
ok("blocks empty path", isAllowedHermesPath([]).ok === false);

/* ---- two-server routing ----------------------------------------------------
   Upstream is an aiohttp gateway plus a FastAPI management server with disjoint
   route sets. Addressing both off one base URL is why every management path
   404'd against a healthy runtime. Each entry now names its owning process, and
   these assertions pin that mapping to what upstream origin/main actually
   registers. ------------------------------------------------------------- */

ok("every allow-list entry names a base", HERMES_PROXY_ALLOW_LIST.every((entry) => entry.base === "api" || entry.base === "web"));
ok("allow-list has no duplicate paths", new Set(allowedPaths).size === allowedPaths.length);

for (const path of ["api/status", "api/system/stats", "api/config", "api/memory", "api/skills", "api/curator", "api/files"]) {
  ok(`${path} routes to the management server`, baseFor(path) === "web");
}
for (const path of ["health", "v1/chat/completions", "api/sessions"]) {
  ok(`${path} routes to the gateway`, baseFor(path) === "api");
}

// isAllowedHermesPath must surface the base, or the route cannot pick a server.
const statusCheck = isAllowedHermesPath(["api", "status"]);
ok("a resolved path carries its base", statusCheck.ok === true && statusCheck.base === "web");
const chatCheck = isAllowedHermesPath(["v1", "chat", "completions"]);
ok("the chat path resolves to the gateway base", chatCheck.ok === true && chatCheck.base === "api");

/* ---- paths that exist on NEITHER upstream process --------------------------
   Verified against NousResearch/hermes-agent origin/main (2026-07-24). These
   were in the allow-list and could only ever have 404'd; keeping them widened
   the nominal proxy surface for zero function. Asserted so they cannot drift
   back in. ------------------------------------------------------------------ */
for (const dead of ["api/health", "api/tools", "api/models", "api/schedules", "api/gateway", "api/oauth/account"]) {
  ok(`${dead} is not allow-listed (exists on neither upstream server)`, !allowedPaths.includes(dead));
  ok(`${dead} is refused by the validator`, isAllowedHermesPath(dead.split("/")).ok === false);
}

console.log(`RESULT hermes-proxy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
