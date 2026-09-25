import type { DemoRouteDto as RouteDto, DemoVehicleDto as VehicleDto } from "./types";
import type {
  AlertDto,
  NetworkSummaryDto,
  RouteGeometryDto,
  SegmentDto,
  DelayPointDto,
} from "../shared/api/generated/models";
export type Scenario =
  | "normal"
  | "rush-hour"
  | "route-primary-delay"
  | "network-disruption"
  | "recovery";
import { applyDispatch } from "./dispatch-scenario";
import { config } from "../shared/config/env";
const csv = config.csvMode ? await import("./csv-scenario") : null;
import catalog from "../data/moscow-buses.json";
export const routeNumbers = catalog.routes.map((r) => r.id);
export const geometries: RouteGeometryDto[] = csv
  ? csv.csvGeometries
  : catalog.routes.map((r) => ({
      type: "Feature",
      properties: { route_id: r.id },
      geometry: { type: "LineString", coordinates: r.coordinates },
    }));
const distances = catalog.routes.map((r) => {
  const result = [0];
  for (let i = 1; i < r.coordinates.length; i++) {
    const a = r.coordinates[i - 1],
      b = r.coordinates[i];
    const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
    result.push(result[i - 1] + Math.hypot(dx, b[1] - a[1]) * 111195);
  }
  return result;
});
export function positionAt(routeIndex: number, progress: number) {
  const path = geometries[routeIndex].geometry.coordinates;
  const cumulative = distances[routeIndex];
  const target = (((progress % 1) + 1) % 1) * cumulative.at(-1)!;
  let j = 1;
  while (j < cumulative.length - 1 && cumulative[j] < target) j++;
  const fraction =
    (target - cumulative[j - 1]) / (cumulative[j] - cumulative[j - 1] || 1);
  const a = path[j - 1],
    b = path[j];
  return {
    lon: a[0] + (b[0] - a[0]) * fraction,
    lat: a[1] + (b[1] - a[1]) * fraction,
  };
}
function nextStop(routeIndex: number, progress: number) {
  const route = catalog.routes[routeIndex];
  const distance = (((progress % 1) + 1) % 1) * route.lengthM;
  return route.stops.find((s) => s.distanceM > distance) || route.stops.at(-1)!;
}
export function scenarioSnapshot(
  seconds = 30,
  scenario: Scenario = "route-primary-delay",
) {
  const stage =
    scenario === "rush-hour" || scenario === "network-disruption"
      ? 3
      : Math.min(3, Math.floor(seconds / 10));
  const primaryRoute =
    scenario === "normal"
      ? [20, 42, 0.08, "normal"]
      : scenario === "recovery"
        ? [
            138,
            Math.max(36, 504 - seconds * 12),
            Math.max(0.1, 0.91 - seconds * 0.022),
            seconds > 20 ? "normal" : "high",
          ]
        : [
            [126, 180, 0.38, "elevated"],
            [138, 288, 0.62, "elevated"],
            [138, 396, 0.78, "high"],
            [138, 504, 0.91, "critical"],
          ][stage];
  const routes: RouteDto[] = routeNumbers.map((id, i) => {
    const normal = scenario === "normal";
    const risk =
      i === 0
        ? primaryRoute[3]
        : normal
          ? "normal"
          : i < 2
            ? "high"
            : i < 3
              ? "elevated"
              : "normal";
    const delay =
      i === 0
        ? Number(primaryRoute[2])
        : normal
          ? 0.05
          : i < 2
            ? 0.82 - i * 0.03
            : i < 3
              ? 0.68 - (i - 2) * 0.025
              : 0.06 + (i % 7) * 0.025;
    const prediction =
      i === 0
        ? Number(primaryRoute[1])
        : normal
          ? 24
          : i < 2
            ? [0, 366, 252, 228][i]
            : i < 3
              ? 210 - (i - 2) * 18
              : 12 + (i % 5) * 9;
    return {
      id,
      number: id,
      name: catalog.routes[i].name,
      transport_type: "bus",
      current_delay_sec:
        i === 0 ? Number(primaryRoute[0]) : Math.round(prediction * 0.36),
      predicted_delay_sec:
        scenario === "network-disruption" ? prediction * 1.35 : prediction,
      risk_probability: delay,
      risk_level: risk as RouteDto["risk_level"],
      vehicle_count: catalog.routes[i].vehicleCount,
      stops: catalog.routes[i].stops,
    };
  });
  const base = routes.map((r) => ({ ...r }));
  const normalScenario = scenario === "normal";
  const localSeverity = (
    i: number,
    progress: number,
    vehicleIndex?: number,
  ) => {
    if (normalScenario)
      return {
        current: 20,
        predicted: 24,
        probability: 0.05,
        risk: "normal" as const,
      };
    let affected = false;
    if (i === 0) affected = progress >= 0.4 && progress <= 0.75;
    if (i === 1)
      affected = vehicleIndex !== undefined && [3, 4, 5].includes(vehicleIndex);
    if (i === 2) affected = progress >= 0.65;
    if (i === 3) affected = true;
    if (i === 4)
      affected =
        (progress >= 0.15 && progress <= 0.3) ||
        (progress >= 0.65 && progress <= 0.8);
    if (!affected)
      return {
        current: 18 + (i % 3) * 8,
        predicted: 24 + (i % 4) * 8,
        probability: 0.08,
        risk: "normal" as const,
      };
    if (i === 0)
      return {
        current: base[0].current_delay_sec,
        predicted: base[0].predicted_delay_sec,
        probability: base[0].risk_probability,
        risk: base[0].risk_level,
      };
    const predicted = [0, 366, 270, 168, 330][i];
    return {
      current: [0, 255, 150, 126, 240][i],
      predicted:
        scenario === "network-disruption" ? predicted * 1.35 : predicted,
      probability: [0, 0.84, 0.78, 0.58, 0.82][i],
      risk: (i === 3 ? "elevated" : "high") as RouteDto["risk_level"],
    };
  };
  // Timetable deviations on otherwise healthy routes, for the dispatcher: a bus running early
  // that caught up with its leader, a lone early bus and an on-time bus closing in on its leader.
  const drift: Record<
    string,
    { offset: number; current: number; predicted: number }
  > = normalScenario
    ? {}
    : {
        "5:2": { offset: 0.07, current: -150, predicted: -170 },
        "6:5": { offset: 0, current: -90, predicted: -100 },
        "8:4": { offset: 0.08, current: 20, predicted: 20 },
      };
  const vehicles: VehicleDto[] = routes.flatMap((r, i) =>
    Array.from({ length: r.vehicle_count }, (_, j) => {
      const deviation = drift[`${i}:${j}`];
      const progress =
        i === 1
          ? [0.03, 0.15, 0.28, 0.46, 0.53, 0.6, 0.82, 0.93][j % 8] +
            Math.sin(seconds / 180) * 0.025
          : ((i === 0 && j === 0 ? 0.51 : j / r.vehicle_count) +
              (deviation?.offset || 0) +
              seconds * 0.00035) %
            1;
      const local = localSeverity(i, progress, j);
      if (deviation) {
        local.current = deviation.current;
        local.predicted = deviation.predicted;
      }
      return {
        id: i === 0 && j === 0 ? "vehicle-742" : `vehicle-${800 + i * 10 + j}`,
        route_id: r.id,
        position: positionAt(i, progress),
        bearing_deg: 140,
        speed_kmh: local.risk === "normal" ? 28 + (j % 8) : 12 + (j % 5),
        current_delay_sec: local.current,
        predicted_delay_sec: local.predicted,
        risk_probability: local.probability,
        risk_level: local.risk,
        status: "active" as const,
        next_stop: nextStop(i, progress),
        updated_at: new Date().toISOString(),
      };
    }),
  );
  const segments: SegmentDto[] = routes.flatMap((r, i) =>
    Array.from({ length: 12 }, (_, j) => {
      const cumulative = distances[i],
        total = cumulative.at(-1)!;
      const start =
        j === 0 ? 0 : cumulative.findIndex((d) => d >= (total * j) / 12);
      const end =
        j === 11
          ? cumulative.length - 1
          : cumulative.findIndex((d) => d >= (total * (j + 1)) / 12);
      const local = localSeverity(i, (j + 0.5) / 12);
      return {
        id: `segment-${r.id}-${j}`,
        route_id: r.id,
        geometry: {
          type: "LineString" as const,
          coordinates: geometries[i].geometry.coordinates.slice(start, end + 1),
        },
        current_delay_sec: local.current,
        predicted_delay_sec: local.predicted,
        risk_probability: local.probability,
        risk_level: local.risk,
      };
    }),
  );
  // Route status summarizes the worst local issue; it is never used to paint the entire path.
  for (const route of routes) {
    const issues = [
      ...vehicles.filter((v) => v.route_id === route.id),
      ...segments.filter((s) => s.route_id === route.id),
    ];
    const worst = issues.reduce((a, b) =>
      a.risk_probability >= b.risk_probability ? a : b,
    );
    route.current_delay_sec = Math.max(
      ...issues.map((v) => v.current_delay_sec),
    );
    route.predicted_delay_sec = Math.max(
      ...issues.map((v) => v.predicted_delay_sec),
    );
    route.risk_probability = worst.risk_probability;
    route.risk_level = worst.risk_level;
  }
  const alerts: AlertDto[] = routes
    .filter(
      (r) =>
        r.risk_level === "critical" ||
        r.risk_level === "high" ||
        r.risk_level === "elevated",
    )
    .map((r, i) => ({
      id: `alert-${r.id}`,
      severity: (r.risk_level === "critical"
        ? "critical"
        : r.risk_level === "high"
          ? "high"
          : "warning") as AlertDto["severity"],
      type: "predicted_delay",
      title: [
        "Растущий риск задержки",
        "Снижение скорости потока",
        "Длительная остановка",
        "Накопление задержки",
      ][i % 4],
      description: `${["Задержка в середине маршрута · остальная часть свободна", "Отстают 3 автобуса · дорога свободна", "Задержка на конечной части маршрута", "Замедление по всему маршруту", "Два отдельных проблемных участка"][routes.findIndex((route) => route.id === r.id)] || r.name}`,
      route_id: r.id,
      vehicle_id: vehicles
        .filter((v) => v.route_id === r.id)
        .sort((a, b) => b.risk_probability - a.risk_probability)[0].id,
      risk_probability: r.risk_probability,
      predicted_delay_sec: r.predicted_delay_sec,
      created_at: new Date(Date.now() - (i + 1) * 60000).toISOString(),
    }))
    .sort((a, b) => b.risk_probability - a.risk_probability);
  const avg = (k: "current_delay_sec" | "predicted_delay_sec") =>
    Math.round(vehicles.reduce((s, v) => s + v[k], 0) / vehicles.length);
  const normal = vehicles.filter(
    (v) => v.current_delay_sec < 120 && v.risk_level === "normal",
  ).length;
  const delayed = vehicles.filter((v) => v.current_delay_sec >= 120).length;
  const summary: NetworkSummaryDto = {
    timestamp: new Date().toISOString(),
    vehicles_total: vehicles.length + 4,
    vehicles_active: vehicles.length,
    routes_active: routes.length,
    on_time_percent: (normal / vehicles.length) * 100,
    at_risk_percent:
      ((vehicles.length - normal - delayed) / vehicles.length) * 100,
    delayed_percent: (delayed / vehicles.length) * 100,
    average_delay_sec: avg("current_delay_sec"),
    average_predicted_delay_sec: avg("predicted_delay_sec"),
  };
  const points: DelayPointDto[] = Array.from({ length: 85 }, (_, i) => {
    const offsetSec = i <= 24 ? (i - 24) * 300 : (i - 24) * 15;
    return {
      timestamp: new Date(Date.now() + offsetSec * 1000).toISOString(),
      actual_delay_sec:
        i <= 24
          ? Math.round(
              avg("current_delay_sec") *
                (0.6 + i * 0.016 + Math.sin(i * 0.7) * 0.18),
            )
          : null,
      predicted_delay_sec:
        i >= 24
          ? avg("current_delay_sec") +
            ((avg("predicted_delay_sec") - avg("current_delay_sec")) *
              offsetSec) /
              900
          : null,
    };
  });
  return { routes, vehicles, alerts, summary, segments, points };
}
export const simulation = {
  seconds: 0,
  scenario: "route-primary-delay" as Scenario,
  paused: false,
  speed: 1,
  offline: false,
  error: false,
};
export const getSnapshot = () =>
  csv
    ? csv.csvSnapshot(simulation.seconds)
    : applyDispatch(scenarioSnapshot(simulation.seconds, simulation.scenario));
