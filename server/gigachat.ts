import { randomUUID } from "node:crypto";
import type { Route, Vehicle } from "../src/entities/models";
import { hasBusForecast } from "../src/entities/dispatch-advice";
import type { AdviceKind, DispatchAdvice } from "../src/entities/dispatch-advice";
import { isRaining } from "../src/entities/weather-current";
import type { CurrentWeatherSnapshot } from "../src/entities/weather-current";
import type { DailyReport } from "../src/entities/daily-report";
export { ruleAdvice } from "../src/entities/dispatch-advice";
const clipped = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const visibleText = (value: unknown, max: number, route: Route) => clipped(value, max)
  .replaceAll(route.id, route.number)
  .replace(/\bvehicle-([\w-]+)\b/g, (_, id: string) => `ТС ${id}`)
  .replace(/\bdelay\b/gi, "задержка");

const SYSTEM_PROMPT = `Ты аналитик автобусной диспетчерской. Вход — архивный снимок, не текущая ситуация. Числа в metrics уже вычислены системой: не пересчитывай и не искажай их. Если sampledVehicleCount меньше totalVehicleCount, явно скажи, что анализ ограничен выборкой. currentWeather, если передана, — погода Яндекса СЕЙЧАС, а архивная телеметрия относится к другому времени. Не используй сегодняшнюю погоду как причину архивной задержки и не утверждай, что в момент поездки шёл дождь. Предлагай максимум 3 коротких проверяемых действия: текст водителю, безопасное уточнение скорости, стоянку на остановке или проверку дополнительного выпуска. Низкая скорость сама по себе не доказывает пробку, неисправность или длительную стоянку. Не выдумывай пробки, ограничения скорости, пассажиропоток, наличие водителей или доказанный эффект решения. Скорость только в рамках ПДД и локального ограничения, которого в данных нет; никогда не советуй превышение. Стоянка только после завершения посадки/высадки. Дополнительный выпуск предлагай лишь как проверку, если есть минимум 2 задержанных автобуса и резерв > 0. Если данных мало, скажи это и верни cards: []. Видимый текст пиши коротко по-русски, без ISO-дат, технических идентификаторов и английских терминов; точный исходный ID передавай только в поле vehicleId. Никаких команд не отправляй. Верни только JSON-объект: {"summary":"одно короткое предложение","cards":[{"kind":"message|speed|dwell|reserve","title":"...","reason":"...","vehicleId":"исходный идентификатор автобуса или null","message":"готовый текст водителю или null"}]}.`;

export class GigachatAdvisor {
  private token = "";
  private tokenUntil = 0;
  private adviceCache = new Map<string, { until: number; value: DispatchAdvice }>();
  private pending = new Map<string, Promise<DispatchAdvice>>();
  constructor(
    private readonly authKey?: string,
    private readonly scope = "GIGACHAT_API_PERS",
    private readonly model = "GigaChat-3-Ultra",
    private readonly fetcher: typeof fetch = fetch,
    private readonly oauthUrl = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    private readonly chatUrl = "https://api.giga.chat/v1/chat/completions",
  ) {}
  get configured() { return !!this.authKey?.trim(); }
  get modelName() { return this.model; }
  private async accessToken() {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    const key = this.authKey!.trim().replace(/^Basic\s+/i, "");
    const response = await this.fetcher(this.oauthUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${key}`,
        RqUID: randomUUID(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ scope: this.scope }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`OAuth ${response.status}`);
    const data = await response.json() as { access_token?: string; expires_at?: number };
    if (!data.access_token) throw new Error("OAuth returned no token");
    this.token = data.access_token;
    const expiry = Number(data.expires_at);
    this.tokenUntil = Number.isFinite(expiry) && expiry > 0
      ? (expiry < 1e12 ? expiry * 1000 : expiry) - 60000
      : Date.now() + 25 * 60000;
    return this.token;
  }
  async analyze(route: Route, vehicles: Vehicle[], reserve: number, weather?: CurrentWeatherSnapshot | null, force = false): Promise<DispatchAdvice> {
    if (!this.configured) throw new Error("GigaChat не подключён.");
    const cacheKey = route.id;
    const cached = this.adviceCache.get(cacheKey);
    if (!force && cached && cached.until > Date.now()) return cached.value;
    const pending = this.pending.get(cacheKey);
    if (pending) return pending;
    const task = this.analyzeFresh(route, vehicles, reserve, weather);
    this.pending.set(cacheKey, task);
    try {
      const value = await task;
      this.adviceCache.set(cacheKey, { until: Date.now() + 90_000, value });
      if (this.adviceCache.size > 100) this.adviceCache.delete(this.adviceCache.keys().next().value!);
      return value;
    } finally { this.pending.delete(cacheKey); }
  }
  private async analyzeFresh(route: Route, vehicles: Vehicle[], reserve: number, weather?: CurrentWeatherSnapshot | null): Promise<DispatchAdvice> {
    const fleet = vehicles.slice(0, 80).map((v) => ({
      vehicleId: v.id,
      currentDelaySec: v.currentDelayKnown === false ? null : v.currentDelaySec,
      predictedDelaySec: hasBusForecast(v) ? v.predictedDelaySec : null,
      delayChangeSec: hasBusForecast(v) && v.currentDelayKnown !== false ? v.predictedDelaySec - v.currentDelaySec : null,
      speedKmh: v.speedKmh,
      nextStop: v.nextStop?.name || null,
      forecastStatus: v.forecastStatus || "unknown",
    }));
    const forecasted = fleet.filter((v) => v.predictedDelaySec !== null);
    const delayed = forecasted.filter((v) => v.predictedDelaySec! >= 120);
    const metrics = { forecastedCount: forecasted.length, delayedCount: delayed.length,
      delayedSharePercent: forecasted.length ? Math.round(delayed.length / forecasted.length * 100) : 0 };
    try {
      const token = await this.accessToken();
      const response = await this.fetcher(this.chatUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model, temperature: 0.1,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify({
              route: { id: route.id, number: route.number, name: route.name },
              archiveAsOf: vehicles[0]?.updatedAt || null,
              reserve, totalVehicleCount: vehicles.length, sampledVehicleCount: fleet.length, metrics, vehicles: fleet,
              currentWeather: weather ? {
                source: weather.source, observedAt: weather.fetchedAt,
                checkedPoints: weather.points.length,
                rainPoints: weather.points.filter(isRaining).map((point) => point.name),
                cloudyPoints: weather.points.filter((point) => point.cloudiness !== "CLEAR").map((point) => point.name),
                unavailablePoints: weather.unavailablePoints.length,
              } : null,
            }) },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`Chat ${response.status}`);
      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON object");
      const parsed = JSON.parse(match[0]) as { summary?: unknown; cards?: unknown };
      const ids = new Set(vehicles.map((v) => v.id));
      const cards = (Array.isArray(parsed.cards) ? parsed.cards : [])
        .slice(0, 3)
        .flatMap((value: unknown) => {
          if (!value || typeof value !== "object") return [];
          const item = value as Record<string, unknown>;
          const kind = item.kind;
          const vehicleId = typeof item.vehicleId === "string" && ids.has(item.vehicleId) ? item.vehicleId : null;
          if (!["message", "speed", "dwell", "reserve"].includes(String(kind)) || (kind !== "reserve" && !vehicleId)) return [];
          if (kind === "reserve" && !(reserve > 0 && fleet.filter((v) => (v.predictedDelaySec ?? -Infinity) >= 120).length >= 2)) return [];
          const title = visibleText(item.title, 90, route), reason = visibleText(item.reason, 280, route);
          if (!title || !reason) return [];
          return [{ kind: kind as AdviceKind, title, reason, vehicleId, message: visibleText(item.message, 400, route) || null }];
        });
      const summary = clipped(parsed.summary, 400);
      if (!summary) throw new Error("GigaChat returned no summary");
      return {
        configured: true, source: "gigachat", model: this.model, generatedAt: new Date().toISOString(),
        summary: `Прогноз есть у ${metrics.forecastedCount} из ${vehicles.length} автобусов; задержка от 2 минут ожидается у ${metrics.delayedCount}.`,
        cards, note: "Проверьте рекомендацию перед отправкой в тестовую диспетчерскую.",
      };
    } catch (error) {
      throw new Error(`GigaChat не ответил: ${(error as Error).message}`);
    }
  }
  async dailyReport(report: DailyReport) {
    if (!this.configured) throw new Error("GigaChat is not configured");
    const token = await this.accessToken();
    const response = await this.fetcher(this.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, temperature: 0.1,
        messages: [
          { role: "system", content: "Ты аналитик автобусной диспетчерской. Создай короткую качественную сводку только по перечисленным признакам сохранённых срезов потока. Это архив, не текущая обстановка и не полный день. Числа и даты уже выводятся интерфейсом; у тебя их нет. Не упоминай количества, доли, большинство, рост, причины задержек или погоду. Скажи, что охват неполный. Не утверждай, что действия выполнены. Дай проверяемые действия для диспетчера. Верни строго JSON {\"summary\":\"одно короткое предложение\",\"highlights\":[\"действие\",\"действие\"]}." },
          { role: "user", content: JSON.stringify({
            archive: report.archive,
            coverage: "Неполный: наблюдались лишь отдельные сохранённые срезы",
            forecastCoverage: report.metrics.vehiclesWithForecast === 0
              ? "Прогноз по наблюдённым автобусам недоступен"
              : report.metrics.vehiclesWithForecast < report.metrics.vehiclesObserved
                ? "Прогноз есть не у всех наблюдённых автобусов"
                : "Прогноз есть у всех наблюдённых автобусов",
            delayRisk: report.metrics.peakDelayedVehicles > 0
              ? "Среди автобусов с прогнозом отмечены задержки"
              : "Задержки среди автобусов с прогнозом не отмечены",
            reportType: "Обзор автобусного потока",
          }) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Daily report API ${response.status}`);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const match = (data.choices?.[0]?.message?.content || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Daily report is not JSON");
    const parsed = JSON.parse(match[0]) as { summary?: unknown; highlights?: unknown };
    const summary = clipped(parsed.summary, 450);
    const highlights = (Array.isArray(parsed.highlights) ? parsed.highlights : [])
      .map((item: unknown) => clipped(item, 180)).filter(Boolean).slice(0, 3);
    if (!summary || !highlights.length) throw new Error("Daily report is incomplete");
    if (/\d/.test([summary, ...highlights].join(" "))) throw new Error("Daily report repeats unverified numbers");
    if (/большинств|меньшинств|массов|значительн/i.test([summary, ...highlights].join(" ")))
      throw new Error("Daily report overstates limited observations");
    return { summary, highlights };
  }
}
