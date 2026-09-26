import { test, expect } from "@playwright/test";

const openRoute = async (page: import("@playwright/test").Page, route: string) => {
  await page.getByLabel("Поиск маршрута в диспетчерской").fill(route);
  await page.locator(".dispatch-queue-item").first().click();
  await expect(page.getByLabel("Маршрут для управления")).toHaveValue(route);
};

test("an early bus gets a concrete hold with a deadline and effect, applied to that bus only", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dispatch?visual-test=1");
  await openRoute(page, "370");
  const card = page.locator(".decision-card");
  await expect(card).toHaveAttribute("data-decision", "hold_early");
  await expect(card).toHaveAttribute("data-vehicle", "vehicle-852");
  await expect(card.locator("h4")).toHaveText(/^Удержать ТС 852 на «.+» 120 с$/);
  await expect(card.locator(".decision-deadline")).toContainText("за ");
  await expect(card.locator(".decision-effects")).toContainText(
    "Отклонение ТС 852 от графика через 15 мин",
  );
  await expect(card.locator(".decision-effects .better").first()).toBeVisible();
  await expect(page.locator(".vehicle-board")).toContainText("ТС 852");
  await expect(page.locator(".vehicle-board")).toContainText("Прогноз");
  await page
    .getByRole("button", { name: "Применить решение", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText("применён");
  const journal = page.locator(".dispatch-journal");
  await expect(journal).toContainText("Применён в демо");
  await expect(journal).toContainText("ТС 852");
  await expect(journal).toContainText("Удержание до графика");
  await expect(page.locator(".decision-empty")).toContainText("уже применено");
  // A hold changes one bus, not the fleet of the route.
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
  await journal.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(journal).toContainText("Отменён");
  await expect(card).toHaveAttribute("data-vehicle", "vehicle-852");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the most urgent route comes first; its reserve option can be prefilled without applying", async ({
  page,
}) => {
  await page.goto("/dispatch?visual-test=1");
  await expect(page.locator(".dispatch-queue-item").first()).toHaveText(/^м3\+8\.4 мин/);
  const card = page.locator(".decision-card");
  await expect(card).toHaveAttribute("data-decision", "shorten_late");
  await expect(card.locator("h4")).toContainText(
    "Сократить стоянки ТС 742 до 20 с",
  );
  await page.getByRole("tab", { name: /Резерв/ }).click();
  await expect(card).toHaveAttribute("data-decision", "add_bus");
  await expect(page.locator(".vehicle-board")).toBeVisible();
  await page
    .getByRole("button", { name: "Подставить в форму", exact: true })
    .click();
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue(
    "9",
  );
  await expect(page.locator(".dispatch-journal")).not.toContainText(
    "Применён",
  );
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
});

test("rule parameters recalculate the suggestions, persist and can be reset", async ({
  page,
}) => {
  await page.goto("/dispatch?visual-test=1");
  await openRoute(page, "370");
  const title = page.locator(".decision-card h4");
  await expect(title).toContainText(" 120 с");
  await page.locator(".dispatch-settings summary").click();
  await page.getByLabel("Предельное удержание, с").fill("60");
  await expect(title).toContainText(" 60 с");
  await expect(page.locator(".dispatch-settings summary")).toContainText(
    "изменено: 1",
  );
  await page.reload();
  await openRoute(page, "370");
  await expect(title).toContainText(" 60 с");
  await page.locator(".dispatch-settings summary").click();
  await page
    .getByRole("button", { name: "Вернуть значения по умолчанию" })
    .click();
  await expect(title).toContainText(" 120 с");
});

test("reserve advice opens a prefilled plan without applying it", async ({ page }) => {
  await page.goto("/dispatch?visual-test=1");
  const assistant = page.getByRole("region", { name: "Советник GigaChat" });
  await expect(assistant).toContainText("3 с ожидаемой задержкой");
  await assistant.getByRole("button", { name: "Открыть план выпуска" }).click();
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue("9");
  await expect(page.locator(".dispatch-journal")).not.toContainText("Применён");
});
