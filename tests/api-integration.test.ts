import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createApi } from "../server/app";
import type { ServerOptions } from "../server/app";
import { csvSnapshot, csvGeometries } from "../src/mocks/csv-scenario";
import type { OfficialSource } from "../server/official";
import { ModelProvider, validatePredictions } from "../server/model";
import { Providers, parseTraffic } from "../server/providers";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function start(options: ServerOptions = {}) {
  const api = createApi({ frozen: true, ...options });
  await new Promise<void>((r) => api.server.listen(0, "127.0.0.1", r));
  cleanups.push(() => api.close());
  const address = api.server.address() as { port: number };
  return { ...api, url: `http://127.0.0.1:${address.port}/api/v1` };
}
const base = csvSnapshot(900).routes[0];
const plan = {
  id: "unused",
  routeId: base.id,
  routeNumber: base.number,
  baseFleet: 8,
  targetFleet: 10,
  cycleMin: 120,
  stopId: base.stops[0].id,
  stopName: base.stops[0].name,
  baseDwellSec: 30,
  targetDwellSec: 20,
  createdAt: "",
  status: "draft",
};
const post = (url: string, body: unknown, key = "key-one", headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...headers,
    },
    body: JSON.stringify(body),
  });
describe("real HTTP integration API", () => {
  it("forwards filtered forecast evaluation without substituting synthetic observations", async () => {
    const read = vi.fn().mockResolvedValue({ summary: { total: 1, observed: 0, maeSec: null }, items: [] });
    const official = { read, snapshot: vi.fn() } as unknown as OfficialSource;
    const api = await start({ official });
    const response = await fetch(api.url + "/analytics/forecast-evaluation?route_id=duty-1&route_id=duty-2");
    expect(response.status).toBe(200);
    expect((await response.json()).summary.maeSec).toBeNull();
    expect(read).toHaveBeenCalledWith("/analytics/forecast-evaluation?route_id=duty-1&route_id=duty-2");
    expect(official.snapshot).not.toHaveBeenCalled();
    const demo = await start();
    expect((await fetch(demo.url + "/analytics/forecast-evaluation")).status).toBe(404);
  });
  it("allows local Docker dashboard reads but keeps dispatch writes authenticated", async () => {
    const api = await start({
      token: "local-demo-key-1234567890123456",
      publicRead: true,
    });
    expect((await fetch(api.url + "/health")).status).toBe(200);
    expect((await fetch(api.url + "/vehicles")).status).toBe(200);
    expect(
      (await post(api.url + "/dispatch/commands", { plan, mode: "save", revision: 0 })).status,
    ).toBe(401);
  });
  it("serves network and recommendations; applies, deduplicates, rejects conflicts and cancels commands", async () => {
    const api = await start();
    const input = { plan, mode: "apply", revision: 0 };
    expect(
      (await (await fetch(api.url + "/routes")).json()).items,
    ).toHaveLength(15);
    const rec = await (
      await fetch(api.url + "/dispatch/recommendations")
    ).json();
    expect(rec.items).toHaveLength(15);
    expect(rec.revision).toBe(0);
    const response = await post(api.url + "/dispatch/commands", input);
    expect(response.status).toBe(201);
    const state = await response.json();
    expect(state.reserve).toBe(2);
    expect(state.commands[0].status).toBe("applied_demo");
    expect(state.commands[0].history.map((h: any) => h.status)).toEqual([
      "accepted",
      "applied_demo",
    ]);
    expect(
      (await (await fetch(api.url + "/network/summary")).json())
        .vehicles_active,
    ).toBe(122);
    expect(
      await (await post(api.url + "/dispatch/commands", input)).json(),
    ).toEqual(state);
    expect(
      (
        await post(api.url + "/dispatch/commands", {
          ...input,
          plan: { ...plan, targetFleet: 9 },
        })
      ).status,
    ).toBe(409);
    expect(
      (await post(api.url + "/dispatch/commands", input, "new-key")).status,
    ).toBe(409);
    expect(
      (
        await post(
          api.url + "/dispatch/commands",
          { ...input, revision: 1, plan: { ...plan, targetDwellSec: 5 } },
          "bad-dwell",
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await post(
          api.url + "/dispatch/commands",
          { ...input, revision: 1, plan: { ...plan, targetFleet: 13 } },
          "no-reserve",
        )
      ).status,
    ).toBe(409);
    const cancel = await post(
      api.url + `/dispatch/commands/${state.commands[0].id}/cancel`,
      { revision: 1 },
    );
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).reserve).toBe(4);
    expect(
      (await (await fetch(api.url + "/network/summary")).json())
        .vehicles_active,
    ).toBe(120);
  });
  it("serializes concurrent mutations and retains journal/idempotency after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "transit-api-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const journal = join(dir, "commands.json");
    const a = await start({ journal });
    const input = { plan, mode: "apply", revision: 0 };
    const results = await Promise.all([
      post(a.url + "/dispatch/commands", input, "a"),
      post(a.url + "/dispatch/commands", input, "b"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const successfulKey = results[0].status === 201 ? "a" : "b";
    await a.close();
    const b = await start({ journal });
    const replay = await (
      await post(b.url + "/dispatch/commands", input, successfulKey)
    ).json();
    expect(replay.commands).toHaveLength(1);
    expect(replay.revision).toBe(1);
  });
  it("saves official stop instructions against the live fleet, not the empty startup catalog", async () => {
    const snapshot = { ...csvSnapshot(900), geometries: csvGeometries };
    snapshot.routes[0].vehicle_count = 1;
    const official = {
      routes: snapshot.routes.map((route) => ({ ...route, vehicle_count: 0 })),
      stale: false,
      snapshot: async () => structuredClone(snapshot),
    } as unknown as OfficialSource;
    const api = await start({ official });
    const input = {
      plan: { ...plan, baseFleet: 1, targetFleet: 1, vehicleId: snapshot.vehicles[0].id,
        decisionKind: "shorten_late", dwellStops: 16 },
      mode: "plan", revision: 0,
    };
    const response = await post(api.url + "/dispatch/commands", input);
    expect(response.status).toBe(201);
    const state = await response.json();
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]).toMatchObject({ status: "draft", plan: {
      baseFleet: 1, targetFleet: 1, targetDwellSec: 20, dwellStops: 16,
      vehicleId: snapshot.vehicles[0].id, decisionKind: "shorten_late",
    } });
    expect(official.routes[0].vehicle_count).toBe(0);
    // A retry remains idempotent even if telemetry changes after acceptance.
    snapshot.routes[0].vehicle_count = 2;
    expect(await (await post(api.url + "/dispatch/commands", input)).json()).toEqual(state);
    const stale = await post(api.url + "/dispatch/commands",
      { ...input, revision: 1 }, "stale-fleet");
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.message).toContain("Исходный выпуск");
    const updated = await post(api.url + "/dispatch/commands",
      { ...input, revision: 1, plan: { ...input.plan, baseFleet: 2, targetFleet: 2 } }, "updated-fleet");
    expect(updated.status).toBe(201);
    expect((await updated.json()).commands[0].plan.baseFleet).toBe(2);
    expect((await post(api.url + "/dispatch/commands",
      { ...input, revision: 2, mode: "apply" }, "apply-official")).status).toBe(409);
  });
  it("requires authentication when configured, supports an HttpOnly session and blocks other origins", async () => {
    const api = await start({
      token: "test-token-1234567890123456",
      trafficKey: "PRIVATE_PROVIDER_KEY",
    });
    expect((await fetch(api.url + "/integrations")).status).toBe(401);
    expect(
      (
        await fetch(api.url + "/integrations", {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
    const login = await post(api.url + "/session", {
      token: "test-token-1234567890123456",
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const result = await (
      await fetch(api.url + "/integrations", { headers: { Cookie: cookie } })
    ).text();
    expect(result).toContain("configured");
    expect(result).not.toContain("PRIVATE_PROVIDER_KEY");
    expect(result).not.toContain("test-token");
  });
  it("streams real WebSocket events with consecutive client sequences", async () => {
    const api = await start();
    const ws = new WebSocket(api.url.replace("http:", "ws:") + "/stream");
    const received: any[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No websocket data")),
        5000,
      );
      ws.on("message", (data) => {
        received.push(JSON.parse(data.toString()));
        if (received.length >= 5) {
          clearTimeout(timeout);
          resolve();
        }
      });
      ws.on("error", reject);
    });
    expect(received[0].type).toBe("system.hello");
    expect(received.slice(0, 5).map((e) => e.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    ws.close();
  });
  it("delivers an official GPS change on the next stream tick", async () => {
    const state = { ...csvSnapshot(900), geometries: csvGeometries };
    const official = {
      routes: state.routes,
      stale: false,
      snapshot: async () => state,
    } as unknown as OfficialSource;
    const api = await start({ official });
    const ws = new WebSocket(api.url.replace("http:", "ws:") + "/stream");
    cleanups.push(async () => { ws.close(); });
    const vehicleId = state.vehicles[0].id;
    const waitForVehicle = (updatedAt: string, timeoutMs: number) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", onMessage);
        reject(new Error(`No timely GPS update for ${vehicleId}`));
      }, timeoutMs);
      const onMessage = (raw: Buffer) => {
        const event = JSON.parse(raw.toString());
        if (event.type !== "vehicle.updated" || event.payload.id !== vehicleId ||
            event.payload.updated_at !== updatedAt) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve();
      };
      ws.on("message", onMessage);
    });
    const original = state.vehicles[0].updated_at;
    await waitForVehicle(original, 3500);
    const changed = new Date().toISOString();
    const next = waitForVehicle(changed, 2600);
    state.vehicles[0].updated_at = changed;
    const started = performance.now();
    await next;
    expect(performance.now() - started).toBeLessThan(2600);
  }, 8000);
  it("builds rules-v2 recommendations on the official road geometry", async () => {
    const snapshot = { ...csvSnapshot(900), geometries: csvGeometries };
    const official = {
      routes: snapshot.routes,
      stale: false,
      snapshot: async () => snapshot,
    } as unknown as OfficialSource;
    const rec = await (
      await fetch((await start({ official })).url + "/dispatch/recommendations")
    ).json();
    expect(rec.method).toBe("rules-v2");
    expect(rec.items.some((i: any) => i.vehicleId && i.decisionKind)).toBe(true);
    snapshot.geometries = [];
    const bare = await (
      await fetch((await start({ official })).url + "/dispatch/recommendations")
    ).json();
    expect(bare.items.some((i: any) => i.vehicleId)).toBe(false);
  });
  it("marks cached official WebSocket updates stale and clears the flag after recovery", async () => {
    const snapshot = { ...csvSnapshot(900), geometries: csvGeometries };
    const official = {
      routes: snapshot.routes,
      stale: true,
      snapshot: async () => snapshot,
    } as unknown as OfficialSource;
    const api = await start({ official });
    const ws = new WebSocket(api.url.replace("http:", "ws:") + "/stream");
    cleanups.push(async () => { ws.close(); });
    async function heartbeat(stale: boolean) {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => {
          clearTimeout(timer);
          ws.off("message", onMessage);
          ws.off("error", onError);
        };
        const onMessage = (raw: Buffer) => {
          const event = JSON.parse(raw.toString());
          if (event.type !== "system.heartbeat" || event.payload.stale !== stale) return;
          cleanup();
          resolve();
        };
        const timer = setTimeout(() => onError(new Error("No expected heartbeat")), 4500);
        ws.on("message", onMessage);
        ws.on("error", onError);
      });
    }
    await heartbeat(true);
    official.stale = false;
    await heartbeat(false);
  });
  it("sends full route identity once, then bounded patches without duplicate forecast arrays", async () => {
    const state = { ...csvSnapshot(900), geometries: csvGeometries };
    const official = {
      routes: state.routes,
      stale: false,
      snapshot: async () => state,
    } as unknown as OfficialSource;
    const api = await start({ official });
    const ws = new WebSocket(api.url.replace("http:", "ws:") + "/stream");
    cleanups.push(async () => { ws.close(); });
    const received: any[] = [];
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    const heartbeatIndexes = () => received
      .map((event, index) => event.type === "system.heartbeat" ? index : -1)
      .filter((index) => index >= 0);
    await vi.waitFor(() => expect(heartbeatIndexes().length).toBeGreaterThanOrEqual(2), {
      timeout: 4500,
    });
    const [firstTick, secondTick] = heartbeatIndexes();
    const initialRoute = received.slice(firstTick, secondTick).find((event) =>
      event.type === "route.updated" && event.payload.id === state.routes[0].id);
    expect(initialRoute.payload.stops.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received.slice(secondTick).some((event) => event.type === "route.updated")).toBe(false);
    state.routes[0].vehicle_count += 1;
    await vi.waitFor(() => {
      expect(received.slice(secondTick).some((event) =>
        event.type === "route.updated" && event.payload.id === state.routes[0].id)).toBe(true);
    }, { timeout: 8000 });
    const laterRoute = received.slice(secondTick).find((event) =>
      event.type === "route.updated" && event.payload.id === state.routes[0].id);
    expect(laterRoute.payload.stops).toBeUndefined();
    expect(JSON.stringify(laterRoute).length).toBeLessThan(JSON.stringify(initialRoute).length / 3);
    expect(received.find((event) => event.type === "forecast.updated").payload).toEqual({ segments: expect.any(Array) });
  }, 12000);
  it("does not fabricate traffic when no key exists", async () => {
    const api = await start();
    const r = await fetch(
      api.url + "/external/traffic?route_id=" + encodeURIComponent(base.id),
    );
    expect(r.status).toBe(503);
    expect((await r.json()).error.message).toContain("серверный ключ");
  });
});
it("caches and coalesces external weather, with timestamps and no model leakage", async () => {
  let calls = 0;
  const providers = new Providers("", true, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        current: {
          temperature_2m: 12,
          precipitation: 0.4,
          time: "2026-09-24T08:00",
        },
      }),
    );
  });
  const [a, b] = await Promise.all([providers.weather(), providers.weather()]);
  expect(calls).toBe(1);
  expect(a).toEqual(b);
  expect(a.usedInModel).toBe(false);
  expect((await providers.weather()).cached).toBe(true);
  const bad = new Providers("", true, async () => new Response("{}"));
  await expect(bad.weather()).rejects.toThrow("недоступен");
});
it("rejects bad routing durations and compares geometry before producing a ratio", async () => {
  expect(() =>
    parseTraffic({ route: { legs: [{ status: "FAIL" }] } }),
  ).toThrow();
  let calls = 0;
  const provider = new Providers("private", true, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        route: {
          legs: [
            {
              status: "OK",
              steps: [{ duration: 50, polyline: { points: [calls] } }],
            },
          ],
        },
      }),
    );
  });
  const result = await provider.traffic(base);
  expect(result.comparable).toBe(false);
  expect(result.ratio).toBeNull();
  expect(result.usedInModel).toBe(false);
});
it("validates ML coverage and time, and falls back explicitly if the provider fails", async () => {
  const vehicles = csvSnapshot(900).vehicles,
    asOf = vehicles[0].updated_at;
  const data = {
    asOf,
    modelVersion: "test-v1",
    predictions: vehicles.map((v) => ({ vehicleId: v.id, delaySec: 123 })),
  };
  expect(validatePredictions(data, vehicles, asOf).size).toBe(120);
  expect(() =>
    validatePredictions({ ...data, asOf: "wrong" }, vehicles, asOf),
  ).toThrow();
  expect(() =>
    validatePredictions(
      { ...data, predictions: data.predictions.slice(1) },
      vehicles,
      asOf,
    ),
  ).toThrow();
  const connected = new ModelProvider(
    "https://example.test/predict",
    "",
    async () => new Response(JSON.stringify(data)),
  );
  expect((await connected.predict(vehicles, asOf))!.size).toBe(120);
  expect(connected.status).toBe("connected");
  const failed = new ModelProvider(
    "https://example.test/predict",
    "",
    async () => {
      throw new Error("private-provider-error");
    },
  );
  expect(await failed.predict(vehicles, asOf)).toBeNull();
  expect(failed.status).toBe("fallback");
});

it("propagates a connected model through vehicles, network aggregates, alerts and forecast series", async () => {
  const api = await start({
    modelUrl: "https://example.test/predict",
    fetcher: async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          asOf: request.asOf,
          modelVersion: "test-model",
          predictions: request.vehicles.map((v: any) => ({
            vehicleId: v.id,
            delaySec: 900,
          })),
        }),
      );
    },
  });
  const vehicles = await (await fetch(api.url + "/vehicles")).json();
  expect(vehicles.items.every((v: any) => v.predicted_delay_sec === 900)).toBe(
    true,
  );
  const summary = await (await fetch(api.url + "/network/summary")).json();
  expect(summary.average_predicted_delay_sec).toBe(900);
  expect(summary.on_time_percent).toBe(0);
  const alerts = await (await fetch(api.url + "/alerts")).json();
  expect(alerts.items).toHaveLength(15);
  expect(alerts.items[0].title).toContain("модели");
  const series = await (
    await fetch(api.url + "/analytics/delay-series")
  ).json();
  expect(series.points.at(-1).predicted_delay_sec).toBe(900);
  const status = await (await fetch(api.url + "/integrations")).json();
  expect(status.model.status).toBe("connected");
});
