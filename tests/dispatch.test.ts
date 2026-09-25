import { beforeEach, it, expect } from "vitest";
import { evaluatePlan, reserveRemaining } from "../src/entities/dispatch";
import type { DispatchPlan } from "../src/entities/dispatch";
import { useDispatch } from "../src/app/dispatch-store";
import { scenarioSnapshot } from "../src/mocks/scenario";
import { applyDispatch } from "../src/mocks/dispatch-scenario";
const base: DispatchPlan = {
  id: "test",
  routeId: "м3",
  routeNumber: "м3",
  baseFleet: 8,
  targetFleet: 10,
  cycleMin: 120,
  stopId: "",
  stopName: "",
  baseDwellSec: 30,
  targetDwellSec: 15,
  createdAt: "2026-09-23T00:00:00Z",
  status: "active",
};
beforeEach(() => useDispatch.setState({ plans: [] }));
it("fleet changes affect headway; dwell changes affect one passage only", () => {
  const estimate = evaluatePlan(base);
  expect(estimate.headwayBefore).toBe(15);
  expect(estimate.headwayAfter).toBe(11.975);
  expect(estimate.dwellDelta).toBe(-15);
  expect(() => evaluatePlan({ ...base, targetFleet: 0 })).toThrow();
  expect(() => evaluatePlan({ ...base, targetDwellSec: NaN })).toThrow();
});
it("shares reserve across routes, replaces one active plan, cancels without rollback of other routes", () => {
  const store = useDispatch.getState();
  store.save(base, true);
  store.save({ ...base, id: "other", routeId: "с344" }, true);
  expect(reserveRemaining(useDispatch.getState().plans)).toBe(0);
  expect(() =>
    store.save({ ...base, id: "excess", routeId: "м40" }, true),
  ).toThrow();
  store.save({ ...base, id: "replace", targetFleet: 9 }, true);
  expect(reserveRemaining(useDispatch.getState().plans)).toBe(1);
  store.cancel("replace");
  expect(reserveRemaining(useDispatch.getState().plans)).toBe(2);
  expect(
    useDispatch.getState().plans.find((p) => p.id === "other")!.status,
  ).toBe("active");
});
it("updates demo fleet and scoped forecasts without mutating the original snapshot; undo restores it", () => {
  const original = scenarioSnapshot(30),
    vehicle = original.vehicles[0];
  const plan = { ...base, stopId: vehicle.next_stop.id, targetDwellSec: 60 };
  useDispatch.getState().save(plan, true);
  const updated = applyDispatch(original);
  expect(updated.vehicles).toHaveLength(122);
  expect(updated.summary.vehicles_active).toBe(122);
  expect(original.vehicles).toHaveLength(120);
  expect(updated.routes.find((r) => r.id === "м3")!.vehicle_count).toBe(10);
  expect(
    updated.vehicles.find((v) => v.id === vehicle.id)!.predicted_delay_sec,
  ).toBe(vehicle.predicted_delay_sec + 30);
  expect(updated.segments).toEqual(original.segments);
  expect(updated.vehicles.filter((v) => v.route_id !== "м3")).toEqual(
    original.vehicles.filter((v) => v.route_id !== "м3"),
  );
  useDispatch.getState().cancel("test");
  expect(applyDispatch(original)).toEqual(original);
});
