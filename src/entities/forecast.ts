import { config } from "../shared/config/env";
import type { RiskLevel } from "./models";
type Prediction = {
  currentDelaySec: number;
  predictedDelaySec: number;
  riskLevel: RiskLevel;
  telemetryStale?: boolean;
  hasForecast?: boolean;
  currentDelayKnown?: boolean;
};
export const delayAt = (item: Prediction, minutes: number) =>
  config.officialMode
    ? minutes > 0
      ? item.predictedDelaySec
      : item.currentDelaySec
    : item.currentDelaySec +
      ((item.predictedDelaySec - item.currentDelaySec) *
        Math.max(0, Math.min(15, minutes))) /
        15;
export function riskAt(item: Prediction, minutes: number): RiskLevel {
  if (item.telemetryStale || (minutes > 0 ? item.hasForecast === false : item.currentDelayKnown === false)) return "unknown";
  const delay = delayAt(item, minutes);
  // The model's probability can signal risk even when the expected delay is
  // below two minutes. Preserve the backend assessment in the forecast view;
  // the current view describes the observed deviation only.
  if (config.officialMode)
    return minutes > 0
      ? item.riskLevel
      : delay < -60 ? "elevated" : delay <= 120 ? "normal" : riskFromDelay(delay);
  if (item.riskLevel === "normal") return "normal";
  return delay >= 420
    ? "critical"
    : delay >= 240
      ? "high"
      : delay >= 120
        ? "elevated"
        : "normal";
}

export const riskFromDelay = (seconds: number): Exclude<RiskLevel, "unknown"> =>
  seconds >= 420
    ? "critical"
    : seconds >= 240
      ? "high"
      : seconds >= 120
        ? "elevated"
        : "normal";
