import type { Route, Segment, RiskLevel, Stop, Vehicle } from "./models";
import { delayAt, riskAt } from "./forecast";
import { config } from "../shared/config/env";
import { minutes, horizonLabel, percent } from "../shared/ui/format";
export interface RiskColumn {
  forecastHorizonSec?: number;
  id: string;
  routeId: string;
  route: Route;
  stop: Stop;
  position: [number, number];
  delay: number;
  riskLevel: RiskLevel;
  riskProbability: number;
}
const distanceSquared = (a: number[], b: Stop) => {
  const x = (a[0] - b.position.lon) * Math.cos((a[1] * Math.PI) / 180);
  return x * x + (a[1] - b.position.lat) ** 2;
};
// A column describes nearby track, not an arrival-time forecast at the stop.
// Place it at a real stop on its own route; merge sections assigned to the same stop.
export function buildStopColumns(
  segments: Segment[],
  routes: Route[],
  horizon: number,
  vehicles: Vehicle[] = [],
): RiskColumn[] {
  const byRoute = new Map(routes.map((r) => [r.id, r]));
  const columns = new Map<string, RiskColumn>();
  // Official segment colours locate vehicles at risk; the ML target is a
  // future stop, so only vehicle target-stop forecasts receive a 3D column.
  for (const segment of config.officialMode ? [] : segments) {
    const route = byRoute.get(segment.routeId);
    if (!route?.stops.length || !segment.coordinates.length) continue;
    const middle =
      segment.coordinates[Math.floor(segment.coordinates.length / 2)];
    const stop = route.stops.reduce((best, current) =>
      distanceSquared(middle, current) < distanceSquared(middle, best)
        ? current
        : best,
    );
    const id = `${route.id}:${stop.id}`,
      delay = delayAt(segment, horizon),
      previous = columns.get(id);
    if (previous && previous.delay >= delay) continue;
    columns.set(id, {
      id,
      routeId: route.id,
      route,
      stop,
      position: [stop.position.lon, stop.position.lat],
      delay,
      riskLevel: riskAt(segment, horizon),
      riskProbability: segment.riskProbability,
    });
  }
  for (const vehicle of vehicles) {
    if (vehicle.forecastHorizonSec === undefined || !vehicle.nextStop || vehicle.hasForecast === false) continue;
    const route = byRoute.get(vehicle.routeId);
    if (!route) continue;
    const stop = vehicle.nextStop;
    const id = `${route.id}:${stop.id}`;
    columns.set(id, {
      id,
      routeId: route.id,
      route,
      stop,
      position: [stop.position.lon, stop.position.lat],
      delay: horizon ? vehicle.predictedDelaySec : vehicle.currentDelaySec,
      riskLevel: riskAt(vehicle, horizon),
      riskProbability: vehicle.riskProbability,
      forecastHorizonSec: vehicle.forecastHorizonSec,
    });
  }
  return [...columns.values()];
}
export const columnLabel = (c: RiskColumn) =>
  `${c.stop.name}\n№ ${c.route.number} · ${minutes(c.delay)} мин`;
export const columnTooltip = (c: RiskColumn, horizon: number) =>
  c.forecastHorizonSec !== undefined
    ? `Остановка «${c.stop.name}»\nТС ${c.route.number}\n${horizon ? `Прогноз через ${(c.forecastHorizonSec / 60).toFixed(1)} мин` : "Текущая задержка"}: ${minutes(c.delay)} мин\nВероятность опоздания >120 с: ${percent(c.riskProbability)}`
    : `Остановка «${c.stop.name}»\nМаршрут № ${c.route.number}\n${horizonLabel(horizon)}: ${minutes(c.delay)} мин\nЗадержка на участке у остановки\nВероятность задержки: ${percent(c.riskProbability)}`;

/** Screen-space rectangles prevent both labels and their backgrounds from overlapping. */
export function visibleColumnLabels(
  columns: RiskColumn[],
  project: (point: number[]) => number[],
  width: number,
  height: number,
  selected: string | null,
) {
  const rectangles: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  return [...columns]
    .sort(
      (a, b) =>
        Number(b.routeId === selected) - Number(a.routeId === selected) ||
        b.delay - a.delay,
    )
    .filter((c) => {
      const [x, y] = project([...c.position, Math.max(5, c.delay) * 2.8 + 70]);
      const labelWidth = Math.min(
        400,
        Math.max(
          c.stop.name.length,
          `№ ${c.route.number} · ${minutes(c.delay)} мин`.length,
        ) *
          8 +
          24,
      );
      const box = {
        left: x - labelWidth / 2,
        top: y - 27,
        right: x + labelWidth / 2,
        bottom: y + 27,
      };
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        box.left < 8 ||
        box.right > width - 8 ||
        box.top < 60 ||
        box.bottom > height - 30
      )
        return false;
      if (box.left < 275 && box.top < 250) return false;
      if (box.left < 300 && box.bottom > height - 120) return false;
      if (
        rectangles.some(
          (r) =>
            box.left < r.right + 10 &&
            box.right > r.left - 10 &&
            box.top < r.bottom + 10 &&
            box.bottom > r.top - 10,
        )
      )
        return false;
      rectangles.push(box);
      return true;
    });
}
