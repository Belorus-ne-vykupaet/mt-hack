import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/api-e2e",
  outputDir: "test-results-api",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5175",
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm api:serve",
      url: "http://127.0.0.1:8083/api/v1/health",
      reuseExistingServer: false,
      env: {
        API_PORT: "8083",
        API_FROZEN: "true",
        API_JOURNAL: "test-results-api/journal.json",
        API_ORIGINS: "http://127.0.0.1:5175",
        WEATHER_ENABLED: "false",
      },
    },
    {
      command: "pnpm dev --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: "http://127.0.0.1:8083" },
    },
  ],
});
