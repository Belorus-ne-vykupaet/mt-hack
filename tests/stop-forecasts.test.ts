import { expect, it } from "vitest";
import { indexStopForecasts, stopForecastKey } from "../src/entities/stop-forecasts";
import type { Stop, Vehicle } from "../src/entities/models";
const target: Stop = {id: "trip-2-stop", name: "Площадь", sequence: 4, position: {lon: 37.6, lat: 55.7}};
const vehicle: Vehicle = {id: "vehicle-1", routeId: "route-1", position: target.position, speedKmh: 15,
  currentDelaySec: 180, predictedDelaySec: 300, riskLevel: "high", riskProbability: .9,
  hasForecast: true, nextStop: target, updatedAt: "2026-01-06T07:27:00Z"};
it("assigns risk only to the target platform on its own route, including repeated trip IDs", () => {
  const index = indexStopForecasts([vehicle]);
  expect(index.get(stopForecastKey("route-1", {...target, id: "trip-1-stop"}))).toBe(vehicle);
  expect(index.get(stopForecastKey("route-2", target))).toBeUndefined();
  expect(index.get(stopForecastKey("route-1", {...target, position: {lon: 37.6005, lat: 55.7}}))).toBeUndefined();
  expect(index.size).toBe(1);
});
it("keeps stops without valid forecasts unknown rather than normal or high", () => {
  for (const patch of [{hasForecast: false}, {telemetryStale: true}, {nextStop: null}, {riskLevel: "unknown" as const}]) {
    expect(indexStopForecasts([{...vehicle, ...patch}]).size).toBe(0);
  }
});
it("chooses the highest risk among buses approaching the same stop", () => {
  const normal = {...vehicle, id: "vehicle-2", predictedDelaySec: 20, riskLevel: "normal" as const};
  for (const buses of [[normal, vehicle], [vehicle, normal]]) {
    expect(indexStopForecasts(buses).get(stopForecastKey(vehicle.routeId, target))).toBe(vehicle);
  }
});
