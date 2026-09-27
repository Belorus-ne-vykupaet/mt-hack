import { test, expect } from "@playwright/test";

test("two late warnings and one early bus produce three consistent attention entries", async ({ page, request }) => {
  const fleet = await (await request.get("/api/v1/vehicles")).json();
  const catalog = await (await request.get("/api/v1/routes")).json();
  const buses = fleet.items.slice(0, 3).map((vehicle: any, i: number) => ({
    ...vehicle, predicted_delay_sec: [300, 180, -90][i], risk_probability: [.9, .7, .02][i],
    risk_level: i === 0 ? "high" : "elevated", status: "active", forecast_status: "ready",
    forecast_target_time: "2026-01-06T07:39:00Z", forecast_horizon_sec: 720,
  }));
  const routes = buses.map((v: any, i: number) => ({ ...catalog.items.find((r: any) => r.id === v.route_id),
    number: `plan-${i}`, predicted_delay_sec: v.predicted_delay_sec, risk_level: v.risk_level }));
  const alerts = buses.slice(0, 2).map((v: any, i: number) => ({
    id: `warning-${i}`, route_id: v.route_id, vehicle_id: v.id, severity: i ? "warning" : "high",
    type: "delay_risk", title: "Риск опоздания", description: "Риск опоздания",
    predicted_delay_sec: v.predicted_delay_sec, risk_probability: v.risk_probability,
    created_at: "2026-01-06T07:27:00Z", event_type: "late_threshold",
  }));
  await page.routeWebSocket("**", () => {});
  await page.route("**/api/v1/vehicles", route => route.fulfill({ json: { ...fleet, items: buses } }));
  await page.route("**/api/v1/routes", route => route.fulfill({ json: { ...catalog, items: routes } }));
  await page.route("**/api/v1/alerts", route => route.fulfill({ json: { items: alerts } }));
  await page.goto("/overview?source=official");
  await expect(page.locator(".summary-risk > strong")).toHaveText("3");
  const attention = page.locator(".left-column .panel").filter({ hasText: "Требуют внимания" });
  await expect(attention.locator(".count")).toHaveText("3");
  await expect(attention.locator(".top-route")).toHaveCount(3);
  await expect(attention.locator(".top-route").first()).toContainText(`ТС ${buses[0].id.replace("vehicle-", "")}`);
  await attention.locator(".top-route").first().click();
  await expect(page.getByRole("heading", { name: `ТС ${buses[0].id.replace("vehicle-", "")}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  await expect(page.locator(".alerts-panel .count")).toHaveText("3");
  await expect(page.locator(".alert-tabs").getByRole("button", {name: "Все 3", exact: true})).toBeVisible();
  await expect(page.locator(".alert-card")).toHaveCount(3);
  const early = page.locator(".alert-card").filter({hasText: "Раннее прибытие"});
  await expect(early).toHaveCount(1);
  await expect(early.locator(".probability")).toHaveCount(0);
  await expect(early).not.toContainText("Порог опоздания");
  await page.getByRole("button", {name: "Посмотреть события, требующие внимания", exact: true}).click();
  await expect(page.locator(".network-list-dialog")).toContainText("Раннее прибытие");
});
