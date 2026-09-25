import { describe, expect, it } from "vitest";
import { recommendDispatch } from "../src/entities/dispatch-recommendations";
import type { Route, Vehicle } from "../src/entities/models";
import type { DispatchPlan } from "../src/entities/dispatch";
const asOf = "2026-09-23T07:30:00Z";
const stop = {
  id: "stop",
  name: "Остановка",
  sequence: 1,
  position: { lat: 55.75, lon: 37.6 },
};
const route = (id: string): Route => ({
  id,
  number: id,
  name: id,
  transportType: "bus",
  currentDelaySec: 300,
  predictedDelaySec: 400,
  riskProbability: 0.9,
  riskLevel: "high",
  activeVehicleCount: 4,
  stops: [stop],
});
const buses = (id: string, delays: number[]): Vehicle[] =>
  delays.map((delay, i) => ({
    id: `${id}-${i}`,
    routeId: id,
    position: stop.position,
    speedKmh: 20,
    currentDelaySec: delay,
    predictedDelaySec: delay,
    riskProbability: 0.9,
    riskLevel: "high",
    nextStop: stop,
    updatedAt: asOf,
  }));
const input = (delays = [400, 400, 0, 0]) => ({
  routes: [route("A")],
  vehicles: buses("A", delays),
  plans: [] as DispatchPlan[],
  asOf,
  demo: true,
});
describe("dispatch recommendations", () => {
  it("allocates a shared reserve across routes by delay burden, never offering the same bus twice", () => {
    const data = {
      ...input(),
      routes: ["A", "B", "C"].map(route),
      vehicles: [
        ...buses("A", [600, 600, 600, 600]),
        ...buses("B", [400, 400, 400, 400]),
        ...buses("C", [300, 300, 300, 300]),
      ],
    };
    const before = structuredClone(data);
    const recs = recommendDispatch(data);
    expect(recs.map((r) => r.targetFleet - r.currentFleet)).toEqual([2, 2, 0]);
    expect(recs[2].reasons.join(" ")).toContain("резерв распределён");
    expect(data).toEqual(before);
    expect(recs.every((r) => r.predictedDelayAfterActionSec === null)).toBe(
      true,
    );
  });
  it("targets a delayed vehicle’s next stop, without blanket fleet growth for a local issue", () => {
    const [rec] = recommendDispatch(input([0, 400, 0, 0]));
    expect(rec).toMatchObject({
      targetFleet: 4,
      stopId: "stop",
      currentDwellSec: 30,
      targetDwellSec: 20,
      status: "suggested",
    });
    expect(rec.reasons.join(" ")).toContain("локальная");
    const [healthy] = recommendDispatch(input([0, 10, 20, 0]));
    expect(healthy).toMatchObject({
      status: "keep",
      targetFleet: 4,
      targetDwellSec: 30,
    });
    const [early] = recommendDispatch(input([-50, -50, -50, -50]));
    expect(early.targetDwellSec).toBe(80);
  });
  it("abstains on stale, future, absent or insufficient telemetry and on unconfigured real/archive policy", () => {
    expect(recommendDispatch({ ...input(), online: false })[0]).toMatchObject({
      status: "unavailable",
      targetFleet: 4,
    });
    for (const timestamp of [
      "2026-09-23T07:20:00Z",
      "2026-09-23T07:31:00Z",
      "bad",
    ]) {
      const data = input();
      data.vehicles.forEach((v) => (v.updatedAt = timestamp));
      expect(recommendDispatch(data)[0]).toMatchObject({
        status: "unavailable",
        targetFleet: 4,
        targetDwellSec: null,
      });
    }
    expect(recommendDispatch({ ...input(), vehicles: [] })[0].status).toBe(
      "unavailable",
    );
    expect(recommendDispatch({ ...input(), demo: false })[0]).toMatchObject({
      status: "unavailable",
      cycleMin: null,
      targetDwellSec: null,
    });
  });
  it("does not stack suggestions on an applied scenario or reuse its reserved buses", () => {
    const plan: DispatchPlan = {
      id: "plan",
      routeId: "A",
      routeNumber: "A",
      baseFleet: 4,
      targetFleet: 8,
      cycleMin: 120,
      stopId: "stop",
      stopName: "Остановка",
      baseDwellSec: 30,
      targetDwellSec: 20,
      createdAt: asOf,
      status: "active",
    };
    const data = {
      ...input(),
      routes: [{ ...route("A"), activeVehicleCount: 8 }, route("B")],
      vehicles: [
        ...buses("A", [400, 400, 400, 400, 400, 400, 400, 400]),
        ...buses("B", [300, 300, 300, 300]),
      ],
      plans: [plan],
    };
    const recs = recommendDispatch(data);
    expect(recs.find((r) => r.routeId === "A")).toMatchObject({
      status: "active",
      targetFleet: 8,
      currentDwellSec: 20,
      targetDwellSec: 20,
    });
    expect(recs.find((r) => r.routeId === "B")!.targetFleet).toBe(4);
  });
  it("does not invent a stop or reduce dwell when a vehicle cannot be matched", () => {
    const data = input();
    data.vehicles.forEach((v) => (v.nextStop = { ...stop, id: "unknown" }));
    expect(recommendDispatch(data)[0]).toMatchObject({
      stopId: null,
      targetDwellSec: null,
    });
  });
});
