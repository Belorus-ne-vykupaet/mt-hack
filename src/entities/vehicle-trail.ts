import type { Vehicle } from "./models";
import { locateOnPath } from "./vehicle-motion";
import type { RoutePath } from "./vehicle-motion";
import { linePath } from "./route-line";

export interface TrailPoint {
  t: number;
  along: number;
}
// Observed positions since the page opened, sampled sparsely: this is history, not a replay.
const SAMPLE_MS = 10000,
  KEEP_MS = 20 * 60000;
const trails = new Map<string, TrailPoint[]>();

export function recordTrail(
  vehicles: Vehicle[],
  asOfMs: number,
  paths: Map<string, RoutePath[]>,
) {
  if (!Number.isFinite(asOfMs)) return;
  for (const v of vehicles) {
    const path = linePath(paths.get(v.routeId));
    if (!path) continue;
    const points = trails.get(v.id) || [];
    const last = points.at(-1);
    if (last && asOfMs - last.t < SAMPLE_MS && asOfMs >= last.t) continue;
    const { along, separation } = locateOnPath(path, v.position);
    if (separation > 150) continue;
    // A jump back to the start means a new trip: the old line must not connect to it.
    if (last && (asOfMs < last.t || along < last.along - 300)) points.length = 0;
    points.push({ t: asOfMs, along });
    while (points.length && asOfMs - points[0].t > KEEP_MS) points.shift();
    trails.set(v.id, points);
  }
}
export const trailOf = (id: string): readonly TrailPoint[] =>
  trails.get(id) || [];
export const clearTrails = () => trails.clear();
