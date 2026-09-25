import { ApiError } from "./dispatch-service";
import {
  CLOUD_COVER,
  PRECIP_STRENGTH,
  WEATHER_LOCATIONS,
} from "../src/entities/weather-current";
import type {
  CurrentWeatherSnapshot,
  CurrentWeatherPoint,
} from "../src/entities/weather-current";
import { weatherTiles, MOSCOW_WEATHER_BOUNDS } from "../src/entities/weather";
import type {
  WeatherStep,
  WeatherTileKind,
  WeatherTimeline,
} from "../src/entities/weather";
const allowedTiles = new Set(
  weatherTiles([...MOSCOW_WEATHER_BOUNDS]).map((t) => `${t.z}/${t.x}/${t.y}`),
);
const query = `{ weatherByPoint(request: { lat: 55.75, lon: 37.62 }) { nowcast { steps { timestamp genTime } } } }`;
export class YandexWeather {
  private key: string;
  private enabled: boolean;
  private fetcher: typeof fetch;
  private saved?: { until: number; data: WeatherTimeline };
  private pending?: Promise<WeatherTimeline>;
  private currentSaved?: { until: number; data: CurrentWeatherSnapshot };
  private currentPending?: Promise<CurrentWeatherSnapshot>;
  private currentFailure?: { until: number; error: Error };
  private tiles = new Map<string, { until: number; bytes: Buffer }>();
  private pendingTiles = new Map<string, Promise<Buffer>>();
  constructor(key = "", enabled = true, fetcher: typeof fetch = fetch) {
    this.key = key;
    this.enabled = enabled;
    this.fetcher = fetcher;
  }
  get configured() {
    return this.enabled && !!this.key;
  }
  private requireKey() {
    if (!this.enabled)
      throw new ApiError(503, "Погода отключена администратором.");
    if (!this.key)
      throw new ApiError(
        503,
        "Яндекс Погода не подключена. Добавьте серверный ключ API погоды.",
      );
  }
  async current(): Promise<CurrentWeatherSnapshot> {
    this.requireKey();
    if (this.currentSaved && this.currentSaved.until > Date.now())
      return this.currentSaved.data;
    if (this.currentPending) return this.currentPending;
    if (this.currentFailure && this.currentFailure.until > Date.now())
      throw this.currentFailure.error;
    this.currentPending = this.loadCurrent()
      .catch((error) => {
        this.currentFailure = { until: Date.now() + 60000, error };
        throw error;
      })
      .finally(() => {
        this.currentPending = undefined;
      });
    return this.currentPending;
  }
  private async loadCurrent(): Promise<CurrentWeatherSnapshot> {
    const query = `{ ${WEATHER_LOCATIONS.map((p) => `${p.id}: weatherByPoint(request: {lat:${p.lat},lon:${p.lon}}) { now { cloudiness precType precStrength } }`).join("\n")} }`;
    const response = await this.provider(
      "https://api.weather.yandex.ru/graphql/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      },
    );
    let raw;
    try {
      raw = await response.json();
    } catch {
      throw new ApiError(502, "Некорректный ответ Яндекс Погоды.");
    }
    const points: CurrentWeatherPoint[] = [],
      unavailablePoints: string[] = [];
    for (const location of WEATHER_LOCATIONS) {
      const now = raw?.data?.[location.id]?.now;
      if (
        !now ||
        !Object.hasOwn(CLOUD_COVER, now.cloudiness) ||
        !Object.hasOwn(PRECIP_STRENGTH, now.precStrength) ||
        !["NO_TYPE", "RAIN", "SLEET", "SNOW", "HAIL"].includes(now.precType)
      ) {
        unavailablePoints.push(location.id);
        continue;
      }
      points.push({
        ...location,
        cloudiness: now.cloudiness,
        precipitationType: now.precType,
        precipitationStrength: now.precStrength,
      });
    }
    if (!points.length)
      throw new ApiError(
        502,
        "Яндекс не предоставил текущую погоду. Проверьте срок действия и доступ ключа.",
      );
    const data: CurrentWeatherSnapshot = {
      schemaVersion: 1,
      source: "Яндекс Погода",
      mode: "current-points",
      fetchedAt: new Date().toISOString(),
      refreshAfterSec: 900,
      points,
      unavailablePoints,
    };
    this.currentSaved = { until: Date.now() + 900000, data };
    this.currentFailure = undefined;
    return data;
  }
  async timeline(): Promise<WeatherTimeline> {
    this.requireKey();
    if (this.saved && this.saved.until > Date.now()) return this.saved.data;
    if (this.pending) return this.pending;
    this.pending = this.loadTimeline().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async provider(url: string, init: RequestInit = {}) {
    try {
      const response = await this.fetcher(url, {
        ...init,
        headers: { ...init.headers, "X-Yandex-Weather-Key": this.key },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403)
        throw new ApiError(
          502,
          "Яндекс отклонил доступ. Проверьте срок действия ключа и права тарифа.",
        );
      if (response.status === 429)
        throw new ApiError(
          503,
          "Лимит запросов Яндекс Погоды исчерпан. Повторите позже.",
        );
      if (!response.ok) throw new Error("Provider unavailable");
      return response;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(502, "Данные Яндекс Погоды временно недоступны.");
    }
  }
  private async loadTimeline() {
    const r = await this.provider(
      "https://api.weather.yandex.ru/graphql/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      },
    );
    let raw;
    try {
      raw = await r.json();
    } catch {
      throw new ApiError(502, "Некорректный ответ Яндекс Погоды.");
    }
    const input = raw?.data?.weatherByPoint?.nowcast?.steps;
    if (
      Array.isArray(raw?.errors) &&
      raw.errors.some(
        (error: { message?: unknown }) =>
          typeof error?.message === "string" &&
          /access denied/i.test(error.message),
      )
    )
      throw new ApiError(
        502,
        "Ключ Яндекс Погоды работает, но тариф не даёт доступ к картам облачности и осадков Nowcast. Нужен доступ от Яндекса к этому продукту.",
      );
    if (raw?.errors?.length || !Array.isArray(input))
      throw new ApiError(
        502,
        "Яндекс не предоставил таймлайн. Проверьте доступ тарифа к Nowcast.",
      );
    const now = Date.now() / 1000;
    const steps: WeatherStep[] = input
      .map((s: { timestamp?: unknown; genTime?: unknown } | null) => ({
        time: Number(s?.timestamp),
        generation: Number(s?.genTime),
      }))
      .filter(
        (s: WeatherStep) =>
          Number.isSafeInteger(s.time) &&
          Number.isSafeInteger(s.generation) &&
          s.time > now - 7200 &&
          s.time < now + 90000 &&
          s.generation > now - 86400 &&
          s.generation <= now + 300,
      )
      .sort((a: WeatherStep, b: WeatherStep) => a.time - b.time);
    if (!steps.length)
      throw new ApiError(
        502,
        "У Яндекса нет актуальных погодных кадров для Москвы.",
      );
    const data: WeatherTimeline = {
      source: "Яндекс Погода",
      configured: true,
      steps,
      fetchedAt: new Date().toISOString(),
    };
    this.saved = { until: Date.now() + 300000, data };
    return data;
  }
  async tile(
    kind: WeatherTileKind,
    z: number,
    x: number,
    y: number,
    time: number,
    generation: number,
  ): Promise<Buffer> {
    this.requireKey();
    if (
      ![z, x, y, time, generation].every(Number.isSafeInteger) ||
      !allowedTiles.has(`${z}/${x}/${y}`) ||
      !["clouds", "precipitation"].includes(kind)
    )
      throw new ApiError(400, "Недопустимый погодный тайл.");
    const timeline = await this.timeline();
    if (
      !timeline.steps.some(
        (s) => s.time === time && s.generation === generation,
      )
    )
      throw new ApiError(409, "Погодный кадр устарел. Обновите таймлайн.");
    const key = `${kind}/${z}/${x}/${y}/${time}/${generation}`;
    const cached = this.tiles.get(key);
    if (cached && cached.until > Date.now()) return cached.bytes;
    if (this.pendingTiles.has(key)) return this.pendingTiles.get(key)!;
    const promise = this.loadTile(kind, z, x, y, time, generation)
      .then((bytes) => {
        if (this.tiles.size >= 64)
          this.tiles.delete(this.tiles.keys().next().value!);
        this.tiles.set(key, { until: Date.now() + 600000, bytes });
        return bytes;
      })
      .finally(() => this.pendingTiles.delete(key));
    this.pendingTiles.set(key, promise);
    return promise;
  }
  private async loadTile(
    kind: WeatherTileKind,
    z: number,
    x: number,
    y: number,
    time: number,
    generation: number,
  ) {
    const endpoint = kind === "clouds" ? "cloudiness_tile" : "tile";
    const url = new URL(
      `https://api.weather.yandex.ru/frontend/nowcast/${endpoint}`,
    );
    Object.entries({
      x,
      y,
      z,
      for_date: time,
      nowcast_gen_time: generation,
      proj: "EPSG:3857",
    }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const r = await this.provider(url.href);
    if (!r.headers.get("content-type")?.includes("image/png"))
      throw new ApiError(
        502,
        "Яндекс вернул неподдерживаемый формат погодного тайла.",
      );
    if (Number(r.headers.get("content-length")) > 2000000)
      throw new ApiError(502, "Слишком большой погодный тайл.");
    const bytes = Buffer.from(await r.arrayBuffer());
    if (
      bytes.length > 2000000 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new ApiError(502, "Повреждённый погодный тайл.");
    return bytes;
  }
}
