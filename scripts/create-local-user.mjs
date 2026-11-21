#!/usr/bin/env node
// Create (or update) a user on the LOCAL Docker stack.
//
//   npm run demo:user -- --email tony@aria.local --name "Tony" [--password <pw>] [--role member|admin]
//
// An @aria.local email joins the demo workspace (the one admin@aria.local
// uses) and sees the same candidates; role "member" by default (sourcing,
// outreach, LinkedIn), "admin" for settings and keys too. Without --password
// a random one is generated and printed once. Each user connects their own
// LinkedIn (Settings › Integrations › LinkedIn).
//
// Local only: it talks to http://localhost:${API_PORT:-54321} with the tokens
// generated for this stack and refuses any other host.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(`create-local-user: ${message}`);
  process.exit(1);
}

const email = (arg("email") ?? "").trim().toLowerCase();
const name = (arg("name") ?? "").trim();
const role = arg("role", "member");
const password = arg("password") ?? randomBytes(15).toString("base64url");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("give --email, e.g. --email tony@aria.local");
if (!["member", "admin"].includes(role)) fail("--role is member or admin");
if (password.length < 8) fail("--password needs 8 characters or more");

const api = `http://localhost:${process.env.API_PORT ?? "54321"}`;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(api)) fail("local stack only");
try {
  const saved = readFileSync(new URL("../.local/jwt.env", import.meta.url), "utf8");
  for (const line of saved.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // The stack file is optional when the variables are already exported.
}
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
if (!service || !anon) fail("set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY, or start the stack with npm run demo:up");

async function call(path, { method = "GET", token = service, apikey = service, body } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => fail(`cannot reach ${api}: is the stack up (docker compose up)?`));
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const metadata = name ? { full_name: name, name } : {};
let created = await call("/auth/v1/admin/users", {
  method: "POST",
  body: { email, password, email_confirm: true, user_metadata: metadata },
});
let userId = created.json?.id ?? null;
let action = "created";
if (!userId) {
  const list = await call("/auth/v1/admin/users?per_page=1000");
  const existing = (list.json?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
  if (!existing) fail(`GoTrue refused the user (HTTP ${created.status}): ${JSON.stringify(created.json)}`);
  userId = existing.id;
  const updated = await call(`/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: { password, email_confirm: true, user_metadata: { ...(existing.user_metadata ?? {}), ...metadata } },
  });
  if (updated.status >= 300) fail(`could not update the existing user (HTTP ${updated.status})`);
  action = "updated (new password)";
}

// First sign-in: joins the workspace of the email domain (ensure_workspace).
const session = await call("/auth/v1/token?grant_type=password", { method: "POST", token: anon, apikey: anon, body: { email, password } });
const accessToken = session.json?.access_token;
if (!accessToken) fail(`sign-in failed (HTTP ${session.status})`);
const workspace = await call("/rest/v1/rpc/ensure_workspace", { method: "POST", token: accessToken, apikey: anon, body: {} });
if (workspace.status >= 300) fail(`ensure_workspace failed (HTTP ${workspace.status})`);
if (role === "admin") {
  const promote = await call(`/rest/v1/profiles?id=eq.${userId}`, { method: "PATCH", body: { role: "admin" } });
  if (promote.status >= 300) fail(`could not make the user admin (HTTP ${promote.status})`);
}
const current = await call("/rest/v1/rpc/current_profile_role", { method: "POST", token: accessToken, apikey: anon, body: {} });

console.log(`User ${action}:
  email:     ${email}
  password:  ${password}
  role:      ${current.json ?? role}
  workspace: ${workspace.json}
Sign in at http://localhost:${process.env.APP_PORT ?? "3000"}/login, then Settings › Integrations › LinkedIn to connect their own LinkedIn.`);
