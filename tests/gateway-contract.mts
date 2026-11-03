import { existsSync, readFileSync } from "fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const caddyfile = source("docker/Caddyfile");
const compose = source("docker-compose.yml");
const gatewayBlock = compose.slice(compose.indexOf("  gateway:\n"), compose.indexOf("  supabase-bootstrap:\n"));

/* ---- The Caddy gateway keeps Kong's contract for the two routes in use --- */

ok("the Kong gateway is gone", !existsSync(new URL("../docker/kong.yml", import.meta.url)) && !/\bkong\b/i.test(compose));
ok("Auth is routed with the prefix stripped", /handle_path \/auth\/v1\/\* \{\s*reverse_proxy \{\$AUTH_UPSTREAM:auth:9999\}/.test(caddyfile));
ok("REST is routed with the prefix stripped", /handle_path \/rest\/v1\/\* \{\s*reverse_proxy \{\$REST_UPSTREAM:rest:3000\}/.test(caddyfile));
ok("only Auth and REST are routed", (caddyfile.match(/reverse_proxy /g) ?? []).length === 2);
ok("anything else answers 404", /\n\t\trespond 404\n\t\}/.test(caddyfile));
ok("no admin API is exposed", caddyfile.includes("admin off"));

const keyCheck = caddyfile.slice(caddyfile.indexOf("@missingKey {"), caddyfile.indexOf("respond @missingKey"));
ok("both API trees require a key", keyCheck.includes("path /auth/v1/* /rest/v1/*"));
ok("the anon and service keys are the only accepted keys", [
  "not header apikey {$SUPABASE_ANON_KEY}",
  "not header apikey {$SUPABASE_SERVICE_KEY}",
  "not query apikey={$SUPABASE_ANON_KEY}",
  "not query apikey={$SUPABASE_SERVICE_KEY}",
].every((line) => keyCheck.includes(line)));
ok(
  "only GoTrue's browser-opened routes skip the key",
  keyCheck.includes("not path /auth/v1/verify* /auth/v1/callback* /auth/v1/authorize* /auth/v1/.well-known/jwks.json"),
);
ok("a missing or wrong key is refused with 401", caddyfile.includes('respond @missingKey `{"message":"Invalid authentication credentials"}` 401'));
ok(
  "the preflight is answered before the key check",
  caddyfile.indexOf("respond @preflight 204") > -1 && caddyfile.indexOf("respond @preflight 204") < caddyfile.indexOf("respond @missingKey"),
);
ok(
  "a user session bearer is never overwritten by the key",
  /@keyWithoutSession \{\s*header apikey \*\s*not header Authorization \*\s*\}/.test(caddyfile) &&
    caddyfile.includes('request_header @keyWithoutSession Authorization "Bearer {http.request.header.apikey}"'),
);

/* ---- Compose wiring ------------------------------------------------------ */

ok("the gateway image is pinned", /image: caddy:\d+\.\d+\.\d+-alpine/.test(gatewayBlock));
ok("the gateway binds to loopback only", gatewayBlock.includes('- "127.0.0.1:${API_PORT:-54321}:8000"'));
ok("the gateway receives the keys it checks", gatewayBlock.includes("SUPABASE_ANON_KEY: *anon_key") && gatewayBlock.includes("SUPABASE_SERVICE_KEY: *service_key"));
ok("the Caddyfile is mounted read-only", gatewayBlock.includes("./docker/Caddyfile:/etc/caddy/Caddyfile:ro"));
ok("the app server reaches Supabase through the gateway", compose.includes("SUPABASE_URL: http://gateway:8000"));
ok("the browser and GoTrue use the same public API port", (compose.match(/http:\/\/localhost:\$\{API_PORT:-54321\}/g) ?? []).length === 3);
ok("every long-running service has bounded logs", (compose.match(/logging: \*logging/g) ?? []).length === 5);

console.log(`RESULT gateway-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
