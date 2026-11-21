import { defineConfig } from "@playwright/test";

const logDir = process.env.ARIA_E2E_LOG_DIR ?? "e2e-artifacts/local";

export default defineConfig({
  testDir: "e2e",
  retries: 0,
  workers: 1,
  timeout: 180_000,
  outputDir: `${logDir}/test-results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${logDir}/report`, open: "never" }],
    ["json", { outputFile: `${logDir}/playwright-report.json` }],
  ],
  use: {
    baseURL: process.env.ARIA_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
});
