import type { Geometry, Vehicle } from "./models";
const earthMeters = 111195;
const distance = (a: number[], b: number[]) =>
  Math.hypot(
    (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
    b[1] - a[1],
  ) * earthMeters;
export interface RoutePath {
  coordinates: number[][];
  distances: number[];
  length: number;
}
export function prepareRoutePaths(
  geometries: Geometry[],
): Map<string, RoutePath[]> {
  const paths = new Map<string, RoutePath[]>();
  for (const geometry of geometries) {
    const coordinates = geometry.coordinates;
    if (
      coordinates.length < 2 ||
      !coordinates.every((p) => p.length >= 2 && p.every(Number.isFinite))
    ) continue;
    const distances = [0];
    for (let i = 1; i < coordinates.length; i++)
      distances.push(distances[i - 1] + distance(coordinates[i - 1], coordinates[i]));
    const sections = paths.get(geometry.routeId) || [];
    sections.push({coordinates, distances, length: distances.at(-1)!});
    paths.set(geometry.routeId, sections);
  }
  return paths;
}
export interface VehicleAnchor {
  vehicle: Vehicle;
  path?: RoutePath;
  distance: number;
  headingDeg?: number;
}
/** Nearest point of a route path: distance along it, offset from it and local heading. */
export function locateOnPath(
  path: RoutePath,
  position: { lon: number; lat: number },
) {
  const point = [position.lon, position.lat],
    scale = Math.cos((point[1] * Math.PI) / 180);
  let separation = Infinity,
    along = 0,
    headingDeg = 0;
  for (let i = 1; i < path.coordinates.length; i++) {
    const a = path.coordinates[i - 1],
      b = path.coordinates[i],
      dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const offset = distance(point, [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ]);
    if (offset < separation) {
      separation = offset;
      headingDeg = trackHeading(a, b);
      along =
        path.distances[i - 1] + (path.distances[i] - path.distances[i - 1]) * t;
    }
  }
  return { along, separation, headingDeg };
}
export function anchorVehicles(
  vehicles: Vehicle[],
  paths: Map<string, RoutePath[] | RoutePath>,
): VehicleAnchor[] {
  return vehicles.map((vehicle) => {
    const candidates = paths.get(vehicle.routeId);
    if (!candidates) return { vehicle, distance: 0 };
    let closest = Infinity,
      along = 0,
      headingDeg = 0,
      best: RoutePath | undefined;
    for (const path of Array.isArray(candidates) ? candidates : [candidates]) {
      const hit = locateOnPath(path, vehicle.position);
      if (hit.separation < closest) {
        closest = hit.separation;
        best = path;
        along = hit.along;
        headingDeg = hit.headingDeg;
      }
    }
    // Missing/incompatible geometry must not move a vehicle onto an unrelated track.
    return {
      vehicle,
      path: closest <= 150 ? best : undefined,
      distance: along,
      headingDeg,
    };
  });
}
export interface ProjectedVehicle extends Vehicle {
  headingDeg: number;
  forecastMinutes: number;
  forecastDistanceM: number;
  positionEstimated: boolean;
}
export function projectVehicle(
  anchor: VehicleAnchor,
  horizon: number,
): ProjectedVehicle {
  const { vehicle, path } = anchor;
  const minutes = Number.isFinite(horizon)
    ? Math.max(0, Math.min(15, horizon))
    : 0;
  const base = {
    ...vehicle,
    // Archived road geometry is reference context, not a causal movement
    // forecast: a bus may be parked or on a nearby parallel road.
    headingDeg:
      vehicle.hasForecast === false || vehicle.forecastHorizonSec !== undefined
        ? vehicle.bearingDeg ?? anchor.headingDeg ?? 0
        : anchor.headingDeg ?? vehicle.bearingDeg ?? 0,
    forecastMinutes: minutes,
    forecastDistanceM: 0,
    positionEstimated: false,
  };
  if (
    vehicle.hasForecast === false ||
    vehicle.forecastHorizonSec !== undefined ||
    !path ||
    !minutes ||
    !Number.isFinite(vehicle.speedKmh) ||
    vehicle.speedKmh <= 0
  )
    return base;
  const seconds = minutes * 60;
  const extraDelay =
    (Math.max(0, vehicle.predictedDelaySec - vehicle.currentDelaySec) *
      minutes) /
    15;
  const travel = (vehicle.speedKmh / 3.6) * Math.max(0, seconds - extraDelay);
  const target = Math.min(path.length, anchor.distance + travel);
  let low = 1,
    high = path.distances.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (path.distances[mid] < target) low = mid + 1;
    else high = mid;
  }
  const a = path.coordinates[low - 1],
    b = path.coordinates[low];
  const fraction =
    (target - path.distances[low - 1]) /
    (path.distances[low] - path.distances[low - 1] || 1);
  return {
    ...base,
    headingDeg: trackHeading(a, b),
    position: {
      lon: a[0] + (b[0] - a[0]) * fraction,
      lat: a[1] + (b[1] - a[1]) * fraction,
    },
    forecastDistanceM: Math.max(0, target - anchor.distance),
    positionEstimated: true,
  };
}

// Clockwise from north, using the local tangent of the road geometry.
function trackHeading(a: number[], b: number[]): number {
  return (
    ((Math.atan2(
      (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360),
      b[1] - a[1],
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
