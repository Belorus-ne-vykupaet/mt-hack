import { test, expect } from "@playwright/test";
test("official Sasha predictions, archive clock, map and themes", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await (await request.get("/api/v1/ml/status")).json();
  expect(state.status).toBe("connected");
  expect(state.metrics.testRows).toBe(353);
  expect(state.totalVehicles).toBe(30);
  expect(state.scheduledVehicles).toBe(13);
  expect(state.contextVehicles).toBe(17);
  expect(
    state.predictedVehicles + state.scheduledWithoutTarget +
      state.scheduledStale + state.scheduledWithoutPosition,
  ).toBe(state.scheduledVehicles);
  const network = await (await request.get("/api/v1/vehicles")).json();
  expect(network.items.length).toBeGreaterThanOrEqual(18);
  const predicted = network.items.filter((v: any) => v.forecast_status === "ready");
  expect(predicted.length).toBeGreaterThan(0);
  expect(predicted.length).toBeLessThan(network.items.length);
  expect(network.items.some((v: any) => v.forecast_status === "no_schedule")).toBeTruthy();
  expect(network.items.some((v: any) => v.status === "stale")).toBeTruthy();
  expect(
    predicted.every(
      (v: any) =>
        v.forecast_horizon_sec > 600 &&
        v.forecast_horizon_sec <= 900 &&
        v.forecast_model === "sasha-extra-trees-v2",
    ),
  ).toBeTruthy();
  expect(
    network.items.some(
      (v: any) => v.current_delay_sec !== v.predicted_delay_sec,
    ),
  ).toBeTruthy();
  await page.goto("/overview?source=official");
  await expect(
    page.getByText("ExtraTrees · официальный датасет", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("58.1 с", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Прогноз ExtraTrees", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Переключить карту в 3D", exact: true })
    .click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole("button", { name: "Включить светлую тему" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("nan");
  await page.screenshot({
    path: "/private/tmp/transit-sasha-dark.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await expect(
    page.getByText("К остановке через 10–15 минут", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await expect(
    page.getByText("Сохранить план по API", { exact: true }),
  ).toBeVisible({timeout: 20000});
  await expect(page.getByText("Применить в демо", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Интеграции", exact: true }).click();
  await expect(
    page.getByText("sasha-extra-trees-v2", { exact: false }),
  ).toBeVisible({timeout: 20000});
  expect(errors).toEqual([]);
});


test("all GPS buses remain available in 2D, 3D and cards without a forecast", async ({page, request}) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const response = await request.get("/api/v1/vehicles");
  const {items} = await response.json();
  const noPlan = items.find((v: any) => v.forecast_status === "no_schedule");
  const stale = items.find((v: any) => v.status === "stale");
  expect(noPlan).toBeTruthy();
  expect(stale).toBeTruthy();
  const geometry = await (await request.get("/api/v1/routes/geometry")).json();
  expect(geometry.items.length).toBeGreaterThanOrEqual(18);
  expect(geometry.items.flatMap((g: any) => g.properties.observed_paths || []).length).toBeGreaterThan(20);
  const roadReference = await (await request.get("/data/official-road-routes.json")).json();
  expect(roadReference.routes.length).toBeGreaterThanOrEqual(12);
  expect(roadReference.routes.flatMap((route: any) => route.paths).length).toBeGreaterThan(20);
  const emptyForecast = await (await request.get(`/api/v1/forecast/vehicles/${noPlan.id}`)).json();
  expect(emptyForecast.points).toEqual([]);
  await page.goto("/overview?source=official");
  await expect(page.getByLabel("Полнота транспортных данных")).toContainText("30 ТС");
  await expect(page.getByLabel("Полнота транспортных данных")).toContainText("17 контекстных");
  await expect(page.locator("[data-visible-vehicles]")).toHaveAttribute("data-visible-vehicles", String(items.length));
  await expect(page.locator("[data-road-paths]")).toHaveAttribute("data-road-paths", /[1-9][0-9]/);
  for (const mode of ["3D", "2D", "3D"]) {
    await page.getByRole("button", {name: `Переключить карту в ${mode}`, exact: true}).click();
    await expect(page.locator("[data-visible-vehicles]")).toHaveAttribute("data-visible-vehicles", String(items.length));
  }
  await expect.poll(async () => Number(await page.locator(".map-shell").getAttribute("data-bus-models"))).toBeGreaterThan(0);
  expect(Number(await page.locator(".map-shell").getAttribute("data-bus-models")))
    .toBeLessThan(Number(await page.locator(".map-shell").getAttribute("data-visible-vehicles")));
  for (const vehicle of [noPlan, stale]) {
    await page.getByRole("button", {name:"Посмотреть транспорт на линии", exact: true}).click();
    await page.getByRole("button", {name: `Открыть ТС ${vehicle.id.replace("vehicle-", "")}`, exact: true}).click();
    await expect(page.getByRole("heading", {name:`ТС ${vehicle.id.replace("vehicle-", "")}`, exact:true})).toBeVisible();
    await expect(page.locator(".detail-panel")).toContainText(vehicle === noPlan ? "Нет расписания" : "GPS устарел");
    await expect(page.locator(".detail-panel")).toContainText("Нет данных");
  }
  await page.waitForTimeout(2500); // include a live WS update with nullable values
  expect(errors).toEqual([]);
  await page.screenshot({path:"/private/tmp/transit-fleet-card.png", fullPage:true});
});
