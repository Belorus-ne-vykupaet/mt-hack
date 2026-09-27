import type { Stop, Vehicle } from "./models";
import { physicalStopKey } from "./map-stops";

export const stopForecastKey = (routeId: string, stop: Stop) => `${routeId}:${physicalStopKey(stop)}`;
const severity = { unknown: 0, normal: 1, elevated: 2, high: 3, critical: 4 };

/** Forecasts belong to the bus's target stop, not every stop on its route. */
export function indexStopForecasts(vehicles: Vehicle[]): Map<string, Vehicle> {
  const result = new Map<string, Vehicle>();
  for (const vehicle of vehicles) {
    if (!vehicle.nextStop || vehicle.telemetryStale || vehicle.hasForecast === false ||
      vehicle.riskLevel === "unknown" || !Number.isFinite(vehicle.predictedDelaySec)) continue;
    const key = stopForecastKey(vehicle.routeId, vehicle.nextStop);
    const previous = result.get(key);
    if (!previous || severity[vehicle.riskLevel] > severity[previous.riskLevel] ||
      (severity[vehicle.riskLevel] === severity[previous.riskLevel] && vehicle.predictedDelaySec > previous.predictedDelaySec)) {
      result.set(key, vehicle);
    }
  }
  return result;
}
