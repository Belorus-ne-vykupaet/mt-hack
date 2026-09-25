import { ApiError } from "./dispatch-service";
import type { RouteDto } from "../src/shared/api/generated/models";
export function parseWeather(raw: any) {
  const c = raw?.current;
  if (
    !c ||
    !Number.isFinite(c.temperature_2m) ||
    !Number.isFinite(c.precipitation) ||
    !Number.isFinite(Date.parse(c.time + "Z"))
  )
    throw new Error("Invalid weather response");
  return {
    temperatureC: c.temperature_2m,
    precipitationMm: c.precipitation,
    observedAt: c.time + "Z",
  };
}
export function parseTraffic(raw: any) {
  const legs = raw?.route?.legs;
  if (
    !Array.isArray(legs) ||
    !legs.length ||
    legs.some(
      (l: any) =>
        l.status !== "OK" || !Array.isArray(l.steps) || !l.steps.length,
    )
  )
    throw new Error("Invalid routing response");
  const steps = legs.flatMap((l: any) => l.steps);
  if (
    steps.some(
      (s: any) => !Number.isFinite(s.duration) || s.duration < 0 || !s.polyline,
    )
  )
    throw new Error("Invalid route duration");
  return {
    durationSec: steps.reduce((sum: number, s: any) => sum + s.duration, 0),
    geometry: JSON.stringify(steps.map((s: any) => s.polyline)),
  };
}
export class Providers {
  cache = new Map<string, { until: number; value: any }>();
  pending = new Map<string, Promise<any>>();
  constructor(
    private trafficKey = "",
    private weatherEnabled = true,
    private fetcher: typeof fetch = fetch,
  ) {}
  private cached(key: string, ttl: number, load: () => Promise<any>) {
    const saved = this.cache.get(key);
    if (saved && saved.until > Date.now())
      return Promise.resolve({ ...saved.value, cached: true });
    if (this.pending.has(key)) return this.pending.get(key)!;
    const promise = load()
      .then((value) => {
        this.cache.set(key, { until: Date.now() + ttl, value });
        return value;
      })
      .catch(() => {
        // No raw provider error or URL: these may contain API keys.
        throw new ApiError(502, "Внешний сервис недоступен. Повторите позже.");
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  weather() {
    if (!this.weatherEnabled)
      throw new ApiError(503, "Погода отключена администратором.");
    return this.cached("weather", 900000, async () => {
      const r = await this.fetcher(
        "https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62&current=temperature_2m,precipitation&timezone=UTC",
        { signal: AbortSignal.timeout(6000) },
      );
      if (!r.ok) throw new Error("Provider error");
      return {
        source: "Open-Meteo",
        ...parseWeather(await r.json()),
        availableAt: new Date().toISOString(),
        usedInModel: false,
        note: "Текущая погода Москвы. Не подмешивается к архивной телеметрии.",
        cached: false,
      };
    });
  }
  traffic(route: RouteDto) {
    if (!this.trafficKey)
      throw new ApiError(503, "Для Яндекс Router API нужен серверный ключ.");
    return this.cached(`traffic:${route.id}`, 120000, async () => {
      const stops = route.stops.slice(0, 2);
      if (stops.length < 2) throw new Error("Missing stops");
      const url = new URL("https://api.routing.yandex.net/v2/route");
      url.searchParams.set("apikey", this.trafficKey);
      url.searchParams.set(
        "waypoints",
        stops.map((s) => `${s.position.lat},${s.position.lon}`).join("|"),
      );
      url.searchParams.set("mode", "driving");
      const request = async (disabled: boolean) => {
        const u = new URL(url);
        if (disabled) u.searchParams.set("traffic", "disabled");
        const r = await this.fetcher(u, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) throw new Error("Routing error");
        return parseTraffic(await r.json());
      };
      const [traffic, free] = await Promise.all([
        request(false),
        request(true),
      ]);
      const comparable =
        traffic.geometry === free.geometry && free.durationSec > 0;
      return {
        source: "Яндекс Router API",
        routeId: route.id,
        from: stops[0].name,
        to: stops[1].name,
        durationSec: traffic.durationSec,
        freeFlowSec: free.durationSec,
        ratio: comparable ? traffic.durationSec / free.durationSec : null,
        comparable,
        availableAt: new Date().toISOString(),
        usedInModel: false,
        cached: false,
        note: "Автомобильный проезд между первыми остановками, не время движения автобуса. Совпадение с автобусным путём требует отдельной проверки.",
      };
    });
  }
}
