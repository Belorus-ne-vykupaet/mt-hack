import type { Geometry, Route, Stop, Vehicle } from "./models";
import { locateOnPath, prepareRoutePaths } from "./vehicle-motion";
import type { RoutePath } from "./vehicle-motion";

export interface LineStop {
  stop: Stop;
  along: number;
}
export interface LineBus {
  vehicle: Vehicle;
  along: number;
}
/** One direction of a route unrolled into a line: stops and buses by distance from its start. */
export interface RouteLine {
  route: Route;
  path?: RoutePath;
  length: number;
  stops: LineStop[];
  buses: LineBus[];
  unmatched: Vehicle[];
}
// Farther than this from the road, telemetry is not trusted for spacing or ETAs.
const MAX_OFFSET_M = 150;

/** A route may come as several road sections; the longest one is its line. */
export const linePath = (sections?: RoutePath[]) =>
  sections?.reduce<RoutePath | undefined>(
    (best, p) => (!best || p.length > best.length ? p : best),
    undefined,
  );

export function buildRouteLines(
  routes: Route[],
  vehicles: Vehicle[],
  geometries: Geometry[],
): RouteLine[] {
  const paths = prepareRoutePaths(geometries);
  return routes.map((route) => {
    const path = linePath(paths.get(route.id));
    const own = vehicles.filter((v) => v.routeId === route.id);
    if (!path)
      return {
        route,
        length: 0,
        stops: [],
        buses: [],
        unmatched: own,
      };
    const stops = route.stops
      .map((stop) => ({ stop, ...locateOnPath(path, stop.position) }))
      .filter((s) => s.separation <= MAX_OFFSET_M)
      .map(({ stop, along }) => ({ stop, along }))
      .sort((a, b) => a.along - b.along || a.stop.sequence - b.stop.sequence);
    const buses: LineBus[] = [],
      unmatched: Vehicle[] = [];
    for (const vehicle of own) {
      const { along, separation } = locateOnPath(path, vehicle.position);
      if (separation <= MAX_OFFSET_M) buses.push({ vehicle, along });
      else unmatched.push(vehicle);
    }
    buses.sort((a, b) => a.along - b.along || a.vehicle.id.localeCompare(b.vehicle.id));
    return { route, path, length: path.length, stops, buses, unmatched };
  });
}

/** The next stop ahead of a bus on its line; the reported next stop wins when it is ahead. */
export function nextLineStop(line: RouteLine, bus: LineBus) {
  const reported = line.stops.find(
    (s) => s.stop.id === bus.vehicle.nextStop?.id && s.along >= bus.along - 30,
  );
  return reported || line.stops.find((s) => s.along > bus.along + 5);
}

/** Median speed of moving buses on the line, m/s; a city-bus fallback when nobody moves. */
export function operatingSpeed(line: RouteLine) {
  const moving = line.buses
    .map((b) => b.vehicle.speedKmh)
    .filter((v) => Number.isFinite(v) && v >= 3)
    .sort((a, b) => a - b);
  const kmh = moving.length ? moving[Math.floor(moving.length / 2)] : 18;
  return kmh / 3.6;
}

/** Seconds until the bus reaches a point ahead of it: its own speed, the line speed if it stands. */
export function secondsTo(line: RouteLine, bus: LineBus, along: number) {
  const distance = Math.max(0, along - bus.along);
  if (distance < 40) return 0;
  const own = bus.vehicle.speedKmh / 3.6;
  return distance / (Number.isFinite(own) && own >= 1 ? own : operatingSpeed(line));
}
