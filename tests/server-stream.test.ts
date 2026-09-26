import { expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { EventEmitter, once } from "node:events";
import { MAX_STREAM_BUFFER_BYTES, routeStreamVersion, sendStreamBatch, sendStreamEvent, vehicleStreamVersion } from "../server/stream";

it("streams new telemetry and risk without resending countdown-only changes", () => {
  const initial = {
    id: "vehicle-1", updated_at: "2026-09-26T17:00:00Z",
    position: { lat: 55.75, lon: 37.62 }, speed_kmh: 12,
    status: "active", current_delay_sec: 20, risk_level: "normal",
    forecast_status: "ready", forecast_target_time: "2026-09-26T17:12:00Z",
    predicted_delay_sec: 41, risk_probability: 0.12,
  };
  const version = vehicleStreamVersion(initial);
  expect(vehicleStreamVersion({ ...initial, forecast_horizon_sec: 710, telemetry_age_sec: 1 })).toBe(version);
  expect(vehicleStreamVersion({ ...initial, updated_at: "2026-09-26T17:00:05Z" })).not.toBe(version);
  expect(vehicleStreamVersion({ ...initial, risk_level: "high" })).not.toBe(version);
  expect(vehicleStreamVersion({ ...initial, current_delay_sec: 130 })).not.toBe(version);
  expect(vehicleStreamVersion({ ...initial, doors_open: true })).not.toBe(version);
});

it("streams material route risk changes without broadcasting tiny forecast drift", () => {
  const route = {
    id: "duty-1", vehicle_count: 1, current_delay_sec: 31,
    predicted_delay_sec: 71, risk_probability: 0.31,
    risk_level: "elevated", forecast_status: "ready",
  };
  const version = routeStreamVersion(route);
  expect(routeStreamVersion({ ...route, predicted_delay_sec: 72, risk_probability: 0.32 })).toBe(version);
  expect(routeStreamVersion({ ...route, risk_level: "high" })).not.toBe(version);
  expect(routeStreamVersion({ ...route, predicted_delay_sec: 85 })).not.toBe(version);
});

it("terminates a slow client before serializing another event", () => {
  const send = vi.fn();
  const terminate = vi.fn();
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: MAX_STREAM_BUFFER_BYTES + 1,
    send,
    terminate,
  } as unknown as WebSocket;
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(sendStreamEvent(socket, 7, "route.updated", circular)).toBe(7);
  expect(terminate).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

it("delivers a fleet snapshot larger than the queue limit with consecutive sequences", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const connected = once(server, "connection");
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: { sequence: number; type: string }[] = [];
  const received = new Promise<void>(resolve => client.on("message", data => {
    frames.push(JSON.parse(data.toString()));
    if (frames.length === 3) resolve();
  }));
  try {
    const [socket] = await connected as [WebSocket];
    const terminate = vi.spyOn(socket, "terminate");
    const last = await sendStreamBatch(socket, 8, [
      ["forecast.updated", { payload: "x".repeat(MAX_STREAM_BUFFER_BYTES * 2) }],
      ["vehicle.updated", { id: "vehicle-1" }], ["system.heartbeat", {}],
    ]);
    await received;
    expect(last).toBe(11);
    expect(frames.map(frame => frame.sequence)).toEqual([9, 10, 11]);
    expect(terminate).not.toHaveBeenCalled();
  } finally {
    client.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("bounds a stalled batch and releases its close listener", async () => {
  const socket = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN, bufferedAmount: 0,
    send: vi.fn(), terminate: vi.fn(),
  });
  expect(await sendStreamBatch(socket as unknown as WebSocket, 4, [["route.updated", {}]], 20)).toBe(4);
  expect(socket.send).toHaveBeenCalledOnce();
  expect(socket.terminate).toHaveBeenCalledOnce();
  expect(socket.listenerCount("close")).toBe(0);
});

it("keeps per-client sequence consecutive for accepted messages", () => {
  const send = vi.fn();
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send,
    terminate: vi.fn(),
  } as unknown as WebSocket;
  const next = sendStreamEvent(socket, 4, "system.heartbeat", { stale: true });
  expect(next).toBe(5);
  expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
    type: "system.heartbeat", sequence: 5, payload: { stale: true },
  });
});
