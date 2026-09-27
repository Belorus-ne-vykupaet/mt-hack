import { test, expect } from "@playwright/test";
test("API mode connects REST/WS, uses server recommendations and survives reload without local plans", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/integrations?visual-test=1");
  await expect(
    page.getByRole("heading", { name: "API-сервис подключён" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подключить сайт к API" }).click();
  await expect(page.locator(".demo-badge")).toHaveText("API");
  await expect(
    page.getByText("Сайт получает данные по API", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".connection")).toHaveClass(/connected/, {
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await expect(page.locator(".api-dispatch-notice")).toContainText(
    "Состояние подключений",
  );
  await expect(page.locator(".dispatch-queue-item")).toHaveCount(15);
  await page.getByLabel("Плановое количество автобусов").fill("10");
  await page.getByLabel("Плановая стоянка").fill("20");
  await page
    .getByRole("button", { name: "Отправить по API", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText(
    "API подтвердил",
  );
  await expect(page.locator(".dispatch-context")).toContainText("10 на линии");
  await expect(page.locator(".dispatch-journal")).toContainText(
    "Применён через API",
  );
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await expect(page.locator(".summary-strip")).toContainText("122");
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await page.evaluate(() =>
    localStorage.removeItem("transit-dispatch-plans-v1"),
  );
  await page.reload();
  await expect(page.locator(".dispatch-context")).toContainText("10 на линии");
  await expect(page.locator(".dispatch-journal")).toContainText(
    "Применён через API",
  );
  await page
    .locator(".dispatch-journal")
    .getByRole("button", { name: "Отменить", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText(
    "Сервер подтвердил отмену",
  );
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
  await page.goto("/integrations");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Проверить участок" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("API unavailable shows error and does not claim connection or apply a local command", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("transit-data-source"))
      sessionStorage.setItem("transit-data-source", "api");
  });
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Тест: API недоступен" } }),
    }),
  );
  await page.goto("/integrations");
  await expect(page.getByRole("alert")).toContainText("Тест: API недоступен");
  await expect(
    page.getByRole("heading", { name: "API-сервис подключён" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Получить погоду" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Вернуться к локальному демо" })
    .click();
  await expect(page.locator(".demo-badge")).toHaveText("ДЕМО");
});

test("recovers an initially unavailable API without reloading the page", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("transit-data-source", "api"),
  );
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Starting server" } }),
    }),
  );
  await page.goto("/integrations");
  await expect(page.getByRole("alert")).toContainText("Starting server");
  await page.unroute("**/api/v1/**");
  await page.getByRole("button", { name: "Проверить связь" }).click();
  await expect(
    page.getByRole("heading", { name: "API-сервис подключён" }),
  ).toBeVisible();
  await expect(page.locator(".connection")).toHaveClass(/connected/, {
    timeout: 20000,
  });
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await expect(page.locator(".summary-strip")).toContainText("120");
});
