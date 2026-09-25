import { expect, it } from "vitest";
import {
  anchorVehicles,
  prepareRoutePaths,
  projectVehicle,
} from "../src/entities/vehicle-motion";
import { scenarioSnapshot, geometries } from "../src/mocks/scenario";
import { mapGeometry, mapVehicle } from "../src/entities/adapters";

const vehicle = {
  ...mapVehicle(scenarioSnapshot(30).vehicles[0]),
  routeId: "test",
  position: { lon: 37, lat: 55 },
  speedKmh: 36,
  currentDelaySec: 0,
  predictedDelaySec: 0,
};
const paths = prepareRoutePaths([
  {
    routeId: "test",
    coordinates: [
      [37, 55],
      [37.01, 55],
      [37.01, 55.01],
    ],
  },
]);
const anchor = anchorVehicles([vehicle], paths)[0];
it("follows a road corner rather than cutting diagonally across buildings", () => {
  const first = projectVehicle(anchor, 0.5),
    second = projectVehicle(anchor, 2);
  expect(first.position.lat).toBe(55);
  expect(first.position.lon).toBeGreaterThan(37);
  expect(first.position.lon).toBeLessThan(37.01);
  expect(second.position.lon).toBe(37.01);
  expect(second.position.lat).toBeGreaterThan(55);
  expect(second.position.lat).toBeLessThan(55.01);
  expect(second.forecastDistanceM).toBeCloseTo(1200);
  expect(projectVehicle(anchor, 0).headingDeg).toBeCloseTo(90);
  expect(first.headingDeg).toBeCloseTo(90);
  expect(second.headingDeg).toBeCloseTo(0);
  expect(projectVehicle(anchor, 0).position).toEqual(vehicle.position);
});
it("reduces progress for increasing delay and stops at the terminus without wrapping", () => {
  const delayed = {
    ...anchor,
    vehicle: { ...vehicle, predictedDelaySec: 450 },
  };
  expect(projectVehicle(delayed, 2).forecastDistanceM).toBeCloseTo(600);
  expect(projectVehicle(anchor, 15).position).toEqual({
    lon: 37.01,
    lat: 55.01,
  });
  expect(projectVehicle(anchor, 100).position).toEqual(
    projectVehicle(anchor, 15).position,
  );
});
it("keeps stopped, unmatched and off-track telemetry at its reported position", () => {
  for (const v of [
    { ...vehicle, speedKmh: 0 },
    { ...vehicle, routeId: "missing" },
    { ...vehicle, position: { lon: 38, lat: 56 } },
  ]) {
    const projected = projectVehicle(anchorVehicles([v], paths)[0], 15);
    expect(projected.position).toEqual(v.position);
    expect(projected.positionEstimated).toBe(false);
  }
  expect(projectVehicle(anchor, NaN).position).toEqual(vehicle.position);
});
it("anchors all 120 demo buses to their own roads and projects fractional horizons", () => {
  const snapshot = scenarioSnapshot(30);
  const anchors = anchorVehicles(
    snapshot.vehicles.map(mapVehicle),
    prepareRoutePaths(geometries.map(mapGeometry)),
  );
  expect(anchors).toHaveLength(120);
  for (const a of anchors) {
    expect(a.path).toBeDefined();
    const halfway = projectVehicle(a, 7.5),
      later = projectVehicle(a, 15);
    expect(halfway.forecastDistanceM).toBeGreaterThan(0);
    expect(later.forecastDistanceM).toBeGreaterThanOrEqual(
      halfway.forecastDistanceM,
    );
    const projectedAnchor = anchorVehicles(
      [later],
      new Map([[later.routeId, a.path!]]),
    )[0];
    expect(projectedAnchor.path).toBeDefined();
    expect(projectedAnchor.distance).toBeCloseTo(
      a.distance + later.forecastDistanceM,
      2,
    );
  }
});
