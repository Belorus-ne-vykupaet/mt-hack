import { riskFromDelay as csvRisk } from "./forecast";
import { evaluatePlan } from "./dispatch";
import type { DispatchPlan } from "./dispatch";
import type { scenarioSnapshot } from "../mocks/scenario";
type Snapshot = ReturnType<typeof scenarioSnapshot>;
// A sandbox overlay. Never sends a command or changes observed telemetry in API/CSV mode.
export function simulateDispatch(
  snapshot: Snapshot,
  allPlans: DispatchPlan[],
): Snapshot {
  const plans = allPlans.filter((p) => p.status === "active");
  if (!plans.length) return snapshot;
  const s = structuredClone(snapshot);
  for (const plan of plans) {
    const route = s.routes.find((r) => r.id === plan.routeId);
    if (!route || !route.stops.some((stop) => stop.id === plan.stopId))
      continue;
    let estimate;
    try {
      estimate = evaluatePlan(plan);
    } catch {
      continue;
    }
    const local = s.vehicles.filter((v) => v.route_id === route.id),
      kept = local.slice(0, plan.targetFleet);
    const template = local[0];
    if (!template) continue;
    for (let i = local.length; i < plan.targetFleet; i++)
      kept.push({
        ...template,
        id: `reserve-${route.id}-${i}`,
        position: route.stops[0].position,
        next_stop: route.stops[0],
        speed_kmh: 0,
        current_delay_sec: 0,
        predicted_delay_sec: 0,
        risk_probability: 0,
        risk_level: "normal",
      });
    const targetStop = route.stops.find((stop) => stop.id === plan.stopId)!;
    for (const v of kept) {
      // Apply one future dwell adjustment only before this stop; does not remove road congestion.
      const distanceM =
        Math.hypot(
          (v.position.lon - targetStop.position.lon) *
            Math.cos((v.position.lat * Math.PI) / 180),
          v.position.lat - targetStop.position.lat,
        ) * 111195;
      if (
        v.next_stop.id === plan.stopId &&
        (distanceM < 100 ||
          (v.speed_kmh > 0 && distanceM / (v.speed_kmh / 3.6) < 900)) &&
        !v.id.startsWith("reserve-")
      ) {
        v.predicted_delay_sec = Math.max(
          -300,
          v.predicted_delay_sec + estimate.dwellDelta,
        );
        v.risk_level = csvRisk(v.predicted_delay_sec);
      }
    }
    s.vehicles = s.vehicles.filter((v) => v.route_id !== route.id).concat(kept);
    route.vehicle_count = kept.length;
    const issues = [
      ...kept,
      ...s.segments.filter((seg) => seg.route_id === route.id),
    ];
    route.predicted_delay_sec = Math.max(
      ...issues.map((v) => v.predicted_delay_sec),
    );
    route.risk_level = csvRisk(route.predicted_delay_sec);
    for (const a of s.alerts.filter((a) => a.route_id === route.id)) {
      a.predicted_delay_sec = route.predicted_delay_sec;
      a.vehicle_id = kept[0].id;
    }
  }
  s.summary.vehicles_active = s.vehicles.length;
  s.summary.average_delay_sec =
    s.vehicles.reduce((n, v) => n + v.current_delay_sec, 0) /
    (s.vehicles.length || 1);
  s.summary.average_predicted_delay_sec =
    s.vehicles.reduce((n, v) => n + v.predicted_delay_sec, 0) /
    (s.vehicles.length || 1);
  const delayed = s.vehicles.filter((v) => v.current_delay_sec >= 120).length;
  const atRisk = s.vehicles.filter(
    (v) => v.current_delay_sec < 120 && v.risk_level !== "normal",
  ).length;
  s.summary.delayed_percent = (delayed / s.vehicles.length) * 100;
  s.summary.at_risk_percent = (atRisk / s.vehicles.length) * 100;
  s.summary.on_time_percent =
    ((s.vehicles.length - delayed - atRisk) / s.vehicles.length) * 100;
  const now = Date.parse(s.summary.timestamp);
  s.points = s.points.map((p) =>
    p.predicted_delay_sec === null
      ? p
      : {
          ...p,
          predicted_delay_sec:
            s.summary.average_delay_sec +
            ((s.summary.average_predicted_delay_sec -
              s.summary.average_delay_sec) *
              Math.max(0, Date.parse(p.timestamp) - now)) /
              900000,
        },
  );
  return s;
}
