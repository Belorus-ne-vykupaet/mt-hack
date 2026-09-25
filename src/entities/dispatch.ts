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
