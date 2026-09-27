import { test, expect } from "@playwright/test";
import catalog from "../../src/data/moscow-buses.json" with { type: "json" };

test("rapid camera reversals finish in the requested mode with animation enabled", async ({
  page,
}) => {
  await page.goto("/overview");
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 60000,
  });
  for (let i = 0; i < 7; i++) {
    await page
      .getByRole("button", {
        name: `Переключить карту в ${i % 2 ? "2D" : "3D"}`,
      })
      .click();
    await page.waitForTimeout(65);
  }
  await expect(map).toHaveAttribute("data-pitch", "52");
  await page.getByRole("button", { name: "Переключить карту в 2D" }).click();
  await expect(map).toHaveAttribute("data-pitch", "0");
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(map).toHaveAttribute("data-pitch", "52");
});

test("sidebar opens full lists and settings work from integrations", async ({
  page,
}) => {
  await page.goto("/integrations?visual-test=1");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Настройки", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByLabel("Тема интерфейса").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.press("Escape");
  await expect(settings).toHaveCount(0);
  for (const name of ["Маршруты", "Транспорт", "Остановки", "События"]) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator(".network-list-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть список" }).click();
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Остановки", exact: true })
    .click();
  await page.locator(".list-row-button").first().click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.locator(".detail-panel")).toBeVisible();
});

test("multiple route tracking filters the map together and survives inspecting a route", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  const filter = page.getByLabel("Фильтр по маршрутам", { exact: true });
  await expect(page.locator(".map-strip")).toContainText(
    `${catalog.routes.length} маршрутов`,
  );
  await filter.click();
  await page.getByLabel("Отслеживать маршрут м3", { exact: true }).check();
  const another = catalog.routes.find((r) => r.id !== "м3")!;
  await page
    .getByLabel(`Отслеживать маршрут ${another.number}`, { exact: true })
    .check();
  await filter.click();
  await expect(page.locator(".map-strip")).toContainText("2 маршрутов");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Маршруты", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Открыть Маршрут м3", exact: true })
    .click();
  await expect(page.locator(".map-strip")).toContainText("2 маршрутов");
  await filter.click();
  await page.getByLabel("Отслеживать маршрут м3", { exact: true }).uncheck();
  await filter.click();
  await expect(page.locator(".map-strip")).toContainText("1 маршрутов");
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(page.locator(".map-strip")).toContainText(
    `${catalog.routes.length} маршрутов`,
  );
});

test("quoted and reordered searches work in global search and route lists", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  const search = page.getByLabel("Поиск маршрута, ТС или остановки");
  await search.fill('"Семеновская"');
  await expect(page.locator(".search-results button").first()).toBeVisible();
  await search.fill('"м3" маршрут');
  await expect(page.locator(".search-results")).not.toContainText(
    "Ничего не найдено",
  );
  await search.press("Escape");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Маршруты", exact: true })
    .click();
  await page.getByLabel("Поиск в полном списке").fill('"м3" маршрут');
  // Partial search also returns м3к and м34; quotes are normalized, not exact-match operators.
  await expect(page.locator(".network-list-table tbody tr")).toHaveCount(
    catalog.routes.filter((route) => route.number.includes("м3")).length,
  );
  await expect(page.getByRole("button", { name: "Открыть Маршрут м3", exact: true })).toBeVisible();
});

test("analytics forecast is inside the selected card", async ({
  page,
}) => {
  await page.goto("/analytics?visual-test=1");
  await expect(page.locator(".analytics")).toBeVisible();
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveCount(0);
  await page.locator(".alert-card").first().click();
  const slider = page
    .locator(".detail-panel")
    .getByLabel("Горизонт прогноза в минутах");
  await expect(slider).toBeVisible();
  await slider.fill("7.5");
  await expect(page.locator(".detail-forecast")).toContainText("+7 мин 30 с");
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveCount(0);
});

test("an applied plan is not reported as rejected when refresh returns HTML", async ({
  page,
}) => {
  await page.goto("/dispatch?visual-test=1");
  await expect(page.getByText("Поток активен")).toBeVisible();
  await page.getByLabel("Плановое количество автобусов").fill("10");
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) =>
      String(input).includes("/api/v1/")
        ? Promise.resolve(
            new Response("<!doctype html><html></html>", {
              headers: { "content-type": "text/html" },
            }),
          )
        : original(input, init);
  });
  await page
    .getByRole("button", { name: "Применить в демо", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText(
    "сохранён и применён",
  );
  await expect(page.locator(".dispatch-notice")).toContainText(
    "пока не обновились",
  );
  await expect(page.locator(".dispatch-journal")).toContainText(
    "Применён в демо",
  );
  await expect(page.locator("body")).not.toContainText("Unexpected token");
  await page.reload();
  await expect(page.locator(".dispatch-context")).toContainText("10 на линии");
});
