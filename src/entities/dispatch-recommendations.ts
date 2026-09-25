import type { Route, Vehicle } from "./models";
import type { DispatchPlan } from "./dispatch";
import { reserveRemaining } from "./dispatch";

export interface DispatchRecommendation {
  routeId: string;
  source: "rules-v1";
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
}

/** Demo decision rules. Shared reserve is allocated once, in descending order of delay burden. */
export function recommendDispatch({
  routes,
  vehicles,
  plans,
  asOf,
  demo,
  online = true,
}: {
  routes: Route[];
  vehicles: Vehicle[];
  plans: DispatchPlan[];
  asOf?: string;
  demo: boolean;
  online?: boolean;
}): DispatchRecommendation[] {
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
