import type { Alert } from "./models";
import { time } from "../shared/ui/format";

/** Keep the warning event distinct from the model's scheduled-stop target. */
export function incidentTiming(alert: Alert) {
  return {
    event: alert.eventType === "late_threshold" && alert.eventTime
      ? `Порог опоздания >2 мин: ${time(alert.eventTime)}`
      : undefined,
    warning: alert.eventLeadTimeSec != null
      ? `Первый сигнал за ${(alert.eventLeadTimeSec / 60).toFixed(1)} мин до порога`
      : alert.leadTimeSec != null
        ? `Первый сигнал за ${(alert.leadTimeSec / 60).toFixed(1)} мин до планового прибытия`
        : undefined,
    forecast: alert.forecastHorizonSec != null
      ? `При первом сигнале до плановой остановки: ${(alert.forecastHorizonSec / 60).toFixed(1)} мин`
      : undefined,
  };
}
