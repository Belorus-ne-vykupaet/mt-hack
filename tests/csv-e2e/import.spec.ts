import { test, expect } from "@playwright/test";
test("CSV import drives routes, telemetry, geometry, baseline and planning without mutating facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/overview?visual-test=1");
  await expect(page.locator(".demo-badge")).toContainText("CSV");
  await expect(page.locator(".summary-strip")).toContainText("120");
  await expect(page.locator(".csv-source-note")).toContainText("23.09.2026");
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill("742");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  await expect(page.locator(".detail-panel")).toContainText(
    "Базовый прогноз: задержка сохранится",
  );
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-map-ready",
    "true",
    { timeout: 60000 },
  );
  await expect(page.locator(".detail-panel .risk-badge")).not.toContainText(
    "%",
  );
  await page.getByRole("button", { name: "Управление маршрутом" }).click();
  await page.getByRole("button", { name: /Обзор всех маршрутов/ }).click();
  await expect(page.locator(".network-drawer-card")).toHaveCount(15);
  await expect(page.getByRole("dialog", { name: "Обзор маршрутов и сценариев" }).getByRole("button", { name: "Подготовить план" })).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть обзор маршрутов" }).click();
  await expect(page.locator(".recommend-selected")).toContainText(
    "Нужны подтверждённые данные",
  );
  await page.getByLabel("Плановая стоянка").fill("60");
  await expect(
    page.getByRole("button", { name: "Применить в демо", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Сохранить план", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText("План сохранён");
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await expect(page.locator(".summary-strip")).toContainText("120");
  expect(errors).toEqual([]);
});
