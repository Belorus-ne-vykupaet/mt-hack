import type { DemoRouteDto as RouteDto, DemoVehicleDto as VehicleDto } from "./types";
import { riskFromDelay as csvRisk } from "../entities/forecast";
import imported from "../data/imported-feed.json";
import type {
  NetworkSummaryDto,
  DelayPointDto,
  AlertDto,
  SegmentDto,
  RouteGeometryDto,
} from "../shared/api/generated/models";
export const csvFeed = imported;
export const csvGeometries = imported.geometries as RouteGeometryDto[];
// Persistence baseline: only already observed delay; no future CSV rows enter a prediction.
export function csvSnapshot(elapsedSec: number) {
  const cutoff = Math.min(
    Date.parse(imported.end),
    Date.parse(imported.start) + Math.max(0, elapsedSec) * 1000,
  );
  const latest = new Map<string, VehicleDto>();
  const history = new Map<string, number[]>();
  for (const obs of imported.observations) {
    if (Date.parse(obs.updated_at) > cutoff) break;
    latest.set(obs.id, {
      ...obs,
      status: "active",
      risk_level: csvRisk(obs.current_delay_sec),
    });
    const values = history.get(obs.updated_at) || [];
    values.push(obs.current_delay_sec);
    history.set(obs.updated_at, values);
  }
  const vehicles = [...latest.values()].filter(
    (v) => cutoff - Date.parse(v.updated_at) <= 180000,
  );
  const routes: RouteDto[] = imported.routes.map((r) => {
    const local = vehicles.filter((v) => v.route_id === r.id);
    const delay = local.length
      ? Math.max(...local.map((v) => v.current_delay_sec))
      : 0;
    return {
      ...r,
      transport_type: "bus",
      vehicle_count: local.length,
      current_delay_sec: delay,
      predicted_delay_sec: delay,
      risk_level: csvRisk(delay),
    };
  });
  const average =
    vehicles.reduce((n, v) => n + v.current_delay_sec, 0) /
    (vehicles.length || 1);
  const delayed = vehicles.filter((v) => v.current_delay_sec >= 120).length;
  const timestamp = new Date(cutoff).toISOString();
  const summary: NetworkSummaryDto = {
    timestamp,
    vehicles_total: new Set(imported.observations.map((v) => v.id)).size,
    vehicles_active: vehicles.length,
    routes_active: routes.filter((r) => r.vehicle_count > 0).length,
    on_time_percent: vehicles.length
      ? ((vehicles.length - delayed) / vehicles.length) * 100
      : 0,
    at_risk_percent: 0,
    delayed_percent: vehicles.length ? (delayed / vehicles.length) * 100 : 0,
    average_delay_sec: average,
    average_predicted_delay_sec: average,
  };
  const alerts: AlertDto[] = routes
    .filter((r) => r.current_delay_sec >= 120)
    .map((r) => ({
      id: `csv-${r.id}`,
      type: "delay_risk",
      route_id: r.id,
      vehicle_id: vehicles.find(
        (v) =>
          v.route_id === r.id && v.current_delay_sec === r.current_delay_sec,
      )!.id,
      severity:
        r.risk_level === "elevated"
          ? "warning"
          : (r.risk_level as "high" | "critical"),
      title: "Задержка по данным CSV",
      description: "Базовый прогноз: текущая задержка сохранится",
      risk_probability: 0,
      predicted_delay_sec: r.predicted_delay_sec,
      created_at: timestamp,
    }));
  const points: DelayPointDto[] = [...history].map(([time, values]) => ({
    timestamp: time,
    actual_delay_sec: values.reduce((a, b) => a + b, 0) / values.length,
    predicted_delay_sec: null,
  }));
  points.push(
    ...[0, 300, 600, 900].map((offset) => ({
      timestamp: new Date(cutoff + offset * 1000).toISOString(),
      actual_delay_sec: null,
      predicted_delay_sec: average,
    })),
  );
  // Without segment-level measurements, do not invent congestion for a whole street.
  const segments: SegmentDto[] = [];
  return { routes, vehicles, summary, alerts, points, segments };
}
