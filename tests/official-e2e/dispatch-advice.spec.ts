import { expect, test } from "@playwright/test";
import { WEATHER_LOCATIONS } from "../../src/entities/weather-current";

test("dispatcher shows per-bus delays, test dispatch delivery and GigaChat route advice", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = (await (await request.get("/api/v1/routes")).json()).items as { id: string }[];
  const fleet = (await (await request.get("/api/v1/vehicles")).json()).items as { id: string; route_id: string; predicted_delay_sec: number | null }[];
  const route = routes.find((r) => fleet.some((v) => v.route_id === r.id && v.predicted_delay_sec !== null));
  expect(route).toBeTruthy();
  await page.route("**/api/v1/dispatch/advice*", (requestRoute) => requestRoute.fulfill({ json: requestRoute.request().method() === "GET"
    ? { configured: true, model: "GigaChat-3-Ultra" }
    : { configured: true, source: "gigachat", model: "GigaChat-3-Ultra", generatedAt: new Date().toISOString(),
      summary: "Проверьте задержку выбранного автобуса.", note: "Проверьте рекомендацию.",
      cards: [{ kind: "message", title: "Уточнить обстановку", reason: "Прогноз требует проверки.",
        vehicleId: fleet.find((v) => v.route_id === route!.id)!.id, message: "Пожалуйста, сообщите обстановку." }] } }));
  await page.route("**/external/yandex-weather/status", (requestRoute) => requestRoute.fulfill({ json: { configured: true } }));
  await page.route("**/external/yandex-weather/current", (requestRoute) => requestRoute.fulfill({ json: {
    schemaVersion: 1, source: "Яндекс Погода", mode: "current-points",
    fetchedAt: new Date().toISOString(), refreshAfterSec: 900, unavailablePoints: [],
    points: WEATHER_LOCATIONS.map((point) => ({ ...point, cloudiness: "CLEAR",
      precipitationType: "NO_TYPE", precipitationStrength: "ZERO" })),
  } }));
  await page.route("**/api/v1/dispatch/driver-messages", async (requestRoute) => {
    if (requestRoute.request().method() !== "POST") return requestRoute.continue();
    const body = requestRoute.request().postDataJSON();
    return requestRoute.fulfill({ status: 201, json: { ...body, id: "e2e-message", createdAt: new Date().toISOString(), status: "sent_test" } });
  });
  await page.goto("/dispatch?source=official&visual-test=1");
  const weather = page.getByRole("region", { name: "Яндекс Погода сейчас" });
  await expect(weather).toContainText("Дождя нет в 13 проверенных точках");
  await expect(weather).toContainText("не соответствует времени архивной телеметрии");
  await page.getByRole("combobox", { name: "Маршрут для управления" }).selectOption(route!.id);
  await page.getByRole("button", { name: /Обзор всех маршрутов/ }).click();
  const networkDrawer = page.getByRole("dialog", { name: "Обзор маршрутов и сценариев" });
  await expect(networkDrawer.locator(".network-drawer-card")).toHaveCount(routes.length);
  await networkDrawer.locator(`[data-recommendation-route="${route!.id}"]`).getByRole("button", { name: /Совет GigaChat/ }).click();
  await expect(networkDrawer).toHaveCount(0);
  const board = page.getByRole("region", { name: /Автобусы маршрута/ });
  await expect(board).toBeVisible();
  await expect(board.locator(".vehicle-board-row").first()).toBeVisible();
  await expect(board.locator(".vehicle-board-row")).toHaveCount(fleet.filter((v) => v.route_id === route!.id).length);
  await expect(board.getByText("Прогноз", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".route-timeline")).toHaveCount(0);
  const first = board.locator(".vehicle-board-row").first();
  await first.getByRole("button", { name: "Написать" }).click();
  const drawer = page.getByRole("dialog", { name: /Команда для/ });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("канал доставки водителю пока не подключён");
  await drawer.getByRole("button", { name: "Отправить в тестовую диспетчерскую" }).click();
  await expect(board).toContainText("принята тестовой диспетчерской");
  await expect(board).toContainText("Тестовая диспетчерская");
  await first.getByRole("button", { name: "Скорость" }).click();
  await expect(drawer.getByLabel("Ориентир скорости, км/ч")).toBeVisible();
  await drawer.getByRole("button", { name: "Закрыть сообщение" }).click();
  await first.getByRole("button", { name: "Стоянка" }).click();
  await expect(drawer.getByLabel("Стоянка, секунд")).toBeVisible();
  await expect(drawer).toContainText("на ней и ещё на двух следующих");
  await drawer.getByRole("button", { name: "Закрыть сообщение" }).click();
  const assistant = page.getByRole("region", { name: "Советник GigaChat" });
  await expect(assistant).toBeVisible();
  await expect(assistant).toContainText("Уточнить обстановку");
  await assistant.getByRole("button", { name: "Открыть команду водителю" }).click();
  await expect(drawer).toContainText("Пожалуйста, сообщите обстановку.");
  await drawer.getByRole("button", { name: "Закрыть сообщение" }).click();
  const noForecast = routes.find((r) => fleet.some((v) => v.route_id === r.id && v.predicted_delay_sec === null));
  if (noForecast) {
    await page.getByRole("combobox", { name: "Маршрут для управления" }).selectOption(noForecast.id);
    await expect(board.locator(".vehicle-board-row")).toHaveCount(fleet.filter((v) => v.route_id === noForecast.id).length);
    await expect(board.locator(".vehicle-board-value.unknown").first()).toContainText("—");
  }
  await weather.getByRole("button", { name: "На карте" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByRole("button", { name: "Погода на 3D-карте" })).toBeVisible();
  expect(errors).toEqual([]);
});
