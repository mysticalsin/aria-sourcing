import { expect, test } from "@playwright/test";

test("dismissing the tour shows the numbers and a later visit is not covered", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("aria:onboarded:v1");
    localStorage.removeItem("hermes:onboarded:v1");
  });
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Welcome to Aria" })).toBeVisible();
  await page.goto("/campaigns");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/");
  await page.getByRole("button", { name: "Skip" }).click();
  const stats = page.getByRole("region", { name: "Quick stats" });
  const toRate = stats.getByTestId("quick-stat-toRate");
  await expect(toRate).toBeVisible();
  await expect(toRate).not.toHaveText("");
  await toRate.click({ trial: true });
  await page.goto("/outreach");
  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(stats.getByTestId("quick-stat-hires")).toBeVisible();
  await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => {
    const active = document.activeElement;
    return Boolean(active && active.closest("[role='dialog']"));
  });
  expect(trapped).toBe(false);
});
