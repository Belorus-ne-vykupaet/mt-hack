import { createHash } from "node:crypto";
import type { Geometry, Route, Vehicle } from "../src/entities/models";
import { aheadCorridors, eventAhead, pathPoint, type AheadCorridor, type RoadEvent, type RoadMonitorState, type RoadNotice } from "../src/entities/road-events";
import type { GigachatAdvisor } from "./gigachat";
import { locateOnPath } from "../src/entities/vehicle-motion";

export function parseRoadEvents(raw: unknown, now = Date.now()): RoadEvent[] {
  const items = (raw as {items?: unknown})?.items;
  if (!Array.isArray(items)) throw new Error("Invalid event feed");
  return items.slice(0, 2000).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const e = item as RoadEvent;
    if (!e.id || typeof e.id !== "string" || !["accident", "closure", "roadworks", "congestion"].includes(e.kind) ||
      !Number.isFinite(e.position?.lat) || Math.abs(e.position.lat) > 90 ||
      !Number.isFinite(e.position?.lon) || Math.abs(e.position.lon) > 180 ||
      !Number.isFinite(Date.parse(e.observedAt)) || !Number.isFinite(Date.parse(e.expiresAt)) ||
      Date.parse(e.expiresAt) <= now || Date.parse(e.observedAt) > now + 60000 || now - Date.parse(e.observedAt) > 600000 ||
      (e.bearingDeg !== undefined && (!Number.isFinite(e.bearingDeg) || e.bearingDeg < 0 || e.bearingDeg >= 360))) return [];
    return [{id: e.id.slice(0, 150), kind: e.kind, position: e.position, bearingDeg: e.bearingDeg,
      description: typeof e.description === "string" ? e.description.slice(0, 500) : "Дорожное событие",
      observedAt: e.observedAt, expiresAt: new Date(Math.min(Date.parse(e.expiresAt), now + 600000)).toISOString(), source: "event-feed" as const}];
  });
}
export class RoadMonitor {
  private items = new Map<string, RoadNotice>();
  private lastCheck = 0;
  private checkedAt: string | null = null;
  private pending = false;
  private failed = false;
  private analyses = new Map<string, {at: number; value: {analysis: string; recommendation: string}}>();
  private demoPending = new Map<string, Promise<RoadNotice>>();
  constructor(private advisor: Pick<GigachatAdvisor, "configured" | "analyzeRoadEvent">,
    private options: {routerKey?: string; eventsUrl?: string; eventsToken?: string; fetcher?: typeof fetch} = {}) {}
  get configured() { return !!(this.options.routerKey || this.options.eventsUrl); }
  state(): RoadMonitorState {
    for (const [id, notice] of this.items) if (Date.parse(notice.expiresAt) <= Date.now()) this.items.delete(id);
    return {configured: this.configured, status: !this.configured ? "needs_key" : this.pending ? "checking" : this.failed ? "unavailable" : "ready",
      checkedAt: this.checkedAt, items: [...this.items.values()].sort((a, b) => a.distanceM - b.distanceM), usedInModel: false};
  }
  clearDemo() { for (const [id, n] of this.items) if (n.event.source === "demo") this.items.delete(id); }
  async demo(vehicleId: string, vehicles: Vehicle[], routes: Route[], geometries: Geometry[]) {
    const current = this.demoPending.get(vehicleId);
    if (current) return current;
    const corridor = aheadCorridors(vehicles.filter(v => v.id === vehicleId), geometries)[0];
    if (!corridor) throw new Error("Не удалось определить участок впереди автобуса. Выберите другой автобус.");
    const now = Date.now();
    const event: RoadEvent = {id: `demo-${vehicleId}`, kind: "accident", source: "demo",
      position: pathPoint(corridor.path, corridor.start + Math.min(650, Math.abs(corridor.end - corridor.start) / 2) * corridor.direction),
      description: "Тестовое ДТП: одна полоса перекрыта, время восстановления движения неизвестно.",
      observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60000).toISOString()};
    const task = this.publish(event, corridor, routes);
    this.demoPending.set(vehicleId, task);
    try { return await task; } finally { this.demoPending.delete(vehicleId); }
  }
  async refresh(vehicles: Vehicle[], routes: Route[], geometries: Geometry[]) {
    if (!this.configured || this.pending || Date.now() - this.lastCheck < 120000) return;
    this.pending = true; this.lastCheck = Date.now();
    try {
      const corridors = aheadCorridors(vehicles, geometries);
      const events = this.options.eventsUrl ? await this.feed() : [];
      const found = new Set<string>();
      for (const corridor of corridors) {
        for (const event of events) if (eventAhead(event, corridor) !== null) {
          const notice = await this.publish(event, corridor, routes); found.add(notice.id);
        }
      }
      if (this.options.routerKey) {
        // Bounded concurrency; requests are deduplicated by the two-minute sweep.
        let index = 0;
        const results = await Promise.allSettled(Array.from({length: Math.min(3, corridors.length)}, async () => {
          while (index < corridors.length) {
            const corridor = corridors[index++];
            const event = await this.traffic(corridor);
            if (event) { const notice = await this.publish(event, corridor, routes); found.add(notice.id); }
          }
        }));
        if (results.some(result => result.status === "rejected")) throw new Error("Traffic partially unavailable");
      }
      for (const [id, n] of this.items) if (n.event.source !== "demo" && !found.has(id)) this.items.delete(id);
      this.checkedAt = new Date().toISOString(); this.failed = false;
    } catch { this.failed = true; } finally { this.pending = false; }
  }
  private async feed() {
    const response = await (this.options.fetcher || fetch)(this.options.eventsUrl!, {
      headers: this.options.eventsToken ? {Authorization: `Bearer ${this.options.eventsToken}`} : {}, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Events unavailable");
    return parseRoadEvents(await response.json());
  }
  private async traffic(corridor: AheadCorridor): Promise<RoadEvent | null> {
    const request = async (free: boolean) => {
      const url = new URL("https://api.routing.yandex.net/v2/route");
      url.searchParams.set("apikey", this.options.routerKey!);
      url.searchParams.set("waypoints", corridor.points.map(p => `${p.lat},${p.lon}`).join("|"));
      url.searchParams.set("mode", "driving");
      if (free) url.searchParams.set("traffic", "disabled");
      const response = await (this.options.fetcher || fetch)(url, {signal: AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error("Router unavailable");
      const raw = await response.json() as {traffic_type: string; route?: {legs?: {status: string; steps: {duration: number; polyline: {points: number[][]}}[]}[]}};
      if (!free && raw.traffic_type !== "realtime") throw new Error("No current traffic");
      const legs = raw.route?.legs;
      if (!legs?.length || legs.some(l => l.status !== "OK" || !l.steps?.length)) throw new Error("Invalid route");
      const steps = legs.flatMap(l => l.steps);
      if (steps.some(s => !Number.isFinite(s.duration) || s.duration < 0 || !s.polyline?.points?.length)) throw new Error("Invalid steps");
      const coordinates = steps.flatMap(s => s.polyline.points).map(p => ({lat:p[0], lon:p[1]}));
      // Reject detours that do not follow the bus road, even if they are fast for a car.
      if (coordinates.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || locateOnPath(corridor.path, p).separation > 50)) throw new Error("Different road");
      return {duration: steps.reduce((sum, s) => sum + s.duration, 0), geometry: JSON.stringify(coordinates)};
    };
    const [busy, free] = await Promise.all([request(false), request(true)]);
    if (busy.geometry !== free.geometry || free.duration <= 0 || busy.duration / free.duration < 2 || busy.duration - free.duration < 180) return null;
    const now = Date.now();
    const position = corridor.points[Math.floor(corridor.points.length / 2)];
    return {id: `congestion-${corridor.vehicle.id}`, kind: "congestion", source: "yandex-router", position,
      description: "Яндекс сообщает о сильном замедлении на участке впереди. Причина и время окончания затора неизвестны.",
      observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60000).toISOString()};
  }
  private async publish(event: RoadEvent, corridor: AheadCorridor, routes: Route[]) {
    const distance = eventAhead(event, corridor);
    if (distance === null) throw new Error("Event is not ahead");
    const route = routes.find(r => r.id === corridor.vehicle.routeId);
    const id = `${event.source}:${event.id}:${corridor.vehicle.id}`;
    const notice: RoadNotice = {id, event, vehicleId: corridor.vehicle.id, routeId: corridor.vehicle.routeId,
      routeNumber: route?.number || corridor.vehicle.routeId, distanceM: distance, delayStatus: "indefinite", delaySec: null,
      analysisStatus: this.advisor.configured ? "pending" : "unavailable", observedAt: event.observedAt, expiresAt: event.expiresAt};
    this.items.set(id, notice);
    const key = createHash("sha256").update(JSON.stringify([id, event.kind, event.description])).digest("hex");
    const cached = this.analyses.get(key);
    try {
      if (!this.advisor.configured) return notice;
      const result = cached && Date.now() - cached.at < 600000 ? cached.value : await this.advisor.analyzeRoadEvent(notice);
      Object.assign(notice, result, {analysisStatus: "ready"});
      this.analyses.set(key, {at: Date.now(), value: result});
      if (this.analyses.size > 200) this.analyses.delete(this.analyses.keys().next().value!);
    } catch { notice.analysisStatus = "unavailable"; }
    return notice;
  }
}
