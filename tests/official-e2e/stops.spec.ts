import { test, expect } from "@playwright/test";

test("opens only forecast stops promptly, deduplicates visits and keeps each stop’s risk", async ({ page, request }) => {
  const catalog = await (await request.get("/api/v1/routes")).json();
  const route = catalog.items[0];
  const stops = Array.from({length: 5000}, (_, i) => ({
    id: `test-stop-${i}`, name: `Проверочная ${String(i % 500).padStart(4, "0")}`,
    sequence: i, position: { lon: 37.6 + (i % 500) * .0001, lat: 55.7 },
  }));
  const fleet = await (await request.get("/api/v1/vehicles")).json();
  const vehicle = { ...fleet.items[0], route_id: route.id, next_stop: stops[500],
    predicted_delay_sec: 300, risk_level: "high", risk_probability: .9, status: "active", forecast_status: "ready" };
  await page.route("**/api/v1/vehicles", r => r.fulfill({json: {...fleet, items: [vehicle, {...vehicle, id: "test-normal", next_stop: stops[499], predicted_delay_sec: 20, risk_level: "normal", risk_probability: .1}]}}));
  await page.routeWebSocket("**", () => {});
  await page.route("**/api/v1/routes", r => r.fulfill({json: {...catalog, items: [{...route, stops}]}}));
  await page.goto("/overview?source=official");
  await expect(page.locator(".summary-strip")).toBeVisible();
  const started = Date.now();
  await page.getByRole("button", {name: "Остановки", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Остановки сети 2"})).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(page.locator(".network-list-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".network-list-table .risk-badge.high")).toHaveCount(1);
  await expect(page.locator(".network-list-table .risk-badge.unknown")).toHaveCount(0);
  await page.getByLabel("Поиск в полном списке").fill("Проверочная 0499");
  await expect(page.locator(".network-list-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".network-list-table tbody tr")).toContainText("Проверочная 0499");
  await expect(page.locator(".network-list-table tbody tr")).toContainText("Норма");
  await page.getByRole("button", {name: "Открыть Проверочная 0499", exact: true}).click();
  await expect(page.locator(".network-list-dialog")).toHaveCount(0);
  await expect(page.locator(".detail-panel")).toBeVisible();
});
