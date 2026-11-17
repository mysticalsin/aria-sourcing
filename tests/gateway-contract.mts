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
// The API gateway site (:8000) alone; the public edge (:8080) is checked below.
const apiSite = caddyfile.slice(0, caddyfile.indexOf("\n:8080 {"));
const compose = source("docker-compose.yml");
const gatewayBlock = compose.slice(compose.indexOf("  gateway:\n"), compose.indexOf("  supabase-bootstrap:\n"));

/* ---- The Caddy gateway keeps Kong's contract for the two routes in use --- */

ok("the Kong gateway is gone", !existsSync(new URL("../docker/kong.yml", import.meta.url)) && !/\bkong\b/i.test(compose));
ok("Auth is routed with the prefix stripped", /handle_path \/auth\/v1\/\* \{\s*reverse_proxy \{\$AUTH_UPSTREAM:auth:9999\}/.test(caddyfile));
ok("REST is routed with the prefix stripped", /handle_path \/rest\/v1\/\* \{\s*reverse_proxy \{\$REST_UPSTREAM:rest:3000\}/.test(caddyfile));
ok("only Auth and REST are routed", (apiSite.match(/reverse_proxy /g) ?? []).length === 2);
ok("anything else answers 404", /\n\t\trespond 404\n\t\}/.test(caddyfile));
ok("no admin API is exposed", caddyfile.includes("admin off"));
ok(
  "both upstreams use a fresh connection per request and retry an unreachable upstream",
  (apiSite.match(/import upstream_resilience/g) ?? []).length === 2 &&
    /\(upstream_resilience\) \{\s*transport http \{\s*keepalive off\s*\}\s*lb_retries 2/.test(caddyfile),
);
ok("gateway 5xx answers are logged", /log \{\s*output stderr\s*level ERROR\s*\}/.test(caddyfile));

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
// db, auth, rest, gateway, app, and the agents runner (ADR 0002).
ok("every long-running service has bounded logs", (compose.match(/logging: \*logging/g) ?? []).length === 7);
ok(
  "an upstream failure keeps the CORS header",
  /handle_errors \{\s*header Access-Control-Allow-Origin "\*"/.test(caddyfile),
);

/* ---- The contract is proven on every `up` and by demo:doctor ------------- */

const bootstrapBlock = compose.slice(compose.indexOf("  supabase-bootstrap:\n"), compose.indexOf("  app:\n"));
const gatewayCheck = source("docker/bootstrap/gateway-check.sh");
ok("bootstrap waits for a healthy gateway", /gateway:\s*condition: service_healthy/.test(bootstrapBlock));
ok("bootstrap receives both keys", bootstrapBlock.includes("SUPABASE_ANON_KEY: *anon_key") && bootstrapBlock.includes("SERVICE_ROLE_KEY: *service_key"));
ok("bootstrap ends with the gateway check", source("docker/bootstrap/run.sh").includes("/usr/local/bin/gateway-check.sh"));
ok("the bootstrap image ships the gateway check", source("docker/bootstrap/Dockerfile").includes("COPY gateway-check.sh /usr/local/bin/gateway-check.sh"));
ok("the gateway check covers the contract", [
  "REST without a key is refused",
  "REST with an unknown key is refused",
  "REST with the anon key reaches PostgREST",
  "a bare service key becomes the bearer",
  "a session bearer is kept",
  "CORS preflight is answered",
  "unrouted paths answer 404",
].every((check) => gatewayCheck.includes(`"${check}"`)));
ok("the gateway check prints no key", !/echo[^\n]*\$(ANON|SERVICE)\b/.test(gatewayCheck));
ok("demo:doctor reruns the gateway check", source("scripts/local-stack.mjs").includes('"--entrypoint", "/usr/local/bin/gateway-check.sh", "supabase-bootstrap"'));

/* ---- Public edge (:8080) for the ngrok demo URL --------------------------- */

const edge = caddyfile.slice(caddyfile.indexOf("\n:8080 {"));
const tunnelBlock = compose.slice(compose.indexOf("  tunnel:\n"), compose.indexOf("\nvolumes:\n"));
ok("the edge is its own site", edge.startsWith("\n:8080 {"));
ok("the edge keeps the forwarded proto from ngrok", /servers :8080 \{\s*trusted_proxies static private_ranges\s*\}/.test(caddyfile));
ok("the edge sends the Supabase API through the keyed gateway",
  /@supabaseApi path \/auth\/v1\/\* \/rest\/v1\/\*\s*reverse_proxy @supabaseApi 127\.0\.0\.1:8000/.test(edge));
const closed = /@closed path ([^\n]+)\n\t\trespond @closed 404/.exec(edge)?.[1].split(" ") ?? [];
ok("the edge closes account creation, owner login, internal clocks and the owner's careers board", [
  "/auth/v1/signup*", "/auth/v1/admin/*", "/auth/v1/invite*", "/auth/v1/otp*", "/auth/v1/magiclink*",
  "/api/auth/demo-login*", "/api/agent/tick*", "/api/cron/*", "/api/webhooks/*", "/api/careers*", "/careers*",
].every((path) => closed.includes(path)));
ok("the edge refuses the service key in every form", [
  "@serviceKeyHeader header apikey {$SUPABASE_SERVICE_KEY}",
  '@serviceKeyBearer header Authorization "Bearer {$SUPABASE_SERVICE_KEY}"',
  "@serviceKeyQuery query apikey={$SUPABASE_SERVICE_KEY}",
].every((line) => edge.includes(line)));
ok("closed routes and the service key are checked before any proxy",
  edge.indexOf("respond @closed 404") < edge.indexOf("reverse_proxy") &&
  edge.indexOf("respond @serviceKeyQuery 403") < edge.indexOf("reverse_proxy"));
ok("the edge serves the extension zip, and only that file",
  /@extensionZip path \/downloads\/aria-linkedin-bridge\.zip\n\t\tfile_server @extensionZip \{\n\t\t\troot \/srv\n\t\t\}/.test(edge) &&
  (edge.match(/file_server/g) ?? []).length === 1 &&
  edge.indexOf("file_server @extensionZip") > edge.indexOf("respond @serviceKeyQuery 403"));
ok("the zip folder is mounted read-only and kept out of git",
  gatewayBlock.includes("- ./.demo-downloads:/srv/downloads:ro") && source(".gitignore").includes(".demo-downloads/"));
ok("the edge port is published on loopback only", gatewayBlock.includes('"127.0.0.1:${EDGE_PORT:-8080}:8080"'));
ok("the tunnel is opt-in and pinned", /profiles: \["tunnel"\]/.test(tunnelBlock) && /image: ngrok\/ngrok:\d+\.\d+\.\d+-alpine/.test(tunnelBlock));
ok("the tunnel refuses sample keys and open sign-up",
  tunnelBlock.includes('"$$KEYS_ROTATED" != "true"') && tunnelBlock.includes('"$$SIGNUP_DISABLED" != "true"'));
ok("the tunnel gets no stack secret", !/env_file|SERVICE_KEY|ANON_KEY|JWT_SECRET/.test(tunnelBlock));
ok("sample keys and sign-up are overridable from .env", [
  "${SUPABASE_JWT_SECRET:-", "${SUPABASE_ANON_KEY:-", "${SUPABASE_SERVICE_KEY:-", "${DEMO_ADMIN_PASSWORD:-",
  'GOTRUE_DISABLE_SIGNUP: "${AUTH_DISABLE_SIGNUP:-false}"',
].every((part) => compose.includes(part)));

const { browserSupabaseUrl } = await import("../src/lib/supabase/config");
const local = "http://localhost:54321";
ok("a page on localhost keeps the configured API URL",
  browserSupabaseUrl(local, { origin: "http://localhost:3000", hostname: "localhost" }) === local);
ok("a page on the public edge calls its own origin",
  browserSupabaseUrl(local, { origin: "https://aria.ngrok-free.app", hostname: "aria.ngrok-free.app" }) === "https://aria.ngrok-free.app");
ok("a non-loopback configured URL is kept everywhere",
  browserSupabaseUrl("https://api.example.com", { origin: "https://aria.ngrok-free.app", hostname: "aria.ngrok-free.app" }) === "https://api.example.com");
ok("server rendering keeps the configured URL", browserSupabaseUrl(local) === local);

console.log(`RESULT gateway-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
