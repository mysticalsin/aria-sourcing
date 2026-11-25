/**
 * Local Docker demo contract.
 *
 * `docker compose up --wait` (scripts/accept-local-demo.mjs, and the start
 * command in DOCKER.md) rejects a running service with no healthcheck:
 * "container …-agents-1 has no healthcheck configured". Disabling the image
 * probe is what produced that on the odoo tip. The runner is not a web
 * server, so the replacement probe must see agents-runner, not /api/ready.
 *
 * Add candidate keeps the default LinkedIn tab mounted after Manual is
 * opened (`hidden` on the visited panel). getByLabel("Name") / "Lawful basis"
 * bind that hidden tab. The acceptance script has to target the manual ids.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("agents has a runner healthcheck so compose --wait can succeed", () => {
  const compose = read("docker-compose.yml");
  const start = compose.indexOf("\n  agents:\n");
  const end = compose.indexOf("\nvolumes:\n");
  assert.ok(start > 0 && end > start, "agents service block");
  const agents = compose.slice(start, end);
  const health = agents.slice(agents.indexOf("\n    healthcheck:\n") + 1);
  const probe = health.split("\n").filter((line) => line.startsWith("      ")).join("\n");
  assert.match(probe, /process\.kill\(1,\s*0\)/);
  assert.doesNotMatch(probe, /disable:\s*true/);
  assert.doesNotMatch(agents, /\/api\/ready/);
});

test("local demo types into the manual candidate fields", () => {
  const accept = read("scripts/accept-local-demo.mjs");
  const start = accept.indexOf('name: "Add a candidate"');
  const end = accept.indexOf("Candidate did not persist");
  assert.ok(start > 0 && end > start);
  const add = accept.slice(start, end);
  assert.match(add, /locator\(\s*"\[id\$='-manual-name'\]"\s*\)/);
  assert.match(add, /locator\(\s*"\[id\$='-manual-lawful-basis'\]"\s*\)/);
  assert.doesNotMatch(add, /getByLabel\(\s*"Name"/);
  assert.doesNotMatch(add, /getByLabel\(\s*"Lawful basis"/);
});

const dialogFixture = `<!doctype html>
<div role="dialog" aria-label="Add a candidate">
  <div role="tablist" aria-label="How to add the candidate">
    <button role="tab" aria-selected="false">LinkedIn profile</button>
    <button role="tab" aria-selected="true">Manual</button>
  </div>
  <div role="tabpanel" hidden>
    <label for="_r_8_-linkedin-name">Name</label>
    <input id="_r_8_-linkedin-name" value="" />
    <label for="_r_8_-linkedin-lawful-basis">Lawful basis</label>
    <select id="_r_8_-linkedin-lawful-basis"><option value="">Select a basis…</option><option value="consent">Consent</option></select>
  </div>
  <div role="tabpanel">
    <label for="_r_8_-manual-name">Name</label>
    <input id="_r_8_-manual-name" value="" />
    <label for="_r_8_-manual-lawful-basis">Lawful basis</label>
    <select id="_r_8_-manual-lawful-basis"><option value="">Select a basis…</option><option value="consent">Consent</option></select>
  </div>
</div>`;

test("getByLabel Name hits the hidden LinkedIn field; the manual id does not", async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent(dialogFixture);
    const dialog = page.getByRole("dialog", { name: "Add a candidate" });
    let labelError = "";
    try {
      await dialog.getByLabel("Name", { exact: true }).fill("Synthetic Person", { timeout: 1000 });
    } catch (error) {
      labelError = error instanceof Error ? error.message : String(error);
    }
    assert.match(labelError, /_r_8_-linkedin-name/);
    assert.match(labelError, /strict mode violation|not visible/);
    assert.equal(await dialog.locator("[id$='-manual-name']").inputValue(), "");
    await dialog.locator("[id$='-manual-name']").fill("Synthetic Person");
    await dialog.locator("[id$='-manual-lawful-basis']").selectOption("consent");
    assert.equal(await dialog.locator("[id$='-manual-name']").inputValue(), "Synthetic Person");
    assert.equal(await dialog.locator("[id$='-manual-lawful-basis']").inputValue(), "consent");
    assert.equal(await page.locator("#_r_8_-linkedin-name").inputValue(), "");
  } finally {
    await browser.close();
  }
});
