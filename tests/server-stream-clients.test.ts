import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createApi } from "../server/app";
import type { OfficialSource } from "../server/official";
import * as stream from "../server/stream";
import { csvSnapshot, csvGeometries } from "../src/mocks/csv-scenario";

type Frame = { type: string; sequence: number; payload: any };

async function fixture() {
  const data = csvSnapshot(900);
  let state = { ...data, routes: data.routes.slice(0, 2), vehicles: data.vehicles.slice(0, 2), geometries: csvGeometries };
  const api = createApi({ official: {
    routes: state.routes, stale: false, snapshot: async () => state,
  } as unknown as OfficialSource });
  await new Promise<void>(resolve => api.server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(api.server.address() as { port: number }).port}/api/v1/stream`;
  const clients: WebSocket[] = [];
  return {
    get state() { return state; },
    set state(next: typeof state) { state = next; },
    connect() {
      const ws = new WebSocket(url);
      const frames: Frame[] = [];
      ws.on("message", raw => frames.push(JSON.parse(raw.toString())));
      clients.push(ws);
      return frames;
    },
    async close() {
      clients.forEach(ws => ws.terminate());
      await api.close();
    },
  };
}

const waitForBatch = (frames: Frame[]) => vi.waitFor(() =>
  expect(frames.some(frame => frame.type === "analytics.snapshot")).toBe(true), { timeout: 2500 });

it("sends a complete snapshot to a late-joining client even when nothing changed", async () => {
  const api = await fixture();
  try {
    await waitForBatch(api.connect());
    const late = api.connect();
    await waitForBatch(late);
    expect(late.filter(frame => frame.type === "route.updated").map(frame => frame.payload))
      .toEqual(api.state.routes);
    expect(late.filter(frame => frame.type === "vehicle.updated").map(frame => frame.payload))
      .toEqual(api.state.vehicles);
    expect(late.find(frame => frame.type === "forecast.updated")?.payload.segments).toEqual(api.state.segments);
  } finally { await api.close(); }
});

it("keeps fast clients live and catches a delayed client up including removals", async () => {
  const original = stream.sendStreamBatch;
  let slowSocket: WebSocket | undefined;
  let hold = false, held = false, inFlight = 0, maxInFlight = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(stream, "sendStreamBatch").mockImplementation(async (ws, ...args) => {
    slowSocket ??= ws;
    if (ws !== slowSocket) return original(ws, ...args);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (hold) { held = true; await gate; }
      return await original(ws, ...args);
    } finally { inFlight--; }
  });
  const api = await fixture();
  try {
    const slow = api.connect();
    await waitForBatch(slow);
    hold = true;
    await vi.waitFor(() => expect(held).toBe(true), { timeout: 2500 });
    const fast = api.connect();
    await waitForBatch(fast);
    const removedRoute = api.state.routes[1].id, removedVehicle = api.state.vehicles[1].id;
    const changedAt = "2026-09-27T12:00:00Z";
    api.state = {
      ...api.state,
      routes: [{ ...api.state.routes[0], vehicle_count: 9 }],
      vehicles: [{ ...api.state.vehicles[0], updated_at: changedAt }],
      segments: [],
    };
    const expectLatest = (frames: Frame[]) => {
      expect(frames.some(frame => frame.type === "vehicle.updated" && frame.payload.updated_at === changedAt)).toBe(true);
      expect(frames.some(frame => frame.type === "route.updated" && frame.payload.vehicle_count === 9)).toBe(true);
      expect(frames.some(frame => frame.type === "route.removed" && frame.payload.id === removedRoute)).toBe(true);
      expect(frames.some(frame => frame.type === "vehicle.removed" && frame.payload.id === removedVehicle)).toBe(true);
      expect(frames.some(frame => frame.type === "forecast.updated" && frame.payload.segments.length === 0)).toBe(true);
    };
    await vi.waitFor(() => expectLatest(fast), { timeout: 2500 });
    hold = false;
    release();
    await vi.waitFor(() => expectLatest(slow), { timeout: 2500 });
    expect(maxInFlight).toBe(1);
    for (const frames of [slow, fast])
      expect(frames.map(frame => frame.sequence)).toEqual(frames.map((_, index) => index + 1));
  } finally {
    hold = false;
    release();
    await api.close();
    spy.mockRestore();
  }
}, 12000);
