import { randomUUID } from "node:crypto";
import type { Route, Vehicle } from "../src/entities/models";
import { hasBusForecast, ruleAdvice } from "../src/entities/dispatch-advice";
import type { AdviceKind, DispatchAdvice } from "../src/entities/dispatch-advice";
import { isRaining } from "../src/entities/weather-current";
import type { CurrentWeatherSnapshot } from "../src/entities/weather-current";
export { ruleAdvice } from "../src/entities/dispatch-advice";
const clipped = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

const SYSTEM_PROMPT = `Ты аналитик автобусной диспетчерской. Вход — архивный снимок, не текущая ситуация. Самостоятельно посчитай для каждого переданного автобуса изменение задержки (прогноз минус текущая), число автобусов с прогнозом >= 120 с и долю таких автобусов от машин с известным прогнозом (округлить до целого процента). Если sampledVehicleCount меньше totalVehicleCount, явно скажи, что анализ ограничен выборкой. Укажи важные вычисленные числа в summary и reason. currentWeather, если передана, — погода Яндекса СЕЙЧАС, а архивная телеметрия относится к другому времени. Не используй сегодняшнюю погоду как причину архивной задержки и не утверждай, что в момент поездки шёл дождь. Можно отдельно предложить проверить актуальную обстановку перед будущим действием; если погода недоступна, не выдумывай её. Предлагай максимум 3 проверяемых действия: текст водителю, безопасное уточнение скорости, стоянку на остановке или проверку дополнительного выпуска. Не выдумывай пробки, ограничения скорости, пассажиропоток, наличие водителей или доказанный эффект решения. Скорость только в рамках ПДД и локального ограничения, которого в данных нет; никогда не советуй превышение. Стоянка только после завершения посадки/высадки. Дополнительный выпуск предлагай лишь как проверку, если есть минимум 2 задержанных автобуса и резерв > 0. Если данных мало, скажи это. Никаких команд не отправляй. Верни только JSON-объект: {"summary":"...","metrics":{"forecastedCount":0,"delayedCount":0,"delayedSharePercent":0},"cards":[{"kind":"message|speed|dwell|reserve","title":"...","reason":"...","vehicleId":"идентификатор автобуса или null","message":"готовый текст водителю или null"}]}. Пиши по-русски.`;

export class GigachatAdvisor {
  private token = "";
  private tokenUntil = 0;
  constructor(
    private readonly authKey?: string,
    private readonly scope = "GIGACHAT_API_PERS",
    private readonly model = "GigaChat",
    private readonly fetcher: typeof fetch = fetch,
    private readonly oauthUrl = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    private readonly chatUrl = "https://api.giga.chat/v1/chat/completions",
  ) {}
  get configured() { return !!this.authKey?.trim(); }
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
  async analyze(route: Route, vehicles: Vehicle[], reserve: number, weather?: CurrentWeatherSnapshot | null): Promise<DispatchAdvice> {
    if (!this.configured) return ruleAdvice(route, vehicles, reserve);
    const fallback = ruleAdvice(route, vehicles, reserve, true);
    const fleet = vehicles.slice(0, 80).map((v) => ({
      vehicleId: v.id,
      currentDelaySec: v.currentDelayKnown === false ? null : v.currentDelaySec,
      predictedDelaySec: hasBusForecast(v) ? v.predictedDelaySec : null,
      delayChangeSec: hasBusForecast(v) && v.currentDelayKnown !== false ? v.predictedDelaySec - v.currentDelaySec : null,
      speedKmh: v.speedKmh,
      nextStop: v.nextStop?.name || null,
      forecastStatus: v.forecastStatus || "unknown",
    }));
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
              reserve, totalVehicleCount: vehicles.length, sampledVehicleCount: fleet.length, vehicles: fleet,
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
      const parsed = JSON.parse(match[0]) as { summary?: unknown; cards?: unknown; metrics?: Record<string, unknown> };
      const forecasted = fleet.filter((v) => v.predictedDelaySec !== null);
      const delayed = forecasted.filter((v) => v.predictedDelaySec! >= 120);
      const share = forecasted.length ? Math.round(delayed.length / forecasted.length * 100) : 0;
      if (parsed.metrics?.forecastedCount !== forecasted.length ||
          parsed.metrics?.delayedCount !== delayed.length ||
          !Number.isFinite(Number(parsed.metrics?.delayedSharePercent)) ||
          Math.abs(Number(parsed.metrics?.delayedSharePercent) - share) > 1)
        throw new Error("Model calculation does not match telemetry");
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
          const title = clipped(item.title, 90), reason = clipped(item.reason, 280);
          if (!title || !reason) return [];
          return [{ kind: kind as AdviceKind, title, reason, vehicleId, message: clipped(item.message, 400) || null }];
        });
      if (!cards.length) throw new Error("No usable advice");
      return {
        configured: true, source: "gigachat", generatedAt: new Date().toISOString(),
        summary: clipped(parsed.summary, 400) || fallback.summary,
        cards, note: "Текст GigaChat — гипотеза для проверки диспетчером, не расчёт эффекта и не команда водителю.",
      };
    } catch {
      return ruleAdvice(route, vehicles, reserve, true, "GigaChat недоступен либо его расчёт не прошёл проверку. Показаны подсказки по правилам.");
    }
  }
}
