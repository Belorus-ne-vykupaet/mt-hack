import { test, expect } from "@playwright/test";

test("forecast buses move while the slider is held in both map views", async ({ page, request }) => {
  const network = await (await request.get("/api/v1/vehicles")).json();
  const source = network.items[0];
  const vehicle = {
    ...source,
    position: { lon: 37.7, lat: 55.7 },
    status: "active",
    telemetry_stale: false,
    telemetry_age_sec: 0,
    forecast_status: "ready",
    forecast_horizon_sec: 780,
    predicted_delay_sec: 0,
    next_stop: { id: "slider-target", name: "Target", sequence: 1, position: { lon: 37.71, lat: 55.71 } },
  };
  await page.routeWebSocket("**", () => {});
  await page.route("**/api/v1/vehicles", route => route.fulfill({ json: { ...network, items: [vehicle] } }));
  await page.route("**/data/official-road-routes.json", route => route.fulfill({ json: {
    routes: [{ routeId: vehicle.route_id, window: ["", ""], paths: [[[37.7, 55.7], [37.71, 55.7], [37.71, 55.71]]] }],
  } }));
  await page.goto("/overview?source=official");
  await page.getByRole("button", { name: "Посмотреть транспорт на линии", exact: true }).click();
  await page.getByRole("button", { name: `Открыть ТС ${vehicle.id.replace("vehicle-", "")}`, exact: true }).click();
  const slider = page.getByLabel("Горизонт прогноза в минутах");
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  for (const mode of ["2D", "3D"]) {
    if (mode === "3D") await page.getByRole("button", { name: "Переключить карту в 3D", exact: true }).click();
    await slider.fill("0");
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    try {
      let previous = await map.getAttribute("data-selected-vehicle-position");
      for (const fraction of [0.2, 0.4, 0.6, 0.3]) {
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 8 });
        // Assert every update before mouseup, including reversing the drag.
        await expect.poll(() => map.getAttribute("data-selected-vehicle-position"), { timeout: 1000 }).not.toBe(previous);
        previous = await map.getAttribute("data-selected-vehicle-position");
      }
    } finally {
      await page.mouse.up();
    }
  }
});
