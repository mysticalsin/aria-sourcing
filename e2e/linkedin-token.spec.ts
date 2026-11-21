/// <reference path="../src/channels/linkedin-token/node-sqlite.d.ts" />
import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const shots = process.env.ARIA_E2E_SHOT_DIR ?? "e2e-artifacts/local/screenshots";
const dbPath = process.env.ARIA_LINKEDIN_TOKEN_DB ?? "";
const fakeHealth = process.env.ARIA_E2E_FAKE_HEALTH ?? "";

async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

async function reset(page: Page) {
  await page.request.post("/api/channels/linkedin-token/session", { data: { role: "admin" } });
  await page.request.post("/api/channels/linkedin-token", { data: { action: "reset" } });
  await page.request.post("/api/channels/linkedin-token/session", { data: { role: "member" } });
}

async function act(page: Page, role: "admin" | "member" | "owner") {
  await page.getByRole("button", { name: `Act as ${role}` }).click();
  await expect(page.getByTestId("current-role")).toHaveText(role);
}

async function typeSecret(page: Page) {
  const secret = process.env.ARIA_E2E_FIXTURE_TOKEN ?? "";
  await page.locator("#session-token").click();
  for (const character of secret) await page.keyboard.type(character);
}

async function enable(page: Page) {
  await act(page, "admin");
  await expect(page.getByRole("switch", { name: "LinkedIn token channel" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Enable LinkedIn token channel" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("acknowledgement");
  await page.locator("#risk-ack").check();
  await page.getByRole("button", { name: "Enable LinkedIn token channel" }).click();
  await expect(page.getByRole("switch", { name: "LinkedIn token channel" })).toHaveAttribute("aria-checked", "true");
}

async function storeToken(page: Page) {
  await typeSecret(page);
  await page.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByTestId("token-status")).toContainText("not shown again");
  await expect(page.locator("#session-token")).toHaveValue("");
}

async function approve(page: Page, message: string) {
  await page.locator("#message").fill(message);
  await page.getByRole("button", { name: "Approve exact text" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("Exact text approved");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/channels/linkedin-token");
  await expect(page.getByRole("heading", { name: "LinkedIn token" })).toBeVisible();
  await reset(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Act as admin" })).toBeVisible();
});

test("the switch is off and a non-admin cannot read token status", async ({ page }) => {
  await shot(page, "01-role-member");
  await expect(page.getByTestId("current-role")).toHaveText("member");
  await expect(page.getByText("cannot enable this channel")).toBeVisible();
  const status = await page.request.get("/api/channels/linkedin-token");
  expect(status.status()).toBe(403);
  const payload = await status.json();
  expect(payload.reason).toBe("role");
  expect(payload.tokenStored).toBeUndefined();
  expect(JSON.stringify(payload).includes("ciphertext")).toBe(false);
  await shot(page, "02-non-admin-refused");
});

test("a non-admin enable is refused", async ({ page }) => {
  await page.request.post("/api/channels/linkedin-token/session", { data: { role: "member" } });
  const response = await page.request.post("/api/channels/linkedin-token", {
    data: { action: "enable", acknowledgement: "LinkedIn's User Agreement prohibits third-party session-token tools. The account may be restricted or banned." },
  });
  expect(response.status()).toBe(403);
  await page.reload();
  await expect(page.getByText("cannot enable this channel")).toBeVisible();
  await shot(page, "03-non-admin-enable");
});

test("an admin must acknowledge the risk notice", async ({ page }) => {
  await act(page, "admin");
  await shot(page, "04-switch-off");
  await expect(page.getByTestId("risk-notice")).toContainText("User Agreement prohibits third-party session-token tools");
  await expect(page.getByTestId("risk-notice")).toContainText("restricted or banned");
  await page.getByRole("button", { name: "Enable LinkedIn token channel" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("acknowledgement");
  await expect(page.getByRole("switch", { name: "LinkedIn token channel" })).toHaveAttribute("aria-checked", "false");
  await page.locator("#risk-ack").check();
  await shot(page, "05-risk-acknowledged");
  await page.getByRole("button", { name: "Enable LinkedIn token channel" }).click();
  await expect(page.getByRole("switch", { name: "LinkedIn token channel" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("list", { name: "Audit log" })).toContainText("Audit enable");
});

test("the entered token is masked and never shown again", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await shot(page, "06-token-masked");
  await page.reload();
  await act(page, "admin");
  await expect(page.getByTestId("token-status")).toContainText("not shown again");
  await expect(page.locator("#session-token")).toHaveValue("");
  const html = await page.content();
  expect(html.includes(process.env.ARIA_E2E_FIXTURE_TOKEN ?? "missing-fixture")).toBe(false);
});

test("unapproved text and a one-character edit are refused", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("approval-token");
  await shot(page, "07-unapproved");
  await approve(page, "Hello Ada, this is a synthetic note.");
  await page.locator("#message").fill("Hello Ada, this is a synthetic note!");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("binding-mismatch");
  await shot(page, "08-one-character");
});

test("an approved send reaches the fake server and is audited", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  const before = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  await approve(page, "Hello Ada, this is a synthetic note.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("send accepted");
  await expect(page.getByRole("list", { name: "Audit log" })).toContainText("Audit send");
  const after = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  expect(after.requests).toBe(before.requests + 1);
  await shot(page, "09-sent-audited");
});

test("the cap allows the send at the limit and refuses the next one", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await approve(page, "Cap note one.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("send accepted");
  await approve(page, "Cap note two.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("send accepted");
  await shot(page, "10-cap-at-limit");
  await approve(page, "Cap note three.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("daily-cap");
  await shot(page, "11-cap-exceeded");
});

test("an expired approval and a reused approval are refused", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await page.locator("#approval-seconds").fill("1");
  await approve(page, "This approval expires quickly.");
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("approval-expired");
  await shot(page, "12-expired");
  await page.locator("#approval-seconds").fill("3600");
  await approve(page, "This approval is used once.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("send accepted");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("token-used");
  await shot(page, "13-reused");
});

test("the kill switch stops a queued send and does not double-send", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  const before = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  await page.getByLabel("Hold the fake server").check();
  await approve(page, "Held synthetic note.");
  await page.getByRole("button", { name: "Queue send" }).click();
  await expect(page.getByTestId("pause-state")).toContainText("Send in progress");
  await page.locator("#message").fill("Second queued note.");
  await page.getByRole("button", { name: "Approve exact text" }).click();
  await page.getByRole("button", { name: "Queue send" }).click();
  await expect(page.getByTestId("queue-state")).toContainText("queued");
  await shot(page, "14-mid-queue");
  await page.getByRole("button", { name: "Kill switch" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("Queued sends stopped");
  await expect(page.getByTestId("queue-state")).toContainText("cancelled");
  await page.waitForTimeout(300);
  const after = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  expect(after.requests).toBe(before.requests + 1);
  await shot(page, "15-kill-switch");
});

test("a fake 429 and a challenge auto-pause the channel", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await approve(page, "Throttle this note.");
  await page.getByRole("button", { name: "Send throttled" }).click();
  await expect(page.getByTestId("pause-state")).toContainText("Paused");
  await expect(page.getByRole("list", { name: "Audit log" })).toContainText("Audit pause");
  await approve(page, "Should stay paused.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("sender-paused");
  await shot(page, "16-paused-429");
  await reset(page);
  await page.reload();
  await enable(page);
  await storeToken(page);
  await approve(page, "Challenge this note.");
  await page.getByRole("button", { name: "Send challenge" }).click();
  await expect(page.getByTestId("pause-state")).toContainText("challenge");
  await shot(page, "17-paused-challenge");
});

test("switching off purges the token row and cancels queued rows", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  await page.getByLabel("Hold the fake server").check();
  await approve(page, "Purge while this is queued.");
  await page.getByRole("button", { name: "Queue send" }).click();
  await expect(page.getByTestId("pause-state")).toContainText("Send in progress");
  await page.getByRole("button", { name: "Turn off and purge" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("Token purged");
  await expect(page.getByRole("switch", { name: "LinkedIn token channel" })).toHaveAttribute("aria-checked", "false");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const workspace = db.prepare("select token_ciphertext, enabled from linkedin_token_workspace where workspace_id = ?").get("synthetic-workspace") as {
    token_ciphertext: string | null;
    enabled: number;
  };
  const rows = db.prepare("select status from linkedin_token_queue where workspace_id = ?").all("synthetic-workspace") as { status: string }[];
  db.close();
  expect(workspace.enabled).toBe(0);
  expect(workspace.token_ciphertext).toBeNull();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.status === "cancelled")).toBe(true);
  await shot(page, "18-purged");
});

test("a timeout is an infrastructure error after one retry", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  const before = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  await approve(page, "This send is slow.");
  await page.getByRole("button", { name: "Send slow" }).click();
  await expect(page.getByTestId("channel-notice")).toContainText("infrastructure-timeout", { timeout: 20_000 });
  const after = await fetch(fakeHealth).then((response) => response.json() as Promise<{ requests: number }>);
  expect(after.requests).toBe(before.requests + 2);
  await shot(page, "19-timeout");
});

test("verifier property: page output does not contain the fixture secret", async ({ page }) => {
  await enable(page);
  await storeToken(page);
  const secret = process.env.ARIA_E2E_FIXTURE_TOKEN ?? "";
  const html = await page.content();
  const status = await page.request.get("/api/channels/linkedin-token");
  const payload = JSON.stringify(await status.json());
  expect(html.includes(secret)).toBe(false);
  expect(payload.includes(secret)).toBe(false);
});

test("forge skip gate: retries stay at zero", () => {
  const config = readFileSync("playwright.config.ts", "utf8");
  expect(config.includes("retries: 0")).toBe(true);
});
