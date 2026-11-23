/**
 * L-04: the gateway allowlist is env-configured and defaults to deny.
 * Synthetic origins only. No network.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function allowedOrigin(allowlist: string, origin: string): string {
  const items = allowlist.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  if (!origin || origin === "*" || items.includes("*") || !items.includes(origin)) return "";
  return origin;
}

ok("an unlisted origin is denied", allowedOrigin("http://localhost:3000", "https://evil.example") === "");
ok("an empty allowlist denies", allowedOrigin("", "https://evil.example") === "");
ok("a listed origin is echoed", allowedOrigin("http://localhost:3000", "http://localhost:3000") === "http://localhost:3000");
ok("a wildcard entry is denied", allowedOrigin("*", "https://evil.example") === "");

const caddy = readFileSync(new URL("../docker/Caddyfile", import.meta.url), "utf8");
ok("the gateway does not allow every origin", !caddy.includes('Access-Control-Allow-Origin "*"'));
ok("the gateway reads an origin allowlist from the environment", caddy.includes("ARIA_CORS_ORIGINS"));
ok(
  "a query credential is not accepted",
  !caddy.includes("not query apikey="),
);

console.log(`RESULT gateway-origin-allowlist: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
