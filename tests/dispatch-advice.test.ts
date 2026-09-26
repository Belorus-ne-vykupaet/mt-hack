import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/app";
import { ruleAdvice } from "../server/gigachat";
import { mapRoute, mapVehicle } from "../src/entities/adapters";
import { csvSnapshot } from "../src/mocks/csv-scenario";
import { WEATHER_LOCATIONS } from "../src/entities/weather-current";

const close: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of close.splice(0).reverse()) await cleanup(); });
async function start(options: Parameters<typeof createApi>[0] = {}) {
  const api = createApi({ frozen: true, ...options });
  await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  close.push(() => api.close());
  return `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api/v1`;
}

describe("bus-level dispatch and GigaChat integration", () => {
  it("calculates explicit rule fallback only for buses with a forecast", () => {
    const raw = csvSnapshot(900);
    const route = mapRoute(raw.routes[0]);
    const fleet = raw.vehicles.filter((v) => v.route_id === route.id).map(mapVehicle);
    const advice = ruleAdvice(route, fleet, 2);
    expect(advice.source).toBe("rules");
    expect(advice.configured).toBe(false);
    expect(advice.summary).toMatch(/прогноз/);
    expect(advice.cards.every((card) => !card.vehicleId || fleet.some((v) => v.id === card.vehicleId))).toBe(true);
    const noForecast = fleet.map((v) => ({ ...v, hasForecast: false }));
    expect(ruleAdvice(route, noForecast, 2).cards).toHaveLength(0);
  });

  it("stores driver contact as a persistent draft and never marks it delivered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "driver-outbox-"));
    close.push(() => rm(dir, { recursive: true, force: true }));
    const token = "dispatch-test-token-1234567890";
    const options = { token, publicRead: true, driverOutbox: join(dir, "outbox.json") };
    const url = await start(options);
    const routes = await (await fetch(`${url}/routes`)).json();
    const route = routes.items[0];
    const vehicles = await (await fetch(`${url}/vehicles?route_id=${route.id}`)).json();
    const vehicle = vehicles.items[0];
    const body = { routeId: route.id, vehicleId: vehicle.id, kind: "dwell", text: "Стоянка только после завершения посадки.", dwellSec: 35, stopId: route.stops[0].id };
    const post = (data: object, authenticated = true) => fetch(`${url}/dispatch/driver-messages`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data),
    });
    expect((await post(body, false)).status).toBe(401);
    expect((await post({ ...body, vehicleId: "unknown" })).status).toBe(404);
    expect((await post({ ...body, dwellSec: 5 })).status).toBe(422);
    const saved = await (await post(body)).json();
    expect(saved.status).toBe("draft");
    expect(saved.dwellStops).toBe(1);
    expect(saved).not.toHaveProperty("deliveredAt");
    expect((await fetch(`${url}/dispatch/driver-messages`)).status).toBe(401);
    const second = await start(options);
    const journal = await (await fetch(`${second}/dispatch/driver-messages`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(journal.items[0].id).toBe(saved.id);
  });

  it("requests GigaChat only on operator POST, caches OAuth and validates model cards", async () => {
    const calls: { url: string; options?: RequestInit }[] = [];
    let validVehicleId = "";
    let metrics = { forecastedCount: 0, delayedCount: 0, delayedSharePercent: 0 };
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      calls.push({ url, options });
      if (url.includes("oauth")) return new Response(JSON.stringify({ access_token: "test-access", expires_at: Math.floor(Date.now() / 1000) + 1800 }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Проверены задержки автобусов.", metrics, cards: [{ kind: "message", title: "Уточнить обстановку", reason: "Прогноз выше текущей задержки.", vehicleId: validVehicleId, message: "Сообщите о заторе." }, { kind: "message", title: "Ложный автобус", reason: "Несуществующий ID", vehicleId: "unknown" }] }) } }] }), { status: 200 });
    });
    const weatherFetch = vi.fn(async () => new Response(JSON.stringify({ data: Object.fromEntries(
      WEATHER_LOCATIONS.map((location) => [location.id, { now: {
        cloudiness: "CLOUDY", precType: location.id === "center" ? "RAIN" : "NO_TYPE",
        precStrength: location.id === "center" ? "WEAK" : "ZERO",
      } }]),
    ) }), { status: 200 }));
    const url = await start({ gigachatKey: "test-key", gigachatFetcher: fakeFetch as typeof fetch,
      yandexWeatherKey: "test-weather-key", fetcher: weatherFetch as typeof fetch });
    const routes = await (await fetch(`${url}/routes`)).json();
    const routeId = routes.items.find((r: { id: string }) => r.id === "route-46")?.id || routes.items[0].id;
    const own = (await (await fetch(`${url}/vehicles?route_id=${routeId}`)).json()).items as { id: string; predicted_delay_sec: number | null; has_forecast?: boolean }[];
    validVehicleId = own[0].id;
    const forecasted = own.filter((v) => v.predicted_delay_sec !== null && v.has_forecast !== false);
    const delayed = forecasted.filter((v) => v.predicted_delay_sec! >= 120);
    metrics = { forecastedCount: forecasted.length, delayedCount: delayed.length, delayedSharePercent: forecasted.length ? Math.round(delayed.length / forecasted.length * 100) : 0 };
    const read = await (await fetch(`${url}/dispatch/advice?route_id=${routeId}`)).json();
    expect(read.source).toBe("rules");
    expect(read.configured).toBe(true);
    expect(calls).toHaveLength(0);
    const analyze = () => fetch(`${url}/dispatch/advice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routeId }) });
    const first = await (await analyze()).json();
    expect(first.source).toBe("gigachat");
    const chatRequest = calls.find((call) => call.url.includes("chat/completions"));
    const weatherContext = JSON.parse(JSON.parse(String(chatRequest?.options?.body)).messages[1].content).currentWeather;
    expect(weatherContext).toMatchObject({ source: "Яндекс Погода", checkedPoints: 13, rainPoints: ["Центр"] });
    expect(first.cards.some((card: { title: string }) => card.title === "Ложный автобус")).toBe(false);
    expect(JSON.stringify(first)).not.toContain("test-key");
    await analyze();
    expect(weatherFetch).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.url.includes("oauth"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes("chat/completions"))).toHaveLength(2);
    metrics = { ...metrics, delayedCount: metrics.delayedCount + 1 };
    const rejected = await (await analyze()).json();
    expect(rejected.source).toBe("rules");
    expect(rejected.note).toContain("расчёт не прошёл проверку");
  });
});
