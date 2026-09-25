import { it, expect } from "vitest";
import { scenarioSnapshot } from "../src/mocks/scenario";
import { mapSegment, mapVehicle } from "../src/entities/adapters";
import { delayAt, riskAt } from "../src/entities/forecast";
import { applyEvents } from "../src/app/realtime/bridge";
import { queryClient, keys } from "../src/entities/queries";
it("represents a middle-only issue without marking healthy route ends or vehicles", () => {
  const s = scenarioSnapshot(30),
    segments = s.segments.filter((x) => x.route_id === "м3"),
    vehicles = s.vehicles.filter((x) => x.route_id === "м3");
  expect(segments[0].risk_level).toBe("normal");
  expect(segments.at(-1)?.risk_level).toBe("normal");
  expect(segments.some((x) => x.risk_level === "critical")).toBe(true);
  expect(vehicles.some((x) => x.risk_level === "normal")).toBe(true);
  expect(vehicles.some((x) => x.risk_level === "critical")).toBe(true);
  for (let i = 1; i < segments.length; i++)
    expect(segments[i].geometry.coordinates[0]).toEqual(
      segments[i - 1].geometry.coordinates.at(-1),
    );
});
it("keeps route с344 roads healthy while exactly three middle vehicles are delayed", () => {
  const s = scenarioSnapshot(30);
  expect(
    s.segments
      .filter((x) => x.route_id === "с344")
      .every((x) => x.risk_level === "normal"),
  ).toBe(true);
  expect(
    s.vehicles
      .filter((x) => x.route_id === "с344" && x.risk_level !== "normal")
      .map((x) => x.id),
  ).toEqual(["vehicle-813", "vehicle-814", "vehicle-815"]);
  expect(s.routes.find((r) => r.id === "с344")?.risk_level).toBe("high");
});
it("supports separate trouble spots, whole-route congestion, and recovery", () => {
  const s = scenarioSnapshot(30);
  const groups = s.segments
    .filter((x) => x.route_id === "м40")
    .map((x) => x.risk_level !== "normal");
  expect(groups.filter((x, i) => x && !groups[i - 1])).toHaveLength(2);
  expect(
    s.segments
      .filter((x) => x.route_id === "м6")
      .every((x) => x.risk_level === "elevated"),
  ).toBe(true);
  expect(
    scenarioSnapshot(30, "normal").segments.every(
      (x) => x.risk_level === "normal",
    ),
  ).toBe(true);
});
it("interpolates arbitrary horizons consistently and receives segment stream updates", () => {
  const s = scenarioSnapshot(30),
    v = mapVehicle(s.vehicles[0]);
  expect(delayAt(v, 7.5)).toBe(321);
  expect(delayAt(v, 7.51)).toBeGreaterThan(321);
  expect(riskAt(v, 0)).toBe("elevated");
  expect(riskAt(v, 15)).toBe("critical");
  applyEvents([
    {
      type: "forecast.updated",
      version: 1,
      sequence: 1,
      timestamp: new Date().toISOString(),
      payload: { segments: s.segments },
    },
  ]);
  expect(queryClient.getQueryData(keys.segments)).toEqual(
    s.segments.map(mapSegment),
  );
  queryClient.clear();
});
