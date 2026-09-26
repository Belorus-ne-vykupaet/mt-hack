import type { Route, Vehicle } from "./models";

export type AdviceKind = "message" | "speed" | "dwell" | "reserve";
export interface AdviceCard {
  kind: AdviceKind;
  title: string;
  reason: string;
  vehicleId: string | null;
  message: string | null;
}
export interface DispatchAdvice {
  configured: boolean;
  source: "rules" | "gigachat";
  generatedAt: string;
  summary: string;
  cards: AdviceCard[];
  note: string;
}
export const hasBusForecast = (v: Vehicle) =>
  v.hasForecast !== false &&
  !["no_schedule", "no_target", "stale_gps", "unavailable"].includes(v.forecastStatus || "") &&
  Number.isFinite(v.predictedDelaySec);
const minutes = (s: number) => `${(s / 60).toFixed(1)} мин`;

/** Honest fallback when no key or the external service is unavailable. */
export function ruleAdvice(route: Route, vehicles: Vehicle[], reserve: number, configured = false, note = ""): DispatchAdvice {
  const forecasted = vehicles.filter(hasBusForecast).sort((a, b) => b.predictedDelaySec - a.predictedDelaySec);
  const delayed = forecasted.filter((v) => v.predictedDelaySec >= 120);
  const lead = delayed[0];
  const cards: AdviceCard[] = [];
  if (lead) {
    cards.push({
      kind: "message", vehicleId: lead.id,
      title: `Связаться с ТС ${lead.id.replace("vehicle-", "")}`,
      reason: `Сейчас ${lead.currentDelayKnown === false ? "задержка неизвестна" : minutes(lead.currentDelaySec)}, прогноз ${minutes(lead.predictedDelaySec)}. Уточните обстановку перед решением.`,
      message: `Маршрут ${route.number}: прогноз отклонения ${minutes(lead.predictedDelaySec)}. Сообщите, пожалуйста, есть ли затор или длительная посадка у ${lead.nextStop?.name || "следующей остановки"}. Соблюдайте ПДД и безопасную посадку.`,
    });
    if (lead.nextStop)
      cards.push({
        kind: "dwell", vehicleId: lead.id,
        title: "Проверить время стоянки",
        reason: `Следующая остановка — ${lead.nextStop.name}. Сокращать стоянку можно только после завершения посадки и высадки.`,
        message: null,
      });
  }
  if (delayed.length >= 2 && reserve > 0)
    cards.push({
      kind: "reserve", vehicleId: null,
      title: "Проверить дополнительный выпуск",
      reason: `${delayed.length} автобусов с прогнозом от +2 мин; доступность резерва в учебном плане: ${reserve}. Выпуск требует проверки водителя и точки подачи.`,
      message: null,
    });
  if (!cards.length && forecasted.length)
    cards.push({
      kind: "message", vehicleId: forecasted[0].id,
      title: "Пока без вмешательства",
      reason: "По известным прогнозам нет автобусов с задержкой от двух минут. Продолжайте наблюдение.",
      message: `Маршрут ${route.number}: подтвердите обстановку на линии. Дополнительных команд пока нет.`,
    });
  return {
    configured, source: "rules", generatedAt: new Date().toISOString(),
    summary: forecasted.length
      ? `${forecasted.length} из ${vehicles.length} автобусов с прогнозом; ${delayed.length} с ожидаемой задержкой от двух минут.`
      : `На маршруте ${vehicles.length} автобусов, пригодного прогноза нет. Решение по задержке пока не рассчитывается.`,
    cards,
    note: note || (configured
      ? "Расчёт по правилам. Запросите GigaChat, чтобы получить текстовые варианты действий."
      : "Демо-подсказки по правилам. Добавьте ключ GigaChat на сервере для анализа моделью."),
  };
}
