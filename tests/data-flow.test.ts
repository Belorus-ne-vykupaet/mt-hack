import catalog from "../src/data/moscow-buses.json";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scenarioSnapshot, simulation } from "../src/mocks/scenario";
import { mapRoute, mapVehicle } from "../src/entities/adapters";
import {
  patchItems,
  applyEvents,
  StreamBridge,
} from "../src/app/realtime/bridge";
import { keys, queryClient } from "../src/entities/queries";
import { backoff } from "../src/app/realtime/client";
import { MockRealtimeClient } from "../src/mocks/realtime";
import type { StreamEvent } from "../src/app/realtime/client";
import type { Vehicle, Route } from "../src/entities/models";
import { useUi } from "../src/app/store";
const event = (
  type: string,
  payload: Record<string, unknown>,
  sequence = 1,
): StreamEvent => ({
  type,
  payload,
  sequence,
  version: 1,
  timestamp: "2026-09-21T15:24:00Z",
});
beforeEach(() => {
  queryClient.clear();
  simulation.seconds = 0;
  simulation.paused = false;
  simulation.offline = false;
  simulation.speed = 1;
  simulation.scenario = "route-primary-delay";
});
afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});
describe("deterministic operational fixtures", () => {
  it("matches the administered catalog with consistent aggregate counts", () => {
    const s = scenarioSnapshot(30);
    expect(s.routes).toHaveLength(catalog.routes.length);
    expect(s.vehicles).toHaveLength(
      catalog.routes.reduce((n, r) => n + r.vehicleCount, 0),
    );
    expect(s.summary.vehicles_active).toBe(s.vehicles.length);
    expect(s.routes.reduce((n, r) => n + r.vehicle_count, 0)).toBe(
      catalog.routes.reduce((n, r) => n + r.vehicleCount, 0),
    );
    expect(
      s.summary.on_time_percent +
        s.summary.at_risk_percent +
        s.summary.delayed_percent,
    ).toBeCloseTo(100);
  });
  it("route м3 moves through the documented stages", () => {
    expect(scenarioSnapshot(0).routes[0].risk_probability).toBe(0.38);
    expect(scenarioSnapshot(10).routes[0].predicted_delay_sec).toBe(288);
    expect(
      scenarioSnapshot(20).alerts.find((a) => a.route_id === "м3")?.severity,
    ).toBe("high");
    const end = scenarioSnapshot(30);
    expect(end.routes[0].predicted_delay_sec).toBe(504);
    expect(end.alerts[0].severity).toBe("critical");
    expect(end.vehicles[0].risk_probability).toBe(
      end.routes[0].risk_probability,
    );
  });
  it("normal mode has no alerts and the recovery scenario reduces route risk", () => {
    expect(scenarioSnapshot(30, "normal").alerts).toEqual([]);
    expect(scenarioSnapshot(30, "recovery").routes[0].risk_level).toBe(
      "normal",
    );
  });
  it("adapters preserve seconds and lon/lat without introducing prediction logic", () => {
    const s = scenarioSnapshot(30);
    expect(mapRoute(s.routes[0]).predictedDelaySec).toBe(504);
    const v = mapVehicle(s.vehicles[0]);
    expect(v.position).toEqual(s.vehicles[0].position);
    expect(v.nextStop).toEqual(s.vehicles[0].next_stop);
    expect(v).not.toHaveProperty("risk_probability");
  });
});
describe("query cache realtime bridge", () => {
  it("merges partial packets without erasing identity and removes a vehicle", () => {
    const v = mapVehicle(scenarioSnapshot(30).vehicles[0]);
    queryClient.setQueryData(keys.vehicles, [v]);
    applyEvents([
      event("vehicle.updated", {
        id: v.id,
        speed_kmh: 12,
        position: { lat: 55.7, lon: 37.6 },
      }),
    ]);
    const patched = queryClient.getQueryData<Vehicle[]>(keys.vehicles)![0];
    expect(patched.speedKmh).toBe(12);
    expect(patched.nextStop).toEqual(v.nextStop);
    expect(patched.routeId).toBe(v.routeId);
    applyEvents([event("vehicle.removed", { id: v.id })]);
    expect(queryClient.getQueryData(keys.vehicles)).toEqual([]);
  });
  it("ignores unknown events and incomplete new entities", () => {
    queryClient.setQueryData(keys.routes, []);
    applyEvents([
      event("unrecognised.event", {}),
      event("route.updated", { id: "new", current_delay_sec: 1 }),
    ]);
    expect(queryClient.getQueryData(keys.routes)).toEqual([]);
  });
  it("applies alert creation and resolution to the same cache", () => {
    const a = scenarioSnapshot(30).alerts[0];
    applyEvents([event("alert.created", a)]);
    expect(queryClient.getQueryData<unknown[]>(keys.alerts)).toHaveLength(1);
    applyEvents([event("alert.resolved", { id: a.id })]);
    expect(queryClient.getQueryData(keys.alerts)).toEqual([]);
  });
  it("batch patches are last-write-wins", () => {
    const r = mapRoute(scenarioSnapshot(30).routes[0]);
    queryClient.setQueryData(keys.routes, [r]);
    applyEvents([
      event("route.updated", { id: r.id, current_delay_sec: 200 }),
      event("route.updated", { id: r.id, current_delay_sec: 220 }),
    ]);
    expect(
      queryClient.getQueryData<Route[]>(keys.routes)![0].currentDelaySec,
    ).toBe(220);
    expect(patchItems([{ id: "x", value: 1 }], { id: "x", value: 2 })).toEqual([
      { id: "x", value: 2 },
    ]);
  });
  it("sequence gaps and new stream greetings request a REST resync", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const b = new StreamBridge(reload);
    b.consume(event("system.heartbeat", {}, 10));
    b.consume(event("system.heartbeat", {}, 12));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    b.consume(event("system.hello", {}, 1));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    b.close();
  });
  it("ignores duplicate sequences and unsupported versions resync", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const b = new StreamBridge(reload);
    b.consume(event("system.heartbeat", {}, 5));
    b.consume(event("system.heartbeat", {}, 5));
    expect(reload).not.toHaveBeenCalled();
    b.consume({ ...event("vehicle.updated", {}, 6), version: 2 });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    b.close();
  });
  it("caps reconnect backoff at 15 seconds", () =>
    expect([0, 1, 2, 3, 4, 5].map((n) => backoff(n))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000,
    ]));
});
describe("demo playback and selection", () => {
  it("supports pause, resume, reset and disconnect", () => {
    vi.useFakeTimers();
    const c = new MockRealtimeClient();
    const events: StreamEvent[] = [];
    c.subscribe((e) => events.push(e));
    c.connect();
    vi.advanceTimersByTime(10000);
    expect(simulation.seconds).toBe(10);
    simulation.paused = true;
    vi.advanceTimersByTime(5000);
    expect(simulation.seconds).toBe(10);
    simulation.paused = false;
    simulation.speed = 2;
    vi.advanceTimersByTime(5000);
    expect(simulation.seconds).toBe(20);
    expect(
      events.some(
        (e) => e.type === "alert.updated" && e.payload.severity === "high",
      ),
    ).toBe(true);
    simulation.seconds = 0;
    vi.advanceTimersByTime(1000);
    expect(simulation.seconds).toBe(2);
    c.disconnect();
    const count = events.length;
    vi.advanceTimersByTime(5000);
    expect(events).toHaveLength(count);
  });
  it("selecting route, vehicle and stop maintains a single selection model", () => {
    useUi.getState().selectRoute("м3");
    expect(useUi.getState().rightPanel).toBe("route");
    useUi.getState().selectVehicle("vehicle-742", "м3");
    expect(useUi.getState().selectedVehicleId).toBe("vehicle-742");
    useUi.getState().selectStop("stop-37-2", "м3");
    expect(useUi.getState().selectedVehicleId).toBeNull();
    expect(useUi.getState().selectedStopId).toBe("stop-37-2");
    useUi.getState().clear();
  });
});

it("updates exact official target metadata and removes completed plans from the stream", () => {
  const snapshot = scenarioSnapshot(0);
  const vehicle = mapVehicle(snapshot.vehicles[0]);
  queryClient.setQueryData(keys.vehicles, [vehicle]);
  queryClient.setQueryData(keys.routes, snapshot.routes.map(mapRoute));
  applyEvents([
    event("vehicle.updated", {
      id: vehicle.id,
      forecast_horizon_sec: 721,
      forecast_target_time: "2026-01-06T18:02:00Z",
      forecast_model: "catboost-official-v1",
    }),
    event("route.removed", { id: snapshot.routes[0].id }),
  ]);
  expect(queryClient.getQueryData<Vehicle[]>(keys.vehicles)?.[0]).toMatchObject(
    {
      forecastHorizonSec: 721,
      forecastTargetTime: "2026-01-06T18:02:00Z",
      forecastModel: "catboost-official-v1",
    },
  );
  expect(
    queryClient
      .getQueryData<Route[]>(keys.routes)
      ?.some((r) => r.id === snapshot.routes[0].id),
  ).toBe(false);
});
