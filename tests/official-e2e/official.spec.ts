import { test, expect } from "@playwright/test";
import { WEATHER_LOCATIONS } from "../../src/entities/weather-current";
test("official Sasha predictions, archive clock, map and themes", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await (await request.get("/api/v1/ml/status")).json();
  expect(state.status).toBe("connected");
  expect(state.metrics.testRows).toBe(353);
  expect(state.metrics.maeSec).toBeCloseTo(58.1, 1);
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
  await expect(page.locator(".demo-badge")).toHaveText("EXTRATREES · АРХИВ");
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

test("official header and forecast controls show the actual model and fallback", async ({ page, request }) => {
  const live = await (await request.get("/api/v1/ml/status")).json();
  await page.route("**/api/v1/ml/status", (route) => route.fulfill({
    json: {
      ...live,
      status: "connected",
      stale: false,
      modelVersion: "candidate-v3",
      metrics: { ...live.metrics, modelFamily: "CandidateRegressor" },
    },
  }));
  await page.goto("/overview?source=official");
  await expect(page.locator(".demo-badge")).toHaveText("CANDIDATE · АРХИВ");
  await expect(page.getByRole("button", { name: "Прогноз Candidate", exact: true })).toBeVisible();

  await page.unroute("**/api/v1/ml/status");
  await page.route("**/api/v1/ml/status", (route) => route.fulfill({
    json: { ...live, status: "fallback", stale: false },
  }));
  await page.reload();
  await expect(page.locator(".demo-badge")).toHaveText("РЕЗЕРВНЫЙ ПРОГНОЗ");
  await expect(page.getByRole("button", { name: "Резервная оценка", exact: true })).toBeVisible();
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
  expect(roadReference.routes.length).toBeGreaterThanOrEqual(10);
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

test("official 3D map restores current weather without changing archive forecasts", async ({ page }) => {
  const asOf = new Date().toISOString();
  await page.route("**/api/v1/external/yandex-weather/status", (route) =>
    route.fulfill({ json: { configured: true, source: "Яндекс Погода" } }),
  );
  await page.route("**/api/v1/external/yandex-weather/current", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        source: "Яндекс Погода",
        mode: "current-points",
        fetchedAt: asOf,
        refreshAfterSec: 900,
        unavailablePoints: [],
        points: WEATHER_LOCATIONS.map((point) => ({
          ...point,
          cloudiness: "OVERCAST",
          precipitationType: point.id === "center" ? "RAIN" : "NO_TYPE",
          precipitationStrength: point.id === "center" ? "AVERAGE" : "ZERO",
        })),
      },
    }),
  );
  await page.goto("/overview?source=official&visual-test=1");
  await expect(page.getByRole("button", { name: "Погода на 3D-карте" })).toHaveCount(0);
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  const weather = page.locator(".weather-control");
  await expect(weather).toHaveAttribute("data-weather-active", "true", { timeout: 60000 });
  await expect(weather).toHaveAttribute("data-weather-rain-points", "1");
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await expect(page.getByRole("region", { name: "Настройки погоды" })).toContainText(
    "Погода показывает текущий момент, а движение автобусов — архивный поток.",
  );
  await page.getByRole("switch", { name: "Погодный слой" }).uncheck();
  await expect(weather).toHaveAttribute("data-weather-active", "false");
  await page.getByRole("button", { name: "Переключить карту в 2D" }).click();
  await expect(weather).toHaveCount(0);
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(weather).toHaveAttribute("data-weather-active", "false");
});
