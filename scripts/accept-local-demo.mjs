// Real Docker/browser acceptance, confined to a uniquely named disposable stack.
// No external search, LLM, email, or calendar provider is called.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const project = process.env.ARIA_ACCEPTANCE_PROJECT ?? "";
if (process.env.ARIA_LOCAL_ACCEPTANCE !== "1" || !/^aria-acceptance-[a-z0-9-]{4,80}$/.test(project)) {
  throw new Error("Acceptance requires ARIA_LOCAL_ACCEPTANCE=1 and a unique ARIA_ACCEPTANCE_PROJECT=aria-acceptance-...; never use your normal workspace.");
}
const compose = (args, capture = false) => execFileSync("docker", ["compose", "-p", project, "-f", "docker-compose.yml", ...args], { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
const config = JSON.parse(compose(["config", "--format", "json"], true));
assert.equal(config.name, project);
for (const volume of Object.values(config.volumes)) {
  assert.equal(Boolean(volume.external), false);
  assert.ok(volume.name.startsWith(project + "_"), "Refuse cleanup of a volume outside the acceptance project.");
}
const env = config.services.app.environment;
const baseUrl = env.NEXT_PUBLIC_APP_URL;
const backend = env.NEXT_PUBLIC_SUPABASE_URL;
for (const value of [baseUrl, backend]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(value).hostname));
const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const marker = "Senior Backend Engineer acceptance " + randomUUID();
const fakeKey = "sk-aria-acceptance-" + randomUUID().replaceAll("-", "");
let browser;
let started = false;
let keyId;
let campaignId;
let candidateId;
let encrypted;

async function loginApi() {
  const response = await fetch(backend + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: publicKey, "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@hermes.local", password: env.DEMO_ADMIN_PASSWORD }), signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Seeded administrator must authenticate.");
  return (await response.json()).access_token;
}
async function rest(path, token) {
  const response = await fetch(backend + "/rest/v1/" + path, { headers: { apikey: token === serviceKey ? serviceKey : publicKey, authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, "Authenticated REST read failed.");
  return response.json();
}
async function persisted(token) {
  const rows = await rest("workspace_state?select=state", token);
  return rows[0]?.state;
}
async function until(check, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(label);
}
async function openSession() {
  browser = await chromium.launch({ headless: true, ...(process.env.ARIA_BROWSER_CHANNEL ? { channel: process.env.ARIA_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return [new URL(baseUrl).origin, new URL(backend).origin].includes(origin) ? route.continue() : route.abort();
  });
  await page.route("**/api/sourcing-agent", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SOURCING_AGENT_NOT_CONFIGURED" }) }));
  await page.route("**/api/hermes/chat", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "AI provider acceptance is a separate test." }) }));
  await page.goto(baseUrl + "/login", { waitUntil: "networkidle" });
  await page.getByLabel("Username or email").fill("admin@hermes.local");
  await page.getByLabel("Password", { exact: true }).fill(env.DEMO_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  await page.waitForLoadState("networkidle");
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  if (await skip.isVisible()) await skip.click();
  return page;
}
try {
  started = true;
  compose(["up", "--build", "--detach", "--wait", "--wait-timeout", "300"]);
  assert.equal((await fetch(baseUrl + "/api/ready")).status, 200);
  assert.equal((await fetch(baseUrl + "/api/setup/status")).status, 401, "Setup details must require authentication.");
  let page = await openSession();
  let token = await loginApi();
  await page.goto(baseUrl + "/settings?tab=workspace", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Check connections", exact: true }).click();
  await page.getByText("Core workspace ready", { exact: true }).waitFor();
  await page.goto(baseUrl + "/intake", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sample backend role", exact: true }).click();
  await page.getByRole("button", { name: "Parse JD", exact: true }).click();
  await page.getByLabel("Role title", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Create campaign", exact: true }).click();
  await page.waitForURL(/\/campaigns\/[^/]+$/);
  const campaign = await until(async () => (await persisted(token))?.campaigns?.find((item) => item.title === marker), "Campaign did not persist after UI creation.");
  campaignId = campaign.id;
  await page.getByRole("tab", { name: /^Candidates/ }).click();
  await page.getByRole("button", { name: "Add candidate", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a candidate" });
  await dialog.getByRole("tab", { name: "Manual", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill(marker + " Person");
  await dialog.getByLabel("Lawful basis", { exact: true }).selectOption("consent");
  await dialog.getByRole("button", { name: "Add candidate", exact: true }).click();
  const candidate = await until(async () => (await persisted(token))?.candidates?.find((item) => item.name === marker + " Person"), "Candidate did not persist.");
  candidateId = candidate.id;
  const saved = await page.evaluate(async ({ value, name }) => {
    const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "OpenAI", name, value }) });
    return { status: response.status, body: await response.json() };
  }, { value: fakeKey, name: marker });
  assert.equal(saved.status, 200, "Credential storage must work without a manually supplied encryption key.");
  keyId = saved.body.id;
  const stored = await rest("api_keys?id=eq." + keyId + "&select=secret", serviceKey);
  encrypted = stored[0].secret;
  assert.match(encrypted, /^enc:v2:/);
  assert.notEqual(encrypted, fakeKey);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal((await persisted(token)).campaigns.filter((item) => item.id === campaignId).length, 1);
  await browser.close(); browser = undefined;
  compose(["down"]); // Preserve both volumes; this is the restart acceptance.
  compose(["up", "--detach", "--wait", "--wait-timeout", "300"]);
  page = await openSession();
  token = await loginApi();
  const restored = await persisted(token);
  assert.equal(restored.campaigns.filter((item) => item.id === campaignId).length, 1);
  assert.equal(restored.candidates.filter((item) => item.id === candidateId).length, 1);
  assert.equal((await rest("api_keys?id=eq." + keyId + "&select=secret", serviceKey))[0].secret, encrypted);
  const tested = await page.evaluate(async (id) => {
    const response = await fetch("/api/keys/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    return { status: response.status, body: await response.json() };
  }, keyId);
  assert.equal(tested.status, 200);
  assert.equal(tested.body.valid, true, "Stored synthetic OpenAI key must decrypt and pass format-only validation after restart.");
  await page.goto(baseUrl + "/campaigns/" + campaignId, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /^Candidates/ }).click();
  await until(async () => await page.locator("tbody tr").count() === 1, "Persisted candidate did not render after a fresh login.");
  console.log(JSON.stringify({ ok: true, checks: ["clean-start", "readiness", "browser-login", "ui-campaign", "ui-candidate", "encrypted-credential", "browser-refresh", "stack-restart", "fresh-login", "restored-state", "credential-decryption"], externalProviderCalls: 0 }));
} catch (error) {
  console.error("Local demo acceptance failed:", error.message);
  if (started) compose(["ps", "--all"]);
  throw error;
} finally {
  if (browser) await browser.close();
  // Only this guarded, uniquely named acceptance project can reach volume cleanup.
  if (started) compose(["down", "--volumes", "--remove-orphans"]);
}
