import { defineConfig } from "@playwright/test";

// Criteria audit (dashboard, criterion 4) against an already running stand:
// the local demo by default, the official Docker site with CRITERIA_MODE=official.
const reports = process.env.CRITERIA_REPORT_DIR || "reports/criteria";
export default defineConfig({
  testDir: "./tests/criteria-e2e",
  workers: 1,
  timeout: 180000,
  outputDir: process.env.CRITERIA_PW_OUTPUT || "test-results/criteria",
  reporter: [["line"], ["json", { outputFile: `${reports}/k4-playwright-${process.env.CRITERIA_MODE || "demo"}.json` }]],
  use: {
    baseURL: process.env.CRITERIA_BASE_URL || "http://127.0.0.1:5173",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
});
