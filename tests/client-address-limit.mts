/**
 * M-02: login attempts from one connection share a limit.
 * Caller-supplied forwarding headers must not mint a new bucket.
 * Synthetic addresses only. No network.
 */
import { readFileSync } from "node:fs";

import { POST } from "../src/app/api/auth/demo-login/route";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const peer = "198.51.100.10";
const statuses: number[] = [];
for (let n = 1; n <= 6; n++) {
  const req = new Request("http://localhost/api/auth/demo-login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": `203.0.113.${n}`,
      "x-forwarded-for": `203.0.113.${n}`,
    },
    body: JSON.stringify({ username: "synthetic", password: "synthetic" }),
  });
  Object.defineProperty(req, "socket", { value: { remoteAddress: peer } });
  const res = await POST(req);
  statuses.push(res.status);
}

ok(
  "six login attempts on one connection share a limit",
  statuses[5] === 429 && statuses.slice(0, 5).every((status) => status !== 429),
);
if (statuses[5] !== 429) console.log("statuses:", statuses.join(","));

const caddy = readFileSync(new URL("../docker/Caddyfile", import.meta.url), "utf8");
ok(
  "the gateway overwrites the forwarding header with the observed address",
  caddy.includes('request_header X-Real-IP {http.request.remote.host}') &&
    caddy.includes('request_header X-Forwarded-For {http.request.remote.host}'),
);

console.log(`RESULT client-address-limit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
