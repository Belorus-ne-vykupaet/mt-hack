// Drives the app inside the emulator's WebView: overview, then the dispatcher.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.waitForSelector(".header", { timeout: 90000 });
await page.waitForFunction(
  () => document.querySelector(".connection")?.classList.contains("connected"),
  null,
  { timeout: 90000 },
);
await page.screenshot({ path: "android-smoke/overview.png" });
await page.evaluate(() => {
  history.pushState({}, "", "/dispatch");
  dispatchEvent(new PopStateEvent("popstate"));
});
await page.waitForSelector(".dispatch-queue-item", { timeout: 60000 });
await page.screenshot({ path: "android-smoke/dispatch.png" });
const report = await page.evaluate(() => ({
  url: location.href,
  width: innerWidth,
  horizontalScroll: document.documentElement.scrollWidth > innerWidth,
  queue: document.querySelectorAll(".dispatch-queue-item").length,
  decision: document.querySelector(".decision-card h4")?.textContent ?? null,
}));
writeFileSync("android-smoke/report.json", JSON.stringify({ ...report, errors }, null, 2));
console.log(report, errors);
await browser.close();
if (!report.queue || errors.length) process.exit(1);
