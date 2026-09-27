import type { Alert, Vehicle } from "./models";

/** Preserve published warnings and include forecast risks that also need attention. */
export function attentionEvents(published: Alert[], vehicles: Vehicle[]): Alert[] {
  const events = [...published];
  const covered = new Set(published.map(event => event.vehicleId));
  for (const vehicle of vehicles) {
    if (covered.has(vehicle.id) || vehicle.telemetryStale || vehicle.hasForecast === false ||
      vehicle.riskLevel === "normal" || vehicle.riskLevel === "unknown" ||
      !Number.isFinite(vehicle.predictedDelaySec)) continue;
    const early = vehicle.predictedDelaySec < -60;
    const target = vehicle.forecastTargetTime;
    const targetMs = target ? Date.parse(target) : NaN;
    events.push({
      id: `attention-${vehicle.id}-${target || "current"}`,
      routeId: vehicle.routeId,
      vehicleId: vehicle.id,
      severity: vehicle.riskLevel === "critical" ? "critical" : vehicle.riskLevel === "high" ? "high" : "warning",
      attentionKind: early ? "early_arrival" : "forecast_risk",
      title: early ? "Раннее прибытие" : "Риск опоздания",
      description: early ? "Ожидается прибытие раньше расписания." : "Прогноз указывает на риск опоздания к остановке.",
      predictedDelaySec: vehicle.predictedDelaySec,
      riskProbability: vehicle.riskProbability,
      createdAt: vehicle.updatedAt,
      targetTime: target,
      expectedArrivalAt: Number.isFinite(targetMs)
        ? new Date(targetMs + vehicle.predictedDelaySec * 1000).toISOString() : undefined,
      modelStatus: vehicle.forecastStatus === "fallback" ? "fallback" : "ready",
    });
    covered.add(vehicle.id);
  }
  return events;
}
