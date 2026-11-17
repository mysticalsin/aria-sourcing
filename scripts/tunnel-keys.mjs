#!/usr/bin/env node
// Rotate the local stack's PUBLIC sample secrets before exposing it (ngrok).
//
// docker-compose.yml ships the well-known Supabase sample JWT secret and the
// anon/service_role tokens signed with it: anyone could forge a service_role
// token against a stack reachable from the internet. This writes fresh ones to
// `.env` (gitignored, dockerignored), which compose reads for interpolation:
//
//   SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
//   DEMO_ADMIN_PASSWORD (the owner login), AUTH_DISABLE_SIGNUP=true,
//   ARIA_KEYS_ROTATED=true (the tunnel service refuses to start without it).
//
// Other lines in `.env` (NGROK_AUTHTOKEN, NGROK_DOMAIN, ...) are kept. Values
// already rotated are kept too, unless --force. Nothing is printed except the
// owner password, once, so it can be written down.
//
// Run (no Node on the host needed):
//   docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.61.1-noble node scripts/tunnel-keys.mjs
// then rebuild and recreate the stack: docker compose up -d --build
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env";
const force = process.argv.includes("--force");

const b64url = (value) => Buffer.from(value).toString("base64url");

/** HS256 JWT, as GoTrue and PostgREST verify it. */
export function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Letters and digits only: safe in YAML, shell and compose interpolation. */
function password(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function readEnv(path) {
  const entries = new Map();
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

function main() {
  const env = readEnv(ENV_FILE);
  const rotated = env.get("ARIA_KEYS_ROTATED") === "true" && !force;

  if (!rotated) {
    const secret = randomBytes(48).toString("base64url");
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 10 * 365 * 24 * 3600;
    env.set("SUPABASE_JWT_SECRET", secret);
    env.set("SUPABASE_ANON_KEY", signJwt({ role: "anon", iss: "aria-local", iat, exp }, secret));
    env.set("SUPABASE_SERVICE_KEY", signJwt({ role: "service_role", iss: "aria-local", iat, exp }, secret));
  }
  const newOwnerPassword = !env.get("DEMO_ADMIN_PASSWORD") || force;
  if (newOwnerPassword) env.set("DEMO_ADMIN_PASSWORD", password(20));
  env.set("AUTH_DISABLE_SIGNUP", "true");
  env.set("ARIA_KEYS_ROTATED", "true");
  if (!env.has("NGROK_AUTHTOKEN")) env.set("NGROK_AUTHTOKEN", "");
  if (!env.has("NGROK_DOMAIN")) env.set("NGROK_DOMAIN", "");

  const lines = [
    "# Local only (gitignored). Written by scripts/tunnel-keys.mjs; read by docker compose.",
    ...[...env].map(([key, value]) => `${key}=${value}`),
    "",
  ];
  writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });

  console.log(rotated ? "Keys already rotated (kept; --force to rotate again)." : "Supabase JWT secret and keys rotated.");
  if (newOwnerPassword) {
    console.log(`Owner login: admin@aria.local / ${env.get("DEMO_ADMIN_PASSWORD")}`);
    console.log("It takes effect when scripts/demo-accounts.mjs runs (it updates the existing owner account).");
  }
  console.log("Sign-up is closed (AUTH_DISABLE_SIGNUP=true). Next: fill NGROK_AUTHTOKEN and NGROK_DOMAIN in .env,");
  console.log("then: docker compose up -d --build");
}

main();
