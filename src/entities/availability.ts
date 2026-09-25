import type { PredictionAvailability, Vehicle } from "./models";
export function forecastAvailability(item: PredictionAvailability): string {
  switch (item.forecastStatus) {
    case "no_schedule": return "Нет расписания";
    case "no_target": return "Нет остановки через 10–15 минут";
    case "stale_gps": return "GPS устарел · прогноз недоступен";
    case "unavailable": return "Прогноз недоступен";
    case "fallback": return "Резервный прогноз";
    default: return item.hasForecast === false ? "Нет прогноза" : "Прогноз CatBoost";
  }
}
export function telemetryAge(vehicle: Vehicle): string {
  const seconds = Math.floor(vehicle.telemetryAgeSec ?? 0);
  const age = seconds < 60 ? `${seconds} с` : seconds < 3600 ? `${Math.floor(seconds / 60)} мин` : `${Math.floor(seconds / 3600)} ч ${Math.floor(seconds % 3600 / 60)} мин`;
  return `${vehicle.telemetryStale ? "Последний GPS" : "GPS"}: ${age} назад`;
}
