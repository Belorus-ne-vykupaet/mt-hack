import { WebSocket } from "ws";

export const MAX_STREAM_BUFFER_BYTES = 1_000_000;

// The server recalculates countdowns even without a new GPS packet. A changing
// countdown alone should not resend every vehicle to every client each second.
// GPS, observed delay, target and risk changes still reach the next WS tick.
export function vehicleStreamVersion(vehicle: {
  id: string;
  updated_at: string;
  position?: unknown;
  speed_kmh?: unknown;
  doors_open?: boolean | null;
  bearing_deg?: unknown;
  status?: unknown;
  current_delay_sec?: unknown;
  risk_level?: unknown;
  forecast_status?: unknown;
  forecast_target_time?: unknown;
  current_segment_id?: unknown;
  next_stop?: unknown;
  predicted_delay_sec?: number | null;
  risk_probability?: number | null;
  observed_factor?: string | null;
  suspected_cause?: string | null;
  forecast_horizon_sec?: number | null;
  telemetry_age_sec?: number | null;
}): string {
  return JSON.stringify([
    vehicle.id, vehicle.updated_at, vehicle.position, vehicle.speed_kmh, vehicle.doors_open,
    vehicle.bearing_deg, vehicle.status, vehicle.current_delay_sec,
    vehicle.risk_level, vehicle.forecast_status, vehicle.forecast_target_time,
    vehicle.current_segment_id, vehicle.next_stop,
    vehicle.predicted_delay_sec == null ? null : Math.round(vehicle.predicted_delay_sec / 10),
    vehicle.risk_probability == null ? null : Math.round(vehicle.risk_probability * 20),
    vehicle.observed_factor, vehicle.suspected_cause,
  ]);
}

export function routeStreamVersion(route: {
  id: string;
  vehicle_count: number;
  current_delay_sec?: number | null;
  predicted_delay_sec?: number | null;
  risk_probability?: number | null;
  risk_level?: unknown;
  forecast_status?: unknown;
}): string {
  return JSON.stringify([
    route.id, route.vehicle_count, route.risk_level, route.forecast_status,
    route.current_delay_sec == null ? null : Math.round(route.current_delay_sec / 10),
    route.predicted_delay_sec == null ? null : Math.round(route.predicted_delay_sec / 10),
    route.risk_probability == null ? null : Math.round(route.risk_probability * 20),
  ]);
}

// Wait for each frame to leave the socket before enqueueing the next one. A
// healthy client's first fleet snapshot can exceed the queue limit in total.
// The deadline still bounds how long a client can retain a snapshot in memory.
export async function sendStreamBatch(
  ws: WebSocket,
  sequence: number,
  events: readonly (readonly [string, unknown])[],
  deadlineMs = 3000,
): Promise<number> {
  const deadline = Date.now() + deadlineMs;
  for (const [type, payload] of events) {
    if (ws.readyState !== WebSocket.OPEN) break;
    if (ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES || Date.now() >= deadline) {
      ws.terminate();
      break;
    }
    const message = JSON.stringify({
      type, payload, version: 1, sequence: sequence + 1,
      timestamp: new Date().toISOString(),
    });
    const sent = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.off("close", onClose);
        if (!ok && ws.readyState === WebSocket.OPEN) ws.terminate();
        resolve(ok);
      };
      const onClose = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(1, deadline - Date.now()));
      ws.once("close", onClose);
      try { ws.send(message, (error) => finish(!error)); }
      catch { finish(false); }
    });
    if (!sent) break;
    sequence += 1;
  }
  return sequence;
}

export function sendStreamEvent(
  ws: WebSocket,
  sequence: number,
  type: string,
  payload: unknown,
): number {
  if (ws.readyState !== WebSocket.OPEN) return sequence;
  if (ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES) {
    ws.terminate();
    return sequence;
  }
  const next = sequence + 1;
  ws.send(JSON.stringify({
    type,
    payload,
    version: 1,
    sequence: next,
    timestamp: new Date().toISOString(),
  }));
  return next;
}
