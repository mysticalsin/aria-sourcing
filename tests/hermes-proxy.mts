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

ok("allow-list includes api/status", HERMES_PROXY_ALLOW_LIST.includes("api/status"));
ok("allow-list includes api/sessions", HERMES_PROXY_ALLOW_LIST.includes("api/sessions"));
ok("allow-list includes api/memory", HERMES_PROXY_ALLOW_LIST.includes("api/memory"));
ok("allow-list includes api/config", HERMES_PROXY_ALLOW_LIST.includes("api/config"));
ok("allow-list includes api/skills", HERMES_PROXY_ALLOW_LIST.includes("api/skills"));

ok("allows api/status", isAllowedHermesPath(["api", "status"]).ok === true);
ok("allows api/sessions", isAllowedHermesPath(["api", "sessions"]).ok === true);
ok("allows api/memory", isAllowedHermesPath(["api", "memory"]).ok === true);
ok("blocks arbitrary path", isAllowedHermesPath(["api", "admin", "users"]).ok === false);
ok("blocks path traversal attempt", isAllowedHermesPath(["..", "etc", "passwd"]).ok === false);
ok("blocks empty path", isAllowedHermesPath([]).ok === false);

console.log(`RESULT hermes-proxy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
