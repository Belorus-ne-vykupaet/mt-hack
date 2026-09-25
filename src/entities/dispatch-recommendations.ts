import type { Geometry, Route, Vehicle } from "./models";
import type { DispatchPlan } from "./dispatch";
import { reserveRemaining } from "./dispatch";
import { buildRouteLines } from "./route-line";
import { decideDispatch } from "./dispatch-decisions";
import type { DecisionKind, DispatchDecision } from "./dispatch-decisions";
import { DEFAULT_DISPATCH_SETTINGS } from "./dispatch-settings";
import type { DispatchSettings } from "./dispatch-settings";

export interface DispatchRecommendation {
  routeId: string;
  source: "rules-v1" | "rules-v2";
  asOf: string;
  status: "suggested" | "keep" | "unavailable" | "active";
  currentFleet: number;
  targetFleet: number;
  stopId: string | null;
  stopName: string | null;
  currentDwellSec: number | null;
  targetDwellSec: number | null;
  cycleMin: number | null;
  predictedDelaySec: number | null;
  // Prediction of delay is not evidence of the causal effect of an intervention.
  predictedDelayAfterActionSec: null;
  affectedVehicles: number;
  reasons: string[];
  /** rules-v2: concrete actions for this route, best first, with deadline and effect. */
  decisions?: DispatchDecision[];
  vehicleId?: string | null;
  decisionKind?: DecisionKind | null;
  dwellStops?: number | null;
  deadlineAt?: string | null;
  priority?: number;
}

/**
 * Demo decision rules. With route geometry (rules-v2) every bus is placed on its line and gets a
 * concrete action; without it (rules-v1) the route-level rules below are used.
 * Shared reserve is allocated once, in descending order of delay burden.
 */
export function recommendDispatch({
  routes,
  vehicles,
  plans,
  asOf,
  demo,
  online = true,
  geometries,
  settings = DEFAULT_DISPATCH_SETTINGS,
}: {
  routes: Route[];
  vehicles: Vehicle[];
  plans: DispatchPlan[];
  asOf?: string;
  demo: boolean;
  online?: boolean;
  geometries?: Geometry[];
  settings?: DispatchSettings;
}): DispatchRecommendation[] {
  if (geometries?.length)
    return recommendFromDecisions({
      routes,
      vehicles,
      plans,
      asOf,
      demo,
      online,
      geometries,
      settings,
    });
  const now = Date.parse(asOf || "");
  let available = demo ? Math.max(0, reserveRemaining(plans)) : 0;
  const candidates = routes
    .map((route) => {
      const fresh = vehicles.filter(
        (v) =>
          v.routeId === route.id &&
          v.hasForecast !== false &&
          v.currentDelayKnown !== false &&
          !v.telemetryStale &&
          Number.isFinite(v.predictedDelaySec) &&
          Number.isFinite(v.currentDelaySec) &&
          Number.isFinite(now) &&
          now - Date.parse(v.updatedAt) >= 0 &&
          now - Date.parse(v.updatedAt) <= 180000,
      );
      const affected = fresh.filter((v) => v.predictedDelaySec >= 120);
      const burden = affected.reduce((sum, v) => sum + v.predictedDelaySec, 0);
      return { route, fresh, affected, burden };
    })
    .sort(
      (a, b) => b.burden - a.burden || a.route.id.localeCompare(b.route.id),
    );

  return candidates.map(({ route, fresh, affected, burden }) => {
    const active = plans.find(
      (p) => p.routeId === route.id && p.status === "active",
    );
    const rec: DispatchRecommendation = {
      routeId: route.id,
      source: "rules-v1",
      asOf: asOf || "",
      status: "keep",
      currentFleet: route.activeVehicleCount,
      targetFleet: route.activeVehicleCount,
      stopId: null,
      stopName: null,
      currentDwellSec: null,
      targetDwellSec: null,
      cycleMin: demo ? active?.cycleMin || 120 : null,
      predictedDelaySec: fresh.length
        ? Math.max(...fresh.map((v) => v.predictedDelaySec))
        : null,
      predictedDelayAfterActionSec: null,
      affectedVehicles: affected.length,
      reasons: [],
    };
    if (!demo) {
      rec.status = "unavailable";
      rec.reasons.push(
        "Нужны подтверждённые данные о резерве, обороте и допустимой стоянке.",
      );
      return rec;
    }
    if (!online) {
      rec.status = "unavailable";
      rec.reasons.push(
        "Поток данных недоступен. Подсказки возобновятся после восстановления связи.",
      );
      return rec;
    }
    if (active) {
      rec.status = "active";
      rec.targetFleet = active.targetFleet;
      rec.stopId = active.stopId;
      rec.stopName = active.stopName;
      rec.currentDwellSec = rec.targetDwellSec = active.targetDwellSec;
      rec.reasons.push(
        "Сценарий уже применён. Оцените результат или отмените его перед новой подсказкой.",
      );
      return rec;
    }
    if (
      route.activeVehicleCount < 1 ||
      fresh.length < Math.max(1, route.activeVehicleCount / 2)
    ) {
      rec.status = "unavailable";
      rec.reasons.push(
        "Недостаточно свежей телеметрии: выпуск и стоянки оставлены без изменений.",
      );
      return rec;
    }
    const worst = [...fresh].sort(
      (a, b) =>
        b.predictedDelaySec - a.predictedDelaySec || a.id.localeCompare(b.id),
    );
    const target = worst.find((v) =>
      route.stops.some((s) => s.id === v.nextStop?.id),
    );
    if (target?.nextStop) {
      rec.stopId = target.nextStop.id;
      rec.stopName = target.nextStop.name;
      rec.currentDwellSec = rec.targetDwellSec = 30;
      if (target.predictedDelaySec >= 120) {
        rec.targetDwellSec = 20;
        rec.reasons.push(
          "На следующей остановке отстающего автобуса: 30 → 20 с, если посадка завершена. Выигрыш — до 10 с на прохождение.",
        );
      } else if (
        worst.every((v) => v.currentDelaySec <= -30 && v.predictedDelaySec <= 0)
      ) {
        rec.targetDwellSec =
          30 + Math.min(60, Math.floor(-target.currentDelaySec / 10) * 10);
        rec.reasons.push(
          "Автобусы опережают график. Короткое удержание на выбранной остановке поможет не уехать раньше расписания.",
        );
      }
    }
    const fraction = affected.length / fresh.length;
    const wanted =
      affected.length >= 2 && fraction >= 0.25
        ? fraction >= 0.5 && burden / affected.length >= 240
          ? 2
          : 1
        : 0;
    const extra = Math.min(
      wanted,
      available,
      Math.max(0, 500 - rec.currentFleet),
    );
    if (wanted) {
      available -= extra;
      rec.targetFleet += extra;
      rec.reasons.push(
        extra
          ? `${affected.length} из ${fresh.length} автобусов рискуют задержаться. +${extra} из общего резерва — вариант сокращения интервала со следующего оборота; пробку это не убирает.`
          : "Свободный резерв распределён между более приоритетными маршрутами. Увеличение выпуска пока не предложено.",
      );
    } else if (affected.length)
      rec.reasons.push(
        "Проблема локальная: массовое увеличение выпуска пока не предложено.",
      );
    if (!rec.stopId)
      rec.reasons.push(
        "Следующая остановка не сопоставлена с маршрутом; стоянка не меняется.",
      );
    rec.status =
      rec.targetFleet !== rec.currentFleet ||
      rec.targetDwellSec !== rec.currentDwellSec
        ? "suggested"
        : "keep";
    if (!rec.reasons.length)
      rec.reasons.push(
        "Выраженного риска задержки нет. Сохраните текущие параметры.",
      );
    return rec;
  });
}

function recommendFromDecisions({
  routes,
  vehicles,
  plans,
  asOf,
  demo,
  online,
  geometries,
  settings,
}: {
  routes: Route[];
  vehicles: Vehicle[];
  plans: DispatchPlan[];
  asOf?: string;
  demo: boolean;
  online: boolean;
  geometries: Geometry[];
  settings: DispatchSettings;
}): DispatchRecommendation[] {
  const activeRoutes = new Set(
    plans.filter((p) => p.status === "active").map((p) => p.routeId),
  );
  const { analyses, byRoute, reserveShort } = decideDispatch({
    lines: buildRouteLines(routes, vehicles, geometries),
    settings,
    asOf: asOf || "",
    reserve: demo ? Math.max(0, reserveRemaining(plans)) : 0,
    blockedRoutes: activeRoutes,
  });
  const recommendations = routes.map((route) => {
    const analysis = analyses.get(route.id);
    const decisions = byRoute.get(route.id) || [];
    const active = plans.find(
      (p) => p.routeId === route.id && p.status === "active",
    );
    const fresh = analysis?.fresh || [];
    const rec: DispatchRecommendation = {
      routeId: route.id,
      source: "rules-v2",
      asOf: asOf || "",
      status: "keep",
      currentFleet: route.activeVehicleCount,
      targetFleet: route.activeVehicleCount,
      stopId: null,
      stopName: null,
      currentDwellSec: null,
      targetDwellSec: null,
      cycleMin: demo ? active?.cycleMin || settings.cycleMin : null,
      predictedDelaySec: fresh.length
        ? Math.max(...fresh.map((b) => b.vehicle.predictedDelaySec))
        : null,
      predictedDelayAfterActionSec: null,
      affectedVehicles: analysis?.late.length || 0,
      reasons: [],
      decisions,
      vehicleId: null,
      decisionKind: null,
      dwellStops: null,
      deadlineAt: null,
      priority: 0,
    };
    if (!demo) {
      rec.status = "unavailable";
      rec.decisions = [];
      rec.reasons.push(
        "Нужны подтверждённые данные о резерве, обороте и допустимой стоянке.",
      );
      return rec;
    }
    if (!online) {
      rec.status = "unavailable";
      rec.decisions = [];
      rec.reasons.push(
        "Поток данных недоступен. Подсказки возобновятся после восстановления связи.",
      );
      return rec;
    }
    if (active) {
      rec.status = "active";
      rec.targetFleet = active.targetFleet;
      rec.stopId = active.stopId;
      rec.stopName = active.stopName;
      rec.currentDwellSec = rec.targetDwellSec = active.targetDwellSec;
      rec.vehicleId = active.vehicleId || null;
      rec.reasons.push(
        "Сценарий уже применён. Оцените результат или отмените его перед новой подсказкой.",
      );
      return rec;
    }
    if (analysis?.status !== "ok") {
      rec.status = "unavailable";
      rec.reasons.push(
        analysis?.status === "no_geometry"
          ? "Нет геометрии маршрута: автобусы не сопоставлены с дорогой."
          : "Недостаточно свежей телеметрии: выпуск и стоянки оставлены без изменений.",
      );
      return rec;
    }
    const primary = decisions.find((d) => d.kind !== "add_bus");
    const fleet = decisions.find((d) => d.kind === "add_bus");
    if (primary?.dwell) {
      rec.stopId = primary.stopId || null;
      rec.stopName = primary.stopName || null;
      rec.currentDwellSec = primary.dwell.baseSec;
      rec.targetDwellSec = primary.dwell.targetSec;
      rec.dwellStops = primary.dwell.stops;
      rec.vehicleId = primary.vehicleId || null;
      rec.decisionKind = primary.kind;
      rec.reasons.push(`${primary.title}. ${primary.summary}`);
    }
    if (fleet?.fleet) {
      rec.targetFleet = fleet.fleet.target;
      if (!primary) rec.decisionKind = fleet.kind;
      rec.reasons.push(`${fleet.title}. ${fleet.summary}`);
    } else if (reserveShort.has(route.id))
      rec.reasons.push(
        "Свободный резерв распределён между более приоритетными маршрутами. Увеличение выпуска пока не предложено.",
      );
    rec.deadlineAt = (primary || fleet)?.deadlineAt || null;
    rec.priority = Math.max(0, ...decisions.map((d) => d.priority));
    rec.status = primary || fleet ? "suggested" : "keep";
    if (!rec.reasons.length)
      rec.reasons.push(
        "Выраженного риска нет: интервалы и график в норме. Сохраните текущие параметры.",
      );
    return rec;
  });
  const rank = { suggested: 0, active: 1, keep: 2, unavailable: 3 };
  return recommendations.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (b.priority || 0) - (a.priority || 0) ||
      (b.predictedDelaySec || 0) - (a.predictedDelaySec || 0) ||
      a.routeId.localeCompare(b.routeId),
  );
}
