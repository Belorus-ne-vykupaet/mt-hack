import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { VehicleDto } from "../src/shared/api/generated/models";
import type { DailyReport, DailyReportMetrics } from "../src/entities/daily-report";

interface Narrative {
  summary: string;
  highlights: string[];
  generatedAt: string;
  model: string;
  basedOnSamples: number;
}
interface DayState {
  date: string;
  archive: boolean;
  firstAsOf: string;
  lastAsOf: string;
  sampledMinutes: string[];
  vehicleIds: string[];
  forecastVehicleIds: string[];
  routeIds: string[];
  forecastSumSec: number;
  forecastObservations: number;
  peakDelayedVehicles: number;
  peakPredictedDelaySec: number | null;
  narrative?: Narrative;
}
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const unavailable = new Set(["no_schedule", "no_target", "stale_gps", "unavailable"]);
const mean = (value: number) => `${(value / 60).toFixed(1)} мин`;

/** A sampled replay journal, not a reconstruction of a complete operating day. */
export class DailyReports {
  private days: DayState[] = [];
  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { days?: DayState[] };
      if (Array.isArray(raw.days)) this.days = raw.days.filter((day) => isoDate(day.date) && Array.isArray(day.sampledMinutes));
    } catch { /* A missing or damaged journal starts empty. */ }
  }
  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ schemaVersion: 1, days: this.days }));
    renameSync(temp, this.file);
  }
  observe(asOf: string, vehicles: VehicleDto[], archive: boolean) {
    const date = asOf.slice(0, 10), minute = asOf.slice(0, 16);
    if (!isoDate(date) || !Number.isFinite(Date.parse(asOf))) return;
    let day = this.days.find((item) => item.date === date && item.archive === archive);
    if (!day) {
      day = { date, archive, firstAsOf: asOf, lastAsOf: asOf, sampledMinutes: [],
        vehicleIds: [], forecastVehicleIds: [], routeIds: [], forecastSumSec: 0,
        forecastObservations: 0, peakDelayedVehicles: 0, peakPredictedDelaySec: null };
      this.days.push(day);
    }
    if (day.sampledMinutes.includes(minute)) return;
    day.sampledMinutes.push(minute);
    if (asOf < day.firstAsOf) day.firstAsOf = asOf;
    if (asOf > day.lastAsOf) day.lastAsOf = asOf;
    const ids = new Set(day.vehicleIds), forecastIds = new Set(day.forecastVehicleIds), routes = new Set(day.routeIds);
    let delayed = 0;
    for (const vehicle of vehicles) {
      ids.add(vehicle.id);
      if (vehicle.route_id) routes.add(vehicle.route_id);
      const predicted = vehicle.predicted_delay_sec;
      if (predicted === null || !Number.isFinite(predicted) || unavailable.has(vehicle.forecast_status || "")) continue;
      forecastIds.add(vehicle.id);
      day.forecastSumSec += predicted;
      day.forecastObservations += 1;
      day.peakPredictedDelaySec = Math.max(day.peakPredictedDelaySec ?? predicted, predicted);
      if (predicted >= 120) delayed += 1;
    }
    day.peakDelayedVehicles = Math.max(day.peakDelayedVehicles, delayed);
    day.vehicleIds = [...ids].slice(0, 5000);
    day.forecastVehicleIds = [...forecastIds].slice(0, 5000);
    day.routeIds = [...routes].slice(0, 1000);
    this.days.sort((a, b) => b.date.localeCompare(a.date));
    this.days = this.days.slice(0, 90);
    this.persist();
  }
  list() { return this.days.map((day) => this.report(day)); }
  get(date: string) {
    if (!isoDate(date)) return undefined;
    const day = this.days.find((item) => item.date === date);
    return day ? this.report(day) : undefined;
  }
  saveNarrative(date: string, summary: string, highlights: string[], model: string) {
    const day = this.days.find((item) => item.date === date);
    if (!day) return undefined;
    day.narrative = { summary, highlights, model, generatedAt: new Date().toISOString(), basedOnSamples: day.sampledMinutes.length };
    this.persist();
    return this.report(day);
  }
  private report(day: DayState): DailyReport {
    const metrics: DailyReportMetrics = {
      vehiclesObserved: day.vehicleIds.length,
      vehiclesWithForecast: day.forecastVehicleIds.length,
      routesObserved: day.routeIds.length,
      peakDelayedVehicles: day.peakDelayedVehicles,
      meanPredictedDelaySec: day.forecastObservations ? Math.round(day.forecastSumSec / day.forecastObservations) : null,
      peakPredictedDelaySec: day.peakPredictedDelaySec,
    };
    const fallback = day.forecastObservations
      ? `По ${day.sampledMinutes.length} наблюдённым срезам: прогноз был доступен для ${metrics.vehiclesWithForecast} из ${metrics.vehiclesObserved} автобусов. Средняя прогнозная задержка среди наблюдений — ${mean(metrics.meanPredictedDelaySec!)}.`
      : `По ${day.sampledMinutes.length} наблюдённым срезам видны ${metrics.vehiclesObserved} автобусов. Достаточных прогнозов задержки пока нет.`;
    const highlights = [
      `${metrics.routesObserved} маршрутов в наблюдённых срезах`,
      `Максимум одновременно с прогнозом от 2 минут: ${metrics.peakDelayedVehicles} автобусов`,
      metrics.peakPredictedDelaySec === null ? "Пиковый прогноз недоступен" : `Пиковый прогноз: ${mean(metrics.peakPredictedDelaySec)}`,
    ];
    const narrative = day.narrative;
    return {
      date: day.date, archive: day.archive, firstAsOf: day.firstAsOf, lastAsOf: day.lastAsOf,
      samples: day.sampledMinutes.length, metrics,
      source: narrative ? "gigachat" : "rules", model: narrative?.model || null,
      generatedAt: narrative?.generatedAt || day.lastAsOf,
      basedOnSamples: narrative?.basedOnSamples || day.sampledMinutes.length,
      needsRefresh: !!narrative && narrative.basedOnSamples < day.sampledMinutes.length,
      summary: narrative?.summary || fallback, highlights: narrative?.highlights || highlights,
      coverageNote: "Отчёт построен по сохранённым срезам потока. Он не описывает часы, для которых данных не было, и не является итогом полного дня.",
    };
  }
}
