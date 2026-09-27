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

it("anchors a bus to its nearest observed GPS section", () => {
  const near = {routeId: vehicle.routeId, coordinates: [[vehicle.position.lon, vehicle.position.lat], [vehicle.position.lon + 0.001, vehicle.position.lat]]};
  const far = {routeId: vehicle.routeId, coordinates: [[39, 56], [39.001, 56]]};
  const anchored = anchorVehicles([vehicle], prepareRoutePaths([near, far]))[0];
  expect(anchored.path?.coordinates).toEqual(near.coordinates);
  const withoutPrediction = projectVehicle({...anchored, vehicle: {...vehicle, hasForecast: false}}, 15);
  expect(withoutPrediction.position).toEqual(vehicle.position);
  expect(withoutPrediction.positionEstimated).toBe(false);
  expect(projectVehicle({...anchored, vehicle: {...vehicle, hasForecast: false, bearingDeg: 87}}, 15).headingDeg).toBe(87);
});


const officialVehicle = {
  ...vehicle,
  hasForecast: true,
  forecastHorizonSec: 660,
  predictedDelaySec: 120,
  speedKmh: 0,
  nextStop: { id: "target", name: "Target", sequence: 1, position: { lon: 37.01, lat: 55.01 } },
};
it("follows the road to the official target at model arrival time, even from a stopped GPS fix", () => {
  const a = anchorVehicles([officialVehicle], paths)[0];
  const halfway = projectVehicle(a, 6.5);
  expect(halfway.forecastDistanceM).toBeCloseTo(a.path!.length / 2);
  expect(halfway.position.lon).toBe(37.01);
  expect(halfway.position.lat).toBeGreaterThan(55);
  expect(projectVehicle(a, 13).position).toEqual(officialVehicle.nextStop.position);
  expect(projectVehicle(a, 15).position).toEqual(officialVehicle.nextStop.position);
  const later = projectVehicle(a, 6.51);
  expect(later.forecastDistanceM).toBeGreaterThan(halfway.forecastDistanceM);
  expect(later.forecastDistanceM - halfway.forecastDistanceM).toBeLessThan(2);
  expect(projectVehicle({...a, vehicle: {...officialVehicle, predictedDelaySec: 240}}, 6.5).forecastDistanceM)
    .toBeLessThan(halfway.forecastDistanceM);
});
it("moves backwards along geometry when the target is behind and returns exactly to GPS at zero", () => {
  const v = {...officialVehicle, position: {lon: 37.01, lat: 55.005}, nextStop: {...officialVehicle.nextStop, position: vehicle.position}};
  const a = anchorVehicles([v], paths)[0];
  const midway = projectVehicle(a, 1);
  expect(midway.position.lat).toBeLessThan(v.position.lat);
  expect(midway.headingDeg).toBeCloseTo(180);
  expect(projectVehicle(a, 13).position).toEqual(vehicle.position);
  expect(projectVehicle(a, 0).position).toEqual(v.position);
});
it("preserves continuity from an off-road GPS fix and holds stale or missing-target buses", () => {
  const v = {...officialVehicle, position: {lon: 37, lat: 55.0005}};
  const a = anchorVehicles([v], paths)[0];
  const first = projectVehicle(a, 0.00001);
  expect(first.position.lon).toBeCloseTo(v.position.lon, 6);
  expect(first.position.lat).toBeCloseTo(v.position.lat, 6);
  for (const unavailable of [
    {...officialVehicle, telemetryStale: true},
    {...officialVehicle, hasForecast: false},
    {...officialVehicle, nextStop: null},
  ]) {
    expect(projectVehicle(anchorVehicles([unavailable], paths)[0], 15).position).toEqual(unavailable.position);
  }
});
