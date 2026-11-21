import { defineConfig } from "@playwright/test";

const artifactDir = process.env.ARTIFACT_DIR ?? "e2e-artifacts/local";

export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: `${artifactDir}/playwright-report`, open: "never" }]],
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:3000",
    headless: false,
    viewport: { width: 1280, height: 800 },
    trace: "on",
    screenshot: "off",
    actionTimeout: 15_000,
  },
  outputDir: `${artifactDir}/test-results`,
});
