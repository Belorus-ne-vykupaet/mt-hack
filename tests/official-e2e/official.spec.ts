import { test, expect } from "@playwright/test";
test("official CatBoost predictions, archive clock, map and themes", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await (await request.get("/api/v1/ml/status")).json();
  expect(state.status).toBe("connected");
  expect(state.metrics.testRows).toBe(353);
  const network = await (await request.get("/api/v1/vehicles")).json();
  expect(network.items.length).toBeGreaterThan(0);
  expect(
    network.items.every(
      (v: any) =>
        v.forecast_horizon_sec > 600 &&
        v.forecast_horizon_sec <= 900 &&
        v.forecast_model === "catboost-official-v1",
    ),
  ).toBeTruthy();
  expect(
    network.items.some(
      (v: any) => v.current_delay_sec !== v.predicted_delay_sec,
    ),
  ).toBeTruthy();
  await page.goto("/overview?source=official");
  await expect(
    page.getByText("CatBoost · официальный датасет", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("62.7 с", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Прогноз CatBoost", exact: true })
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
    path: "/private/tmp/transit-catboost-dark.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await expect(
    page.getByText("К остановке через 10–15 минут", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await expect(
    page.getByText("Сохранить план по API", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Применить в демо", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Интеграции", exact: true }).click();
  await expect(
    page.getByText("catboost-official-v1", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
