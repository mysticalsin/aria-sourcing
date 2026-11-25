import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { assertHarnessUrls, isLoopbackRequestUrl } from "./loopback-url.mjs";

const artifactDir = process.env.ARTIFACT_DIR ?? "e2e-artifacts/local";
const sink: { calls: number } = { calls: 0 };

type Step = { id: string; status: "pass" | "fail"; detail: string; screenshot: string };

async function shot(page: Page, id: string): Promise<string> {
  const path = join(artifactDir, "screenshots", `${id}.png`);
  mkdirSync(join(artifactDir, "screenshots"), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  return `screenshots/${id}.png`;
}

test("sweep 0 physical journeys", async ({ page }) => {
  test.setTimeout(240_000);
  assertHarnessUrls({
    appUrl: process.env.APP_URL ?? "http://127.0.0.1:3000",
    odooUrl: process.env.ODOO_URL ?? "",
  });
  mkdirSync(artifactDir, { recursive: true });
  const steps: Step[] = [];
  await page.route("**/api/outreach/send", async (route) => {
    const url = route.request().url();
    if (!isLoopbackRequestUrl(url)) {
      throw new Error("non-loopback send aborted");
    }
    sink.calls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sink: "fake" }) });
  });

  async function run(id: string, body: () => Promise<string>) {
    try {
      const detail = await body();
      const screenshot = await shot(page, id);
      steps.push({ id, status: "pass", detail, screenshot });
    } catch (error) {
      const screenshot = await shot(page, id).catch(() => "");
      steps.push({ id, status: "fail", detail: error instanceof Error ? error.message : String(error), screenshot });
    }
  }

  await run("create-need", async () => {
    await page.goto("/campaigns/new");
    await page.getByRole("button", { name: "Sample backend role", exact: true }).click();
    await page.getByRole("button", { name: "Parse JD", exact: true }).click();
    const title = page.getByLabel("Role title", { exact: true });
    await title.fill("Synthetic platform role");
    await page.getByRole("button", { name: "Create campaign", exact: true }).click();
    await expect(page.getByText("Campaign created").first()).toBeVisible();
    return "toast confirmed the synthetic role was created";
  });

  await run("import-candidate", async () => {
    await page.getByRole("tab", { name: /^Candidates/ }).click();
    await page.getByRole("button", { name: "Add candidate", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add a candidate" });
    await dialog.getByRole("tab", { name: "Manual", exact: true }).click();
    await dialog.locator("[id$='-manual-name']").fill("Ada Example");
    await dialog.locator("[id$='-manual-email']").fill("ada.example@example.test");
    await dialog.locator("[id$='-manual-lawful-basis']").selectOption("consent");
    const submit = dialog.getByRole("button", { name: "Add candidate", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Added Ada Example").first()).toBeVisible();
    return "synthetic candidate Ada Example added through the manual intake form";
  });

  await run("ranking-reasons", async () => {
    await page.getByText("Ada Example").first().click();
    const reason = page.getByText(/score|match|why/i).first();
    await expect(reason).toBeVisible();
    return "candidate surface shows a score or reason";
  });

  await run("draft-outreach", async () => {
    await page.goto("/outreach");
    const draft = page.getByRole("button", { name: /draft/i }).first();
    await expect(draft).toBeVisible();
    return "outreach draft control is on the page";
  });

  await run("manual-approval", async () => {
    const approve = page.getByRole("button", { name: /^Approve/ }).first();
    await expect(approve).toBeVisible();
    await approve.click();
    return "approval click accepted";
  });

  await run("fake-sink-send", async () => {
    const send = page.getByRole("button", { name: /send/i }).first();
    if (await send.count() === 0) throw new Error("no send control is wired to the fake sink");
    await send.click();
    if (sink.calls !== 1) throw new Error(`fake sink calls=${sink.calls}`);
    return "one call reached the loopback sink";
  });

  await run("auto-blocked", async () => {
    const body = await page.locator("body").innerText();
    if (!/manual/i.test(body)) throw new Error("manual mode is not shown");
    return "manual remains the visible default";
  });

  await run("heyreach-off", async () => {
    const body = await page.locator("body").innerText();
    if (!/HeyReach/i.test(body)) {
      await page.goto("/");
    }
    const text = await page.locator("body").innerText();
    if (!/HeyReach/i.test(text) || /HeyReach[^.]{0,40}On/i.test(text)) {
      throw new Error("HeyReach is not shown off");
    }
    return "HeyReach is shown off";
  });

  await run("linkedin-token", async () => {
    await page.goto("/channels/linkedin-token");
    await expect(page.getByRole("heading", { name: /LinkedIn token/i })).toBeVisible();
    const act = page.getByRole("button", { name: "Act as admin" });
    const sw = page.getByRole("switch").first();
    await expect(act.or(sw)).toBeVisible();
    if (await act.isVisible()) await act.click();
    await expect(sw).toBeVisible();
    await expect(page.getByRole("button", { name: "Kill switch" })).toBeVisible();
    const checked = await sw.getAttribute("aria-checked");
    if (checked === "true") throw new Error("token toggle defaulted on");
    return "toggle is off by default";
  });

  await run("kill-switch", async () => {
    const button = page.getByRole("button", { name: "Kill switch" });
    await expect(button).toBeVisible();
    return "kill switch control is present";
  });

  await run("quick-stats", async () => {
    await page.goto("/");
    const tour = page.getByRole("dialog", { name: "Welcome to Aria" });
    if (await tour.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Skip" }).click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const stats = page.getByRole("region", { name: "Quick stats" });
    const toRate = stats.getByTestId("quick-stat-toRate");
    await expect(toRate).toBeVisible();
    await expect(toRate).not.toHaveText("");
    await toRate.click({ trial: true });
    await page.goto("/outreach");
    await page.goto("/");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(stats.getByTestId("quick-stat-hires")).toBeVisible();
    for (const label of ["Candidates to rate", "In assessment", "Interviews this week", "Outreach awaiting approval", "Replies", "Hires"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    return "quick-stat numbers stay visible after the tour is dismissed";
  });

  await run("cv-upload", async () => {
    await page.goto("/candidates");
    await page.getByLabel("CV file").setInputFiles(resolve(__dirname, "../fixtures/casey-example.pdf"));
    await expect(page.getByText("Casey Example").first()).toBeVisible({ timeout: 20_000 });
    return "synthetic CV parsed to Casey Example";
  });

  await run("odoo-pipeline", async () => {
    const odoo = process.env.ODOO_URL;
    if (!odoo) throw new Error("Odoo UI is not part of this Next session");
    await page.goto(odoo);
    return page.url();
  });

  await run("gdpr", async () => {
    const body = await page.locator("body").innerText();
    if (!/opt-out|erasure|delete my data/i.test(body)) {
      throw new Error("no GDPR opt-out or erasure control on the Next surface");
    }
    return "GDPR control visible";
  });

  writeFileSync(join(artifactDir, "journey-matrix.json"), JSON.stringify({ steps, sinkCalls: sink.calls }, null, 2));
  const failed = steps.filter((step) => step.status === "fail");
  if (failed.length) {
    throw new Error(failed.map((step) => `${step.id}: ${step.detail}`).join("\n"));
  }
});
