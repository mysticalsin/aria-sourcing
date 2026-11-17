#!/usr/bin/env node
// Demo accounts for the public demo URL (docs/ngrok-demo.md).
//
// For i = 1..N: the account demo<i>@aria-demo<i>.test, with a fresh password.
// Its own email domain gives it its own workspace (public.ensure_workspace
// keys workspaces by domain), so testers never see each other's work nor the
// owner's workspace. The script:
//   1. creates the account, or resets its password (GoTrue admin API);
//   2. signs in once in a headless browser, so the app itself provisions the
//      workspace and its initial state, exactly as for a real first login;
//   3. copies the owner workspace's Anthropic key into that workspace (the
//      encrypted row, never the plain key) and makes it the AI provider key.
// It also sets the owner account's password to DEMO_ADMIN_PASSWORD from .env,
// so the published sample password stops working.
//
// The account list (emails, passwords) is written to .demo-accounts.local.md
// (gitignored) and printed once.
//
// Run, stack up with rotated keys (scripts/tunnel-keys.mjs):
//   docker run --rm --network host -v "$PWD":/app -v aria_gate_node_modules:/app/node_modules -w /app \
//     mcr.microsoft.com/playwright:v1.61.1-noble node scripts/demo-accounts.mjs [--count 5]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OWNER_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_EMAIL = "admin@aria.local";

function readEnvFile(path) {
  const entries = {};
  if (!existsSync(path)) return entries;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

const fileEnv = readEnvFile(".env");
const env = (key, fallback = "") => process.env[key] || fileEnv[key] || fallback;

const argCount = process.argv.indexOf("--count");
const COUNT = argCount > 0 ? Number(process.argv[argCount + 1]) : 5;
const API = env("ARIA_API_URL", "http://localhost:54321");
const APP = env("ARIA_APP_URL", "http://localhost:3000");
const SERVICE_KEY = env("SUPABASE_SERVICE_KEY");
const OWNER_PASSWORD = env("DEMO_ADMIN_PASSWORD");
const PUBLIC_URL = env("NGROK_DOMAIN") ? `https://${env("NGROK_DOMAIN")}` : "(set NGROK_DOMAIN in .env)";

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 20) {
  console.error("--count must be between 1 and 20.");
  process.exit(1);
}
if (!SERVICE_KEY || env("ARIA_KEYS_ROTATED") !== "true") {
  console.error("Run scripts/tunnel-keys.mjs first, then recreate the stack (docker compose up -d --build).");
  process.exit(1);
}

const admin = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...admin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

function password(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(length), (b) => alphabet[b % alphabet.length]).join("");
}

async function listUsers() {
  const res = await call("GET", "/auth/v1/admin/users?per_page=1000");
  if (res.status !== 200) throw new Error(`GoTrue admin list users: HTTP ${res.status}`);
  return res.json.users ?? [];
}

async function upsertUser(users, email, pw) {
  const existing = users.find((u) => u.email === email);
  const res = existing
    ? await call("PUT", `/auth/v1/admin/users/${existing.id}`, { password: pw, email_confirm: true })
    : await call("POST", "/auth/v1/admin/users", { email, password: pw, email_confirm: true });
  if (res.status !== 200 && res.status !== 201) throw new Error(`GoTrue admin ${email}: HTTP ${res.status}`);
  return res.json.id;
}

async function rest(method, path, body, prefer) {
  const res = await call(method, `/rest/v1/${path}`, body, prefer ? { Prefer: prefer } : {});
  if (res.status >= 300) throw new Error(`REST ${method} ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json;
}

/** Sign in once and keep the page open until the app has saved the workspace state. */
async function firstLogin(browser, email, pw, userId) {
  const page = await (await browser.newContext()).newPage();
  try {
    await page.goto(`${APP}/login`, { waitUntil: "load" });
    await page.fill("#login-username", email);
    await page.fill("#login-password", pw);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    return await waitForWorkspaceState(userId);
  } finally {
    await page.context().close();
  }
}

async function waitForWorkspaceState(userId) {
  for (let i = 0; i < 120; i++) {
    const [profile] = await rest("GET", `profiles?id=eq.${userId}&select=workspace_id`);
    if (profile?.workspace_id) {
      const [row] = await rest("GET", `workspace_state?workspace_id=eq.${profile.workspace_id}&select=workspace_id,state`);
      if (row) return row;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the app did not provision the workspace state after sign-in");
}

/** The owner's tested Anthropic key row (ciphertext), copied as is. */
async function ownerAnthropicKey() {
  const [row] = await rest(
    "GET",
    `api_keys?workspace_id=eq.${OWNER_WORKSPACE_ID}&provider=eq.Anthropic&status=eq.valid&select=name,provider,secret,last4,status,last_tested_at&order=created_at.desc&limit=1`,
  );
  if (!row) throw new Error("the owner workspace has no valid Anthropic key (Settings > Access & Keys)");
  return row;
}

async function giveAnthropicKey(workspaceRow, sourceKey, label) {
  const wid = workspaceRow.workspace_id;
  let [key] = await rest("GET", `api_keys?workspace_id=eq.${wid}&provider=eq.Anthropic&status=eq.valid&select=id,name,last4,status,provider,created_at,created_by,last_tested_at&limit=1`);
  if (!key) {
    [key] = await rest(
      "POST",
      "api_keys?select=id,name,last4,status,provider,created_at,created_by,last_tested_at",
      { ...sourceKey, workspace_id: wid, name: "Claude key (demo)", created_by: "demo-accounts" },
      "return=representation",
    );
  }
  const state = workspaceRow.state ?? {};
  const meta = {
    id: key.id,
    name: key.name,
    last4: key.last4,
    status: key.status,
    provider: key.provider,
    createdAt: key.created_at,
    createdBy: key.created_by,
    lastTestedAt: key.last_tested_at,
  };
  state.apiKeys = [...(state.apiKeys ?? []).filter((k) => k.provider !== "Anthropic"), meta];
  state.settings = state.settings ?? {};
  state.settings.operatorName = label;
  state.settings.llmProviders = (state.settings.llmProviders ?? []).map((p) =>
    p.kind === "Anthropic" ? { ...p, enabled: true, isDefault: true, apiKeyId: key.id } : p,
  );
  if (!state.settings.llmProviders.some((p) => p.kind === "Anthropic")) {
    throw new Error("the workspace state has no Anthropic provider entry");
  }
  await rest("PATCH", `workspace_state?workspace_id=eq.${wid}`, { state });
}

async function main() {
  const { chromium } = await import("playwright");
  const users = await listUsers();

  const owner = users.find((u) => u.email === OWNER_EMAIL);
  if (owner && OWNER_PASSWORD) {
    const res = await call("PUT", `/auth/v1/admin/users/${owner.id}`, { password: OWNER_PASSWORD });
    if (res.status !== 200) throw new Error(`owner password: HTTP ${res.status}`);
    console.log(`Owner ${OWNER_EMAIL}: password set from DEMO_ADMIN_PASSWORD (.env).`);
  }

  const sourceKey = await ownerAnthropicKey();
  const browser = await chromium.launch();
  const accounts = [];
  try {
    for (let i = 1; i <= COUNT; i++) {
      const email = `demo${i}@aria-demo${i}.test`;
      const pw = password(14);
      const userId = await upsertUser(users, email, pw);
      const row = await firstLogin(browser, email, pw, userId);
      await giveAnthropicKey(row, sourceKey, `Demo ${i}`);
      accounts.push({ email, pw });
      console.log(`  ${email} ready (own workspace, Claude key set).`);
    }
  } finally {
    await browser.close();
  }

  const lines = [
    "# ARIA demo accounts (local only, gitignored)",
    "",
    `URL: ${PUBLIC_URL}`,
    "",
    "| Account | Password |",
    "| --- | --- |",
    ...accounts.map((a) => `| ${a.email} | ${a.pw} |`),
    "",
    "Each account has its own empty workspace. Passwords change every time scripts/demo-accounts.mjs runs.",
    "",
  ];
  writeFileSync(".demo-accounts.local.md", lines.join("\n"), { mode: 0o600 });
  console.log(`\n${lines.join("\n")}`);
}

main().catch((error) => {
  console.error(`demo-accounts: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
