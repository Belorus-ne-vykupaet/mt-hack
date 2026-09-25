import { config } from "../config/env";
import type { RiskLevel } from "../../entities/models";
export const riskLabels: Record<RiskLevel, string> = {
  normal: "Норма",
  elevated: "Внимание",
  high: "Высокий",
  critical: "Критический",
};
export const riskHex: Record<RiskLevel, string> = {
  normal: "#21ba96",
  elevated: "#e8b449",
  high: "#ef8b4a",
  critical: "#f06479",
};
export const riskInk: Record<RiskLevel, string> = {
  normal: "var(--risk-normal)",
  elevated: "var(--risk-elevated)",
  high: "var(--risk-high)",
  critical: "var(--risk-critical)",
};
export const riskRgb: Record<RiskLevel, [number, number, number]> = {
  normal: [33, 186, 150],
  elevated: [232, 180, 73],
  high: [239, 139, 74],
  critical: [240, 100, 121],
};
export const minutes = (sec: number) =>
  `${sec >= 0 ? "+" : ""}${(sec / 60).toFixed(1)}`;
export const percent = (n: number) => `${Math.round(n * 100)}%`;
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: config.officialMode ? "UTC" : "Europe/Moscow",
  });

export const horizonLabel = (minutes: number) => {
  const seconds = Math.round(minutes * 60);
  return seconds
    ? `+${Math.floor(seconds / 60)} мин${seconds % 60 ? ` ${seconds % 60} с` : ""}`
    : "Текущее состояние";
};
