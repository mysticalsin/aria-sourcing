import { expect, test } from "@playwright/test";
import path from "node:path";

test("uploading a synthetic CV shows the parsed candidate", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aria:onboarded:v1", "1");
  });
  await page.goto("/candidates");
  await page.getByRole("button", { name: "Upload CV" }).click();
  await page.getByLabel("CV file").setInputFiles(path.join(__dirname, "fixtures", "casey-example.pdf"));
  await expect(page.getByText("Casey Example")).toBeVisible();
});
