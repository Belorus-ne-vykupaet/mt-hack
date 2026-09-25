import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/official-e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    viewport: { width: 1500, height: 1000 },
  },
});
