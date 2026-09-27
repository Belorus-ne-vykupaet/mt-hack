import type { RealtimeClient, StreamEvent } from "../app/realtime/client";
import { simulation, getSnapshot } from "./scenario";
import { config } from "../shared/config/env";
export class MockRealtimeClient implements RealtimeClient {
  private listeners = new Set<(e: StreamEvent) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private sequence = 0;
  private vehicleIds = new Set<string>();
  private emit(type: string, payload: object) {
    const event = {
      type,
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: ++this.sequence,
      payload,
    } as StreamEvent;
    this.listeners.forEach((fn) => fn(event));
  }
  connect() {
    if (config.visualTest) simulation.seconds = 30;
    if (!simulation.offline) this.emit("system.hello", { stream_id: "demo" });
    this.timer = setInterval(() => {
      if (simulation.offline) return;
      if (!simulation.paused && !config.visualTest)
        simulation.seconds += simulation.speed;
      const s = getSnapshot();
      this.emit("system.heartbeat", {});
      const ids = new Set(s.vehicles.map((v) => v.id));
      this.vehicleIds.forEach((id) => {
        if (!ids.has(id)) this.emit("vehicle.removed", { id });
      });
      this.vehicleIds = ids;
      s.routes.forEach((r) => this.emit("route.updated", r));
      s.vehicles.forEach((v) => this.emit("vehicle.updated", v));
      this.emit("network.updated", s.summary);
      this.emit("forecast.updated", {
        routes: s.routes,
        vehicles: s.vehicles,
        segments: s.segments,
      });
      s.alerts.forEach((a) => this.emit("alert.updated", a));
      this.emit("demo.alerts.snapshot", { items: s.alerts });
      this.emit("demo.series.snapshot", { points: s.points });
    }, 1000);
  }
  disconnect() {
    clearInterval(this.timer);
    this.listeners.clear();
  }
  subscribe(fn: (e: StreamEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
