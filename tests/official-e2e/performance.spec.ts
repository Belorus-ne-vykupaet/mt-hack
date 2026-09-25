import { expect, test } from "@playwright/test";

test("hidden dashboard releases WebGL and live stream, then restores the selected 3D view", async ({
  page,
  request,
}) => {
  const sockets: import("@playwright/test").WebSocket[] = [];
  page.on("websocket", (socket) => {
    if (socket.url().includes("/api/v1/stream")) sockets.push(socket);
  });
  const vehicles = await (await request.get("/api/v1/vehicles")).json();
  const vehicle = vehicles.items[0];
  await page.goto("/overview?source=official");
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 30000,
  });
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill(vehicle.id);
  await page.locator(".search-results").getByRole("button", {
    name: new RegExp(`ТС ${vehicle.id.replace("vehicle-", "")}`),
  }).click();
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(map).toHaveAttribute("data-map-mode", "flow");
  const selectedPosition = await map.getAttribute("data-selected-vehicle-position");
  expect(selectedPosition).toBeTruthy();
  await expect.poll(() => sockets.filter((socket) => !socket.isClosed()).length).toBe(1);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  await expect.poll(() => sockets.filter((socket) => !socket.isClosed()).length).toBe(0);

  const refreshed = page.waitForResponse((response) =>
    response.url().includes("/api/v1/vehicles") && response.status() === 200,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await refreshed;
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 30000 });
  await expect(map).toHaveAttribute("data-map-mode", "flow");
  await expect(map).toHaveAttribute("data-selected-vehicle-position", selectedPosition!);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
  await expect.poll(() => sockets.filter((socket) => !socket.isClosed()).length).toBe(1);
});
