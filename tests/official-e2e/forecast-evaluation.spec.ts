import { test, expect } from "@playwright/test";

test("the forecast journal renders real paired outcomes in both themes", async ({ page, request }) => {
  const response = await request.get("/api/v1/analytics/forecast-evaluation");
  expect(response.ok()).toBeTruthy();
  const journal = await response.json();
  for (const row of journal.items) {
    expect(row.horizonSec).toBeGreaterThan(600);
    expect(row.horizonSec).toBeLessThanOrEqual(900);
    if (row.status === "observed") {
      expect(Date.parse(row.actualArrivalAt)).toBeLessThanOrEqual(Date.parse(row.observedAt));
      expect(Date.parse(row.observedAt)).toBeLessThanOrEqual(Date.parse(journal.asOf));
      expect(row.absoluteErrorSec).toBeCloseTo(Math.abs(row.predictedDelaySec - row.actualDelaySec), 6);
    } else {
      expect(row.actualDelaySec).toBeNull();
      expect(row.absoluteErrorSec).toBeNull();
    }
  }
  // Freeze this real response while exercising UI themes, independently of replay speed.
  await page.route("**/api/v1/analytics/forecast-evaluation*", route => route.fulfill({ json: journal }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/analytics?source=official");
  const panel = page.getByTestId("forecast-evaluation");
  await expect(panel).toContainText(`Подтверждено ${journal.summary.observed} из ${journal.summary.total}`);
  if (journal.summary.observed) {
    await expect(panel.getByRole("img")).toBeVisible();
    await expect(panel).toContainText(`${journal.summary.maeSec.toFixed(1)} с`);
  }
  for (const name of ["Включить тёмную тему", "Включить светлую тему"]) {
    await page.getByRole("button", { name }).click();
    await expect(panel).toBeVisible();
  }
  expect(errors).toEqual([]);
  const filtered = await (await request.get("/api/v1/analytics/forecast-evaluation?route_id=duty-nonexistent")).json();
  expect(filtered.summary.total).toBe(0);
  expect(filtered.summary.maeSec).toBeNull();
  expect(filtered.items).toEqual([]);
});

test("a journal outage is visible and can be retried", async ({ page, request }) => {
  const journal = await (await request.get("/api/v1/analytics/forecast-evaluation")).json();
  let available = false;
  await page.route("**/api/v1/analytics/forecast-evaluation*", route => available
    ? route.fulfill({ json: journal })
    : route.fulfill({ status: 500, json: { error: { message: "Unavailable" } } }));
  await page.goto("/analytics?source=official");
  const panel = page.getByTestId("forecast-evaluation");
  await expect(panel.getByRole("alert")).toContainText("Журнал временно недоступен");
  available = true;
  await panel.getByRole("button", { name: "Повторить" }).click();
  await expect(panel).toContainText(`Подтверждено ${journal.summary.observed} из ${journal.summary.total}`);
});
