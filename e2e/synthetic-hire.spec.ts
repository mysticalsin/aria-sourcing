import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const shots = process.env.ARIA_E2E_SHOT_DIR ?? "e2e-artifacts/local/screenshots";

async function shot(page: Page, name: string) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

function hostsOf(text: string): string[] {
  return text.split(/\s+/).map((item) => item.trim()).filter((item) => item.length > 0);
}

/** Same host check as the synthetic hire unit test: parse the URL, then compare the registrable domain. */
function registrableHostCount(source: string, domain: string): number {
  let count = 0;
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>)]+/g)) {
    let host = "";
    try {
      host = new URL(match[0]).hostname;
    } catch {
      continue;
    }
    const labels = host.split(".").filter((label) => label.length > 0);
    if (labels.slice(-2).join(".") === domain) count += 1;
  }
  return count;
}

test("forge skip gate: retries stay at zero", () => {
  const config = readFileSync("playwright.config.ts", "utf8");
  expect(config.includes("retries: 0")).toBe(true);
});

test("the synthetic hire demo closes the fixture vacancy without a live connector", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    let hostname = "";
    try {
      hostname = new URL(request.url()).hostname;
    } catch {
      outside.push(request.url());
      return;
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost") outside.push(request.url());
  });

  await page.goto("/demo/hire");
  await expect(page.getByRole("heading", { name: "Synthetic sourcing to hired" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("fixture-applicant")).toHaveText("Fixture Candidate North");
  await expect(page.getByText("LinkedIn calls: 0")).toBeVisible();
  await shot(page, "01-synthetic-hire");

  await expect(page.getByTestId("selected-connector")).toHaveText("odoo");
  await expect(page.getByTestId("odoo-result")).toContainText("ok");
  await expect(page.getByTestId("odoo-result")).toContainText("erp odoo");
  await expect(page.getByTestId("odoo-result")).toContainText("linkedIn true");
  await expect(page.getByTestId("odoo-step-hire")).toContainText("hr.job");
  await expect(page.getByTestId("odoo-step-hire")).toContainText("write");
  await expect(page.getByTestId("odoo-step-hire")).toContainText("written");

  const jobId = (await page.getByTestId("job-create-id").textContent())?.trim() ?? "";
  const hireId = (await page.getByTestId("hire-record-id").textContent())?.trim() ?? "";
  const write = JSON.parse((await page.getByTestId("vacancy-write").textContent())?.trim() ?? "null") as unknown;
  const kwargs = JSON.parse((await page.getByTestId("vacancy-kwargs").textContent())?.trim() ?? "null") as unknown;
  expect(jobId).toMatch(/^[1-9]\d*$/);
  expect(hireId).toBe(jobId);
  expect(write).toEqual([[Number(jobId)], { no_of_recruitment: 0 }]);
  expect(kwargs).toEqual({});
  expect(JSON.stringify(write).includes("state")).toBe(false);
  expect(JSON.stringify(kwargs).includes("state")).toBe(false);

  const fields = ((await page.getByTestId("hr-job-fields").textContent()) ?? "").split(",").map((field) => field.trim());
  expect(fields).toContain("no_of_recruitment");
  expect(fields).not.toContain("state");
  await expect(page.getByTestId("hr-job-state-sent")).toHaveText("no");

  for (const host of hostsOf((await page.getByTestId("odoo-hosts").textContent()) ?? "")) {
    expect(host).toBe("https://odoo.example.test/jsonrpc");
  }

  const unset = JSON.parse((await page.getByTestId("unset-result").textContent())?.trim() ?? "null") as unknown;
  expect(unset).toEqual({ ok: true, erp: "skipped", linkedIn: true });
  await expect(page.getByTestId("unset-fetches")).toHaveText("0");

  for (const erp of ["smart", "api", "mcp"] as const) {
    await expect(page.getByTestId(`connector-${erp}-outcome`)).toHaveText("hired");
    const hosts = hostsOf((await page.getByTestId(`connector-${erp}-hosts`).textContent()) ?? "");
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      const url = new URL(host);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(".example.test")).toBe(true);
    }
  }
  await expect(page.getByTestId("connector-smart")).toContainText("SMART");
  await expect(page.getByTestId("connector-api")).toContainText("generic HTTPS API");
  await expect(page.getByTestId("connector-mcp")).toContainText("MCP");

  const html = await page.content();
  expect(registrableHostCount(html, "linkedin.com")).toBe(0);
  expect(registrableHostCount(html, "azure.com")).toBe(0);
  expect(outside).toEqual([]);
  await shot(page, "02-connectors-hired");
});
