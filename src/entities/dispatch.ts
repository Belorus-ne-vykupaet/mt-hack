export interface DispatchPlan {
  id: string;
  routeId: string;
  routeNumber: string;
  baseFleet: number;
  targetFleet: number;
  cycleMin: number;
  stopId: string;
  stopName: string;
  baseDwellSec: number;
  targetDwellSec: number;
  createdAt: string;
  status: "draft" | "active" | "cancelled" | "replaced";
  /** Set when the dwell change targets one bus instead of every bus reaching the stop. */
  vehicleId?: string;
  decisionKind?: string;
  /** Stops at which the new dwell applies to the targeted bus (1 = only the given stop). */
  dwellStops?: number;
}
export const DECISION_KINDS = [
  "hold_early",
  "hold_bunching",
  "shorten_late",
  "shorten_all",
  "add_bus",
];
/** Optional targeting fields of a plan; unknown or malformed values are dropped. */
export function planTarget(plan: Partial<DispatchPlan>) {
  const target: Pick<DispatchPlan, "vehicleId" | "decisionKind" | "dwellStops"> =
    {};
  if (
    typeof plan.vehicleId === "string" &&
    plan.vehicleId.length > 0 &&
    plan.vehicleId.length <= 100
  )
    target.vehicleId = plan.vehicleId;
  if (
    typeof plan.decisionKind === "string" &&
    DECISION_KINDS.includes(plan.decisionKind)
  )
    target.decisionKind = plan.decisionKind;
  if (
    Number.isInteger(plan.dwellStops) &&
    plan.dwellStops! >= 1 &&
    plan.dwellStops! <= 60
  )
    target.dwellStops = plan.dwellStops;
  return target;
}
export function evaluatePlan(
  plan: Pick<
    DispatchPlan,
    "baseFleet" | "targetFleet" | "cycleMin" | "baseDwellSec" | "targetDwellSec"
  >,
) {
  if (
    ![plan.baseFleet, plan.targetFleet].every(
      (v) => Number.isInteger(v) && v >= 1 && v <= 500,
    )
  )
    throw new Error("На маршруте должен оставаться минимум один автобус.");
  if (
    !Number.isFinite(plan.cycleMin) ||
    plan.cycleMin < 10 ||
    plan.cycleMin > 360
  )
    throw new Error("Укажите время оборота от 10 до 360 минут.");
  if (
    ![plan.baseDwellSec, plan.targetDwellSec].every(
      (v) => Number.isInteger(v) && v >= 5 && v <= 300,
    )
  )
    throw new Error("Стоянка: от 5 до 300 секунд.");
  const dwellDelta = plan.targetDwellSec - plan.baseDwellSec;
  return {
    fleetDelta: plan.targetFleet - plan.baseFleet,
    headwayBefore: plan.cycleMin / plan.baseFleet,
    headwayAfter: (plan.cycleMin + dwellDelta / 60) / plan.targetFleet,
    dwellDelta,
  };
}
export function reserveRemaining(
  plans: DispatchPlan[],
  candidate?: DispatchPlan,
) {
  const active = plans.filter(
    (p) => p.status === "active" && p.routeId !== candidate?.routeId,
  );
  if (candidate) active.push(candidate);
  return 4 - active.reduce((n, p) => n + evaluatePlan(p).fleetDelta, 0);
}
