import { config } from "../shared/config/env";
import type { RiskLevel } from "./models";
type Prediction = {
  currentDelaySec: number;
  predictedDelaySec: number;
  riskLevel: RiskLevel;
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
  const delay = delayAt(item, minutes);
  if (config.officialMode)
    return delay < -60 ? "elevated" : riskFromDelay(delay);
  if (item.riskLevel === "normal") return "normal";
  return delay >= 420
    ? "critical"
    : delay >= 240
      ? "high"
      : delay >= 120
        ? "elevated"
        : "normal";
}

export const riskFromDelay = (seconds: number): RiskLevel =>
  seconds >= 420
    ? "critical"
    : seconds >= 240
      ? "high"
      : seconds >= 120
        ? "elevated"
        : "normal";
