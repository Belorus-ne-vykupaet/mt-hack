import type { Geometry, Vehicle } from "./models";
import { locateOnPath, prepareRoutePaths, type RoutePath } from "./vehicle-motion";

export type RoadEventKind = "accident" | "closure" | "roadworks" | "congestion";
export interface RoadEvent {
  id: string;
  kind: RoadEventKind;
  position: { lon: number; lat: number };
  bearingDeg?: number;
  description: string;
  observedAt: string;
  expiresAt: string;
  source: "yandex-router" | "event-feed" | "demo";
}
export interface RoadNotice {
  id: string;
  event: RoadEvent;
  vehicleId: string;
  routeId: string;
  routeNumber: string;
  distanceM: number;
  delayStatus: "indefinite";
  delaySec: null;
  analysisStatus: "pending" | "ready" | "unavailable";
  analysis?: string;
  recommendation?: string;
  observedAt: string;
  expiresAt: string;
}
export interface RoadMonitorState {
  configured: boolean;
  status: "needs_key" | "checking" | "ready" | "unavailable";
  checkedAt: string | null;
  items: RoadNotice[];
  usedInModel: false;
}
export interface AheadCorridor {
  vehicle: Vehicle;
  path: RoutePath;
  start: number;
  end: number;
  direction: number;
  points: { lon: number; lat: number }[];
}
export function pathPoint(path: RoutePath, along: number) {
  let i = path.distances.findIndex(d => d >= along);
  if (i <= 0) i = i === 0 ? 1 : path.coordinates.length - 1;
  const a = path.coordinates[i - 1], b = path.coordinates[i];
  const t = Math.max(0, Math.min(1, (along - path.distances[i - 1]) / (path.distances[i] - path.distances[i - 1] || 1)));
  return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t };
}
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** Follow the selected route toward the forecast target; do not infer direction from a radius. */
export function aheadCorridors(vehicles: Vehicle[], geometries: Geometry[]): AheadCorridor[] {
  const paths = prepareRoutePaths(geometries);
  return vehicles.flatMap(vehicle => {
    if (vehicle.telemetryStale) return [];
    const candidates = (paths.get(vehicle.routeId) || []).map(path => ({path, hit: locateOnPath(path, vehicle.position)}))
      .sort((a, b) => a.hit.separation - b.hit.separation);
    const best = candidates[0];
    if (!best || best.hit.separation > 100) return [];
    const {path, hit} = best;
    const target = vehicle.nextStop ? locateOnPath(path, vehicle.nextStop.position) : null;
    const direction = target && target.separation <= 100 && Math.abs(target.along - hit.along) > 30
      ? Math.sign(target.along - hit.along)
      : Number.isFinite(vehicle.bearingDeg) ? (angle(vehicle.bearingDeg!, hit.headingDeg) <= 90 ? 1 : -1) : 0;
    if (!direction) return [];
    const end = Math.max(0, Math.min(path.length, hit.along + 3000 * direction));
    if (Math.abs(end - hit.along) < 100) return [];
    const steps = Math.ceil(Math.abs(end - hit.along) / 300);
    return [{vehicle, path, start: hit.along, end, direction,
      points: Array.from({length: steps + 1}, (_, i) => pathPoint(path, hit.along + (end - hit.along) * i / steps))}];
  });
}
export function eventAhead(event: RoadEvent, corridor: AheadCorridor, now = Date.now()): number | null {
  if (Date.parse(event.expiresAt) <= now || !Number.isFinite(Date.parse(event.expiresAt)) ||
    !Number.isFinite(Date.parse(event.observedAt)) || Date.parse(event.observedAt) > now + 60000 ||
    now - Date.parse(event.observedAt) > 10 * 60000) return null;
  const hit = locateOnPath(corridor.path, event.position);
  const forward = (hit.along - corridor.start) * corridor.direction;
  const heading = (hit.headingDeg + (corridor.direction < 0 ? 180 : 0)) % 360;
  if (hit.separation > 30 || forward < 40 || forward > Math.abs(corridor.end - corridor.start) ||
    (event.bearingDeg !== undefined && angle(event.bearingDeg, heading) > 60)) return null;
  return Math.round(forward);
}
export const roadEventTitle: Record<RoadEventKind, string> = {
  accident: "ДТП впереди", closure: "Перекрытие впереди", roadworks: "Дорожные работы впереди", congestion: "Сильный затор впереди",
};
