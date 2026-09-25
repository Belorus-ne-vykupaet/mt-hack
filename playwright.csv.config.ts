import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/csv-e2e",
  outputDir: "test-results-csv",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    env: { VITE_MOCK_SCENARIO: "csv" },
    reuseExistingServer: false,
  },
});
