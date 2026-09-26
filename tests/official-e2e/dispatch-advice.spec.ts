import { expect, test } from "@playwright/test";
import { WEATHER_LOCATIONS } from "../../src/entities/weather-current";

test("dispatcher shows per-bus delays, contact drafts and optional AI", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = (await (await request.get("/api/v1/routes")).json()).items as { id: string }[];
  const fleet = (await (await request.get("/api/v1/vehicles")).json()).items as { route_id: string; predicted_delay_sec: number | null }[];
  const route = routes.find((r) => fleet.some((v) => v.route_id === r.id && v.predicted_delay_sec !== null));
  expect(route).toBeTruthy();
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
    return requestRoute.fulfill({ status: 201, json: { ...body, id: "e2e-draft", createdAt: new Date().toISOString(), status: "draft" } });
  });
  await page.goto("/dispatch?source=official&visual-test=1");
  const weather = page.getByRole("region", { name: "Яндекс Погода сейчас" });
  await expect(weather).toContainText("Дождя нет в 13 проверенных точках");
  await expect(weather).toContainText("не соответствует времени архивной телеметрии");
  await page.getByRole("combobox", { name: "Маршрут для управления" }).selectOption(route!.id);
  const board = page.getByRole("region", { name: /Автобусы маршрута/ });
  await expect(board).toBeVisible();
  await expect(board.locator(".vehicle-board-row").first()).toBeVisible();
  await expect(board.locator(".vehicle-board-row")).toHaveCount(fleet.filter((v) => v.route_id === route!.id).length);
  await expect(board.getByText("Прогноз", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".route-timeline")).toHaveCount(0);
  const first = board.locator(".vehicle-board-row").first();
  await first.getByRole("button", { name: "Написать" }).click();
  await expect(board.getByRole("region", { name: /Подготовить сообщение/ })).toBeVisible();
  await expect(board).toContainText("Канал доставки водителю пока не подключён");
  await board.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(board).toContainText("Водителю он не отправлен");
  await expect(board).toContainText("Журнал сообщений");
  await first.getByRole("button", { name: "Скорость" }).click();
  await expect(board.getByLabel("Ориентир скорости, км/ч")).toBeVisible();
  await board.getByRole("button", { name: "Закрыть сообщение" }).click();
  await first.getByRole("button", { name: "Стоянка" }).click();
  await expect(board.getByLabel("Стоянка, секунд")).toBeVisible();
  const assistant = page.getByRole("region", { name: "Советник GigaChat" });
  await expect(assistant).toBeVisible();
  const advice = await (await request.get(`/api/v1/dispatch/advice?route_id=${route!.id}`)).json() as { configured: boolean };
  if (advice.configured) await expect(assistant.getByRole("button", { name: "Спросить GigaChat" })).toBeEnabled();
  else await expect(assistant.getByRole("button", { name: "Спросить GigaChat" })).toBeDisabled();
  await expect(assistant).toContainText("Правила");
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
