import { describe, expect, it } from "vitest";
import { buildRouteLines } from "../src/entities/route-line";
import {
  analyzeRoute,
  averageWait,
  decideDispatch,
} from "../src/entities/dispatch-decisions";
import { DEFAULT_DISPATCH_SETTINGS } from "../src/entities/dispatch-settings";
import { recommendDispatch } from "../src/entities/dispatch-recommendations";
import type { Geometry, Route, Stop, Vehicle } from "../src/entities/models";

// A straight 12 km street: 1° of longitude at this latitude ≈ 62.6 km.
const LAT = 55.75,
  LON = 37.5,
  M_PER_DEG = 111195 * Math.cos((LAT * Math.PI) / 180);
const at = (m: number) => ({ lat: LAT, lon: LON + m / M_PER_DEG });
const asOf = "2026-09-25T07:30:00Z";
const settings = DEFAULT_DISPATCH_SETTINGS;
const H = (settings.cycleMin * 60) / 8;
const geometry = (id: string): Geometry => ({
  routeId: id,
  coordinates: Array.from({ length: 121 }, (_, i) => {
    const p = at(i * 100);
    return [p.lon, p.lat];
  }),
});
const stops = (id: string): Stop[] =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `${id}-s${i + 1}`,
    name: `Остановка ${i + 1}`,
    sequence: i + 1,
    position: at(200 + i * 400),
  }));
const route = (id: string, fleet = 8): Route => ({
  id,
  number: id,
  name: id,
  transportType: "bus",
  currentDelaySec: 0,
  predictedDelaySec: 0,
  riskProbability: 0.1,
  riskLevel: "normal",
  activeVehicleCount: fleet,
  stops: stops(id),
});
const bus = (
  id: string,
  routeId: string,
  m: number,
  delay = 0,
  predicted = delay,
  speedKmh = 18,
  updatedAt = asOf,
): Vehicle => ({
  id,
  routeId,
  position: at(m),
  speedKmh,
  currentDelaySec: delay,
  predictedDelaySec: predicted,
  riskProbability: 0.1,
  riskLevel: "normal",
  nextStop: stops(routeId)[0],
  updatedAt,
});
// Eight buses 1.5 km apart — exactly one planned headway.
const even = (routeId: string, overrides: Record<number, Partial<Vehicle>> = {}) =>
  Array.from({ length: 8 }, (_, i) => ({
    ...bus(`${routeId}-${i}`, routeId, 450 + i * 1500),
    ...overrides[i],
  }));
const decide = (
  routes: Route[],
  vehicles: Vehicle[],
  reserve = 4,
  geometries = routes.map((r) => geometry(r.id)),
) =>
  decideDispatch({
    lines: buildRouteLines(routes, vehicles, geometries),
    settings,
    asOf,
    reserve,
  });

describe("route lines", () => {
  it("orders stops and buses along the road and refuses off-track telemetry", () => {
    const vehicles = [
      bus("A-far", "A", 3000),
      bus("A-near", "A", 1000),
      { ...bus("A-off", "A", 2000), position: { lat: LAT + 0.01, lon: at(2000).lon } },
    ];
    const [line] = buildRouteLines([route("A")], vehicles, [geometry("A")]);
    expect(line.length).toBeGreaterThan(11900);
    expect(line.stops.map((s) => s.stop.sequence)).toEqual(
      [...line.stops].map((s) => s.stop.sequence).sort((a, b) => a - b),
    );
    expect(line.buses.map((b) => b.vehicle.id)).toEqual(["A-near", "A-far"]);
    expect(Math.round(line.buses[0].along)).toBeCloseTo(1000, -1);
    expect(line.unmatched.map((v) => v.id)).toEqual(["A-off"]);
  });
  it("converts spacing into headways and computes the passenger wait", () => {
    const [line] = buildRouteLines([route("A")], even("A"), [geometry("A")]);
    const analysis = analyzeRoute(line, settings, Date.parse(asOf));
    expect(analysis.status).toBe("ok");
    expect(analysis.plannedHeadwaySec).toBe(H);
    for (const h of analysis.headwayAhead.slice(0, -1))
      expect(h).toBeCloseTo(H, -1);
    expect(analysis.headwayAhead.at(-1)).toBeNull();
    expect(averageWait([600, 600])).toBe(300);
    // Irregular service makes passengers wait longer at the same mean headway.
    expect(averageWait([300, 900])!).toBeGreaterThan(averageWait([600, 600])!);
  });
});

describe("dispatch decisions", () => {
  it("holds an early bus at its next stop, capped by the hold limit, with a deadline", () => {
    const { decisions } = decide(
      [route("A")],
      even("A", { 3: { currentDelaySec: -150, predictedDelaySec: -150 } }),
    );
    const hold = decisions.find((d) => d.vehicleId === "A-3")!;
    expect(hold.kind).toBe("hold_early");
    expect(hold.holdSec).toBe(settings.maxHoldSec);
    expect(hold.dwell).toEqual({
      baseSec: settings.baseDwellSec,
      targetSec: settings.baseDwellSec + settings.maxHoldSec,
      stops: 1,
    });
    // The bus is 50 m before its next stop at 18 km/h.
    expect(hold.stopName).toBe("Остановка 13");
    expect(hold.deadlineInSec).toBe(10);
    expect(Date.parse(hold.deadlineAt) - Date.parse(asOf)).toBe(10000);
    const delay = hold.effects.find((e) => e.format === "delay")!;
    expect([delay.before, delay.after, delay.better]).toEqual([-150, -30, true]);
    expect(hold.title).toContain("Удержать ТС A-3");
  });
  it("holds a bunched follower just enough, without making it late or crowding the bus behind", () => {
    const vehicles = even("A");
    vehicles[4] = { ...vehicles[4], position: at(450 + 5 * 1500 - 500) };
    const { decisions } = decide([route("A")], vehicles);
    const hold = decisions.find((d) => d.kind === "hold_bunching")!;
    expect(hold.vehicleId).toBe("A-4");
    // Wanted 0.8 H − 300 s, but must stay 10 s under the lateness threshold.
    expect(hold.holdSec).toBe(settings.lateSec - 10);
    const ahead = hold.effects.find((e) => e.label.startsWith("Интервал до впереди"))!;
    expect(ahead.before).toBeCloseTo(H / 3, 0);
    expect(ahead.after).toBeCloseTo(H / 3 + hold.holdSec!, 0);
    expect(ahead.better).toBe(true);
    const wait = hold.effects.find((e) => e.label.startsWith("Среднее ожидание"))!;
    expect(wait.after).toBeLessThan(wait.before);
  });
  it("shortens the stops of a late bus over its 15-minute reach and never promises running early", () => {
    const { decisions } = decide(
      [route("A")],
      even("A", {
        1: { currentDelaySec: 60, predictedDelaySec: 125, speedKmh: 25 },
        2: { currentDelaySec: 200, predictedDelaySec: 300 },
      }),
      0,
    );
    const late = decisions.find((d) => d.vehicleId === "A-2")!;
    expect(late.kind).toBe("shorten_late");
    // 18 km/h × 15 min = 4.5 km ≈ 11 stops at 400 m, 10 s each.
    expect(late.dwell).toEqual({ baseSec: 30, targetSec: 20, stops: 11 });
    const delay = late.effects.find((e) => e.format === "delay")!;
    expect([delay.before, delay.after]).toEqual([300, 190]);
    // 15 stops could save 150 s, but a 125 s delay can only shrink to zero.
    const barely = decisions.find((d) => d.vehicleId === "A-1")!;
    expect(barely.dwell!.stops).toBe(15);
    expect(barely.effects.find((e) => e.format === "delay")!.after).toBe(0);
    expect(decisions.some((d) => d.kind === "add_bus")).toBe(false);
  });
  it("ignores buses laying over at a terminal and judges spacing against the usual gap", () => {
    // Two buses wait at the first stop; six run 700 m apart — tighter than the even share, but regular.
    const vehicles = [
      bus("A-t1", "A", 200),
      bus("A-t2", "A", 210),
      ...Array.from({ length: 6 }, (_, i) => bus(`A-${i}`, "A", 1000 + i * 700)),
    ];
    const [line] = buildRouteLines([route("A")], vehicles, [geometry("A")]);
    const analysis = analyzeRoute(line, settings, Date.parse(asOf));
    expect(analysis.headwayAhead.slice(0, 2)).toEqual([null, null]);
    for (const h of analysis.headwayAhead.slice(2, -1)) expect(h).toBeCloseTo(H, 5);
    const { decisions } = decide([route("A")], vehicles);
    expect(decisions).toEqual([]);
  });
  it("speeds up the late leader of a pair, never the late bus right behind it", () => {
    const vehicles = even("A", {
      4: { currentDelaySec: 300, predictedDelaySec: 400 },
      5: { currentDelaySec: 300, predictedDelaySec: 400 },
    });
    vehicles[4] = { ...vehicles[4], position: at(450 + 5 * 1500 - 300) };
    const { byRoute } = decide([route("A")], vehicles, 0);
    const own = byRoute.get("A")!;
    expect(own.map((d) => `${d.kind}:${d.vehicleId}`)).toEqual([
      "shorten_late:A-5",
    ]);
  });
  it("answers a route-wide slowdown with one route rule, not a flood of per-bus holds", () => {
    const slow = even(
      "A",
      Object.fromEntries(
        Array.from({ length: 7 }, (_, i) => [
          i,
          { currentDelaySec: 150, predictedDelaySec: 240 },
        ]),
      ),
    );
    // Even with a free reserve: an extra bus does not speed up a slow street.
    const { byRoute } = decide([route("A")], slow, 4);
    const own = byRoute.get("A")!;
    expect(own.map((d) => d.kind)).toEqual(["shorten_all"]);
    expect(own[0].vehicleId).toBeUndefined();
    expect(own[0].summary).toContain("Отстают 7 из 8");
  });
  it("gives the shared reserve once, to the route with the heaviest delay burden", () => {
    const lateA = even("A", {
      1: { currentDelaySec: 400, predictedDelaySec: 500 },
      2: { currentDelaySec: 400, predictedDelaySec: 500 },
    });
    const lateB = even("B", {
      1: { currentDelaySec: 200, predictedDelaySec: 250 },
      2: { currentDelaySec: 200, predictedDelaySec: 250 },
    });
    const { byRoute, reserveShort } = decide(
      [route("A"), route("B")],
      [...lateA, ...lateB],
      1,
    );
    const addA = byRoute.get("A")!.find((d) => d.kind === "add_bus")!;
    expect(addA.fleet).toEqual({ current: 8, target: 9 });
    expect(addA.effects[0].after).toBeCloseTo((settings.cycleMin * 60) / 9, 5);
    expect(byRoute.get("B")!.some((d) => d.kind === "add_bus")).toBe(false);
    expect([...reserveShort]).toEqual(["B"]);
  });
  it("abstains on stale telemetry and on routes without geometry", () => {
    const stale = even("A").map((v) => ({
      ...v,
      updatedAt: "2026-09-25T07:20:00Z",
      currentDelaySec: -300,
      predictedDelaySec: -300,
    }));
    const noRoad = even("B", { 1: { currentDelaySec: -300, predictedDelaySec: -300 } });
    const { analyses, decisions } = decide(
      [route("A"), route("B")],
      [...stale, ...noRoad],
      4,
      [geometry("A")],
    );
    expect(analyses.get("A")!.status).toBe("insufficient");
    expect(analyses.get("B")!.status).toBe("no_geometry");
    expect(decisions).toEqual([]);
  });
  it("puts urgent, severe actions first and leaves healthy routes alone", () => {
    const { decisions, byRoute } = decide(
      [route("A"), route("B"), route("C")],
      [
        ...even("A", { 6: { currentDelaySec: 400, predictedDelaySec: 520 } }),
        ...even("B", { 6: { currentDelaySec: -80, predictedDelaySec: -70 } }),
        ...even("C"),
      ],
      0,
    );
    expect(decisions.map((d) => d.vehicleId)).toEqual(["A-6", "B-6"]);
    expect(decisions[0].priority).toBeGreaterThan(decisions[1].priority);
    expect(byRoute.get("C")).toEqual([]);
  });
});

describe("route recommendations built from decisions", () => {
  const routes = [route("A"), route("B")];
  const vehicles = [
    ...even("A", { 2: { currentDelaySec: 200, predictedDelaySec: 300 } }),
    ...even("B"),
  ];
  const geometries = routes.map((r) => geometry(r.id));
  it("targets one bus with a concrete stop, deadline and dwell scope, without a causal ML claim", () => {
    const input = { routes, vehicles, plans: [], asOf, demo: true, geometries };
    const before = structuredClone(input);
    const [a, b] = recommendDispatch(input);
    expect(input).toEqual(before);
    expect(a).toMatchObject({
      routeId: "A",
      source: "rules-v2",
      status: "suggested",
      vehicleId: "A-2",
      decisionKind: "shorten_late",
      currentDwellSec: 30,
      targetDwellSec: 20,
      dwellStops: 11,
      predictedDelayAfterActionSec: null,
      affectedVehicles: 1,
    });
    expect(a.deadlineAt).toBeTruthy();
    expect(a.reasons[0]).toContain("Сократить стоянки ТС A-2");
    expect(b).toMatchObject({ routeId: "B", status: "keep", decisions: [] });
  });
  it("does not suggest on top of an applied plan and abstains outside the demo contour", () => {
    const plan = {
      id: "p",
      routeId: "A",
      routeNumber: "A",
      baseFleet: 8,
      targetFleet: 8,
      cycleMin: 120,
      stopId: "A-s5",
      stopName: "Остановка 5",
      baseDwellSec: 30,
      targetDwellSec: 20,
      createdAt: asOf,
      status: "active" as const,
      vehicleId: "A-2",
    };
    const [active] = recommendDispatch({
      routes,
      vehicles,
      plans: [plan],
      asOf,
      demo: true,
      geometries,
    }).filter((r) => r.routeId === "A");
    expect(active).toMatchObject({ status: "active", vehicleId: "A-2" });
    expect(active.decisions).toEqual([]);
    const archive = recommendDispatch({
      routes,
      vehicles,
      plans: [],
      asOf,
      demo: false,
      geometries,
    });
    expect(archive.every((r) => r.status === "unavailable")).toBe(true);
  });
});
