import type { Stop } from "./models";

/** Official schedules repeat the same physical stop on every trip of a duty. */
export function uniquePhysicalStops(stops: Stop[], selectedStopId: string | null): Stop[] {
  const byPosition = new Map<string, Stop>();
  for (const stop of stops) {
    // Roughly metre-level quantization merges repeated CSV coordinates while
    // keeping distinct stop platforms on opposite sides of a street separate.
    const key = `${stop.position.lon.toFixed(5)}:${stop.position.lat.toFixed(5)}`;
    if (!byPosition.has(key) || stop.id === selectedStopId)
      byPosition.set(key, stop);
  }
  return [...byPosition.values()];
}
