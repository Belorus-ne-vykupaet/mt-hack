import type { OfficialSource } from "./official";
import { YandexWeather } from "./yandex-weather";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { csvSnapshot, csvGeometries } from "../src/mocks/csv-scenario";
import { simulateDispatch } from "../src/entities/dispatch-simulation";
import { recommendDispatch } from "../src/entities/dispatch-recommendations";
import { mapGeometry, mapRoute, mapVehicle } from "../src/entities/adapters";
import { riskFromDelay } from "../src/entities/forecast";
import { DispatchService, ApiError } from "./dispatch-service";
import { Providers } from "./providers";
import { ModelProvider } from "./model";
import { routeStreamVersion, sendStreamBatch, sendStreamEvent, vehicleStreamVersion } from "./stream";
import { DriverOutbox } from "./driver-outbox";
import { GigachatAdvisor } from "./gigachat";
import { DailyReports } from "./daily-reports";
import { RoadMonitor } from "./road-monitor";
export interface ServerOptions {
  official?: OfficialSource;
  journal?: string;
  token?: string;
  publicRead?: boolean;
  origins?: string[];
  weather?: boolean;
  trafficKey?: string;
  trafficEventsUrl?: string;
  trafficEventsToken?: string;
  yandexWeatherKey?: string;
  modelUrl?: string;
  modelKey?: string;
  frozen?: boolean;
  fetcher?: typeof fetch;
  driverOutbox?: string;
  gigachatKey?: string;
  gigachatScope?: string;
  gigachatModel?: string;
  gigachatFetcher?: typeof fetch;
  reportStore?: string;
}
export function createApi(options: ServerOptions = {}) {
  const started = Date.now(),
    base = {
      ...csvSnapshot(900),
      ...(options.official ? { routes: options.official.routes } : {}),
    },
    geometries = csvGeometries.map(mapGeometry),
    dispatch = new DispatchService(options.journal, base.routes);
  const driverOutbox = new DriverOutbox(options.driverOutbox);
  const dailyReports = new DailyReports(options.reportStore);
  const gigachat = new GigachatAdvisor(
    options.gigachatKey,
    options.gigachatScope,
    options.gigachatModel,
    options.gigachatFetcher || options.fetcher,
  );
  const providers = new Providers(
    options.trafficKey,
    options.weather !== false,
    options.fetcher,
  );
  const roadMonitor = new RoadMonitor(gigachat, {
    routerKey: options.trafficKey, eventsUrl: options.trafficEventsUrl,
    eventsToken: options.trafficEventsToken, fetcher: options.fetcher,
  });
  const yandexWeather = new YandexWeather(
    options.yandexWeatherKey,
    options.weather !== false,
    options.fetcher,
  );
  const model = new ModelProvider(
    options.modelUrl,
    options.modelKey,
    options.fetcher,
  );
  const origins = options.origins || [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ];
  const authorized = (req: IncomingMessage) => {
    if (!options.token) return true;
    const supplied =
      req.headers.authorization?.replace(/^Bearer /, "") ||
      (req.headers.cookie || "")
        .split("; ")
        .find((c) => c.startsWith("transit_api_session="))
        ?.slice(20) ||
      "";
    const a = Buffer.from(supplied),
      b = Buffer.from(options.token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const allowedOrigin = (req: IncomingMessage) =>
    !req.headers.origin || origins.includes(req.headers.origin);
  const readBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 65536) throw new ApiError(413, "Запрос слишком большой.");
      chunks.push(part);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApiError(400, "Некорректный JSON.");
    }
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const snapshot = async () => {
    if (options.official) {
      const raw = await options.official.snapshot();
      dailyReports.observe(raw.summary.timestamp, raw.vehicles, true);
      return raw;
    }
    const raw = csvSnapshot(
      900 + (options.frozen ? 0 : Math.floor((Date.now() - started) / 1000)),
    );
    const predicted = await model.predict(
      raw.vehicles,
      raw.vehicles
        .map((v) => v.updated_at)
        .sort()
        .at(-1) || raw.summary.timestamp,
    );
    if (predicted) {
      raw.vehicles.forEach((v) => {
        v.predicted_delay_sec = predicted.get(v.id)!;
        v.risk_level = riskFromDelay(v.predicted_delay_sec);
      });
      raw.routes.forEach((r) => {
        r.predicted_delay_sec = Math.max(
          0,
          ...raw.vehicles
            .filter((v) => v.route_id === r.id)
            .map((v) => v.predicted_delay_sec),
        );
        r.risk_level = riskFromDelay(r.predicted_delay_sec);
      });
      raw.summary.average_predicted_delay_sec =
        raw.vehicles.reduce((n, v) => n + v.predicted_delay_sec, 0) /
        (raw.vehicles.length || 1);
      const delayed = raw.vehicles.filter(
        (v) => v.current_delay_sec >= 120,
      ).length;
      const atRisk = raw.vehicles.filter(
        (v) => v.current_delay_sec < 120 && v.predicted_delay_sec >= 120,
      ).length;
      const count = raw.vehicles.length || 1;
      raw.summary.delayed_percent = (delayed / count) * 100;
      raw.summary.at_risk_percent = (atRisk / count) * 100;
      raw.summary.on_time_percent =
        ((raw.vehicles.length - delayed - atRisk) / count) * 100;
      const now = Date.parse(raw.summary.timestamp);
      raw.points = raw.points.map((p) =>
        p.predicted_delay_sec === null
          ? p
          : {
              ...p,
              predicted_delay_sec:
                raw.summary.average_delay_sec +
                (raw.summary.average_predicted_delay_sec -
                  raw.summary.average_delay_sec) *
                  Math.max(
                    0,
                    Math.min(1, (Date.parse(p.timestamp) - now) / 900000),
                  ),
            },
      );
      raw.alerts = raw.routes
        .filter((r) => r.predicted_delay_sec >= 120)
        .map((r) => ({
          id: `model-${r.id}`,
          type: "delay_risk",
          route_id: r.id,
          vehicle_id: raw.vehicles.find(
            (v) =>
              v.route_id === r.id &&
              v.predicted_delay_sec === r.predicted_delay_sec,
          )!.id,
          severity:
            r.risk_level === "critical"
              ? ("critical" as const)
              : r.risk_level === "high"
                ? ("high" as const)
                : ("warning" as const),
          title: "Прогноз подключённой модели",
          description: `Модель ${model.version} · горизонт 15 минут`,
          risk_probability: 0,
          predicted_delay_sec: r.predicted_delay_sec,
          created_at: raw.summary.timestamp,
        }));
    }
    const result = simulateDispatch(raw, dispatch.plans);
    dailyReports.observe(result.summary.timestamp, result.vehicles, false);
    return result;
  };
  const server = createServer(async (req, res) => {
    try {
      if (!allowedOrigin(req)) throw new ApiError(403, "Origin не разрешён.");
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
      if (req.method === "OPTIONS") {
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, Idempotency-Key",
        );
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url!, "http://localhost"),
        path = url.pathname.replace(/^\/api\/v1/, "");
      if (req.method === "POST" && path === "/session") {
        const body = await readBody(req);
        const test = {
          ...req,
          headers: {
            authorization: `Bearer ${typeof body.token === "string" ? body.token : ""}`,
          },
        } as IncomingMessage;
        if (!authorized(test))
          throw new ApiError(401, "Неверный ключ доступа.");
        if (options.token)
          res.setHeader(
            "Set-Cookie",
            `transit_api_session=${options.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          );
        return json(res, 200, { authenticated: true });
      }
      if (!authorized(req) && !(options.publicRead && req.method === "GET"))
        throw new ApiError(401, "Требуется вход в API. Откройте «Интеграции».");
      if (req.method === "GET" && path === "/health")
        return json(res, 200, {
          status: "ok",
          mode: options.official ? "official" : "sandbox",
          version: "1.0",
          transport: "REST + WebSocket",
        });
      if (req.method === "GET" && path === "/ml/status") {
        if (!options.official) return json(res, 200, { mode: "demo" });
        try {
          return json(res, 200, {
            ...(await options.official.read<Record<string, unknown>>(
              "/status",
            )),
            stale: options.official.stale,
          });
        } catch {
          return json(res, 200, {
            mode: "official",
            status: "disconnected",
            stale: true,
          });
        }
      }
      if (
        req.method === "GET" &&
        path === "/integrations" &&
        options.official
      ) {
        const state = await options.official.read<{
          mode: string;
          status: string;
          asOf: string;
          modelVersion: string;
          metrics?: { externalFeaturesUsed?: boolean };
        }>("/status");
        return json(res, 200, {
          mode: state.mode,
          network: {
            status: "connected",
            source: "Официальные CSV · воспроизведение телеметрии",
            asOf: state.asOf,
          },
          dispatch: {
            status: "connected",
            executor: "Планы без воздействия на официальные данные",
            persisted: !!options.journal,
          },
          model: {
            status: state.status,
            configured: true,
            version: state.modelVersion,
          },
          weather: {
            status: options.weather === false ? "disabled" : "available",
            source: "Open-Meteo",
          },
          traffic: {
            status: options.trafficKey ? "configured" : "needs_key",
            source: "Яндекс Router API",
          },
          authenticated: !!options.token,
          externalFeaturesUsed: state.metrics?.externalFeaturesUsed === true,
        });
      }
      if (req.method === "GET" && path === "/integrations")
        return json(res, 200, {
          mode: "sandbox",
          network: {
            status: "connected",
            source: "Учебные CSV через REST / WebSocket",
            asOf: (await snapshot()).summary.timestamp,
          },
          dispatch: {
            status: "connected",
            executor: "Учебный исполнитель",
            persisted: !!options.journal,
          },
          model: {
            status: model.status,
            configured: !!options.modelUrl,
            version: model.version,
          },
          weather: {
            status: options.weather === false ? "disabled" : "available",
            source: "Open-Meteo",
          },
          traffic: {
            status: options.trafficKey ? "configured" : "needs_key",
            source: "Яндекс Router API",
          },
          authenticated: !!options.token,
          externalFeaturesUsed: false,
        });
      if (req.method === "GET" && path === "/openapi.json")
        return json(
          res,
          200,
          JSON.parse(
            readFileSync(
              new URL("../contracts/integration-openapi.json", import.meta.url),
              "utf8",
            ),
          ),
        );
      if (req.method === "GET" && path === "/external/yandex-weather/status")
        return json(res, 200, {
          configured: yandexWeather.configured,
          source: "Яндекс Погода",
        });
      if (req.method === "GET" && path === "/external/yandex-weather/current")
        return json(res, 200, await yandexWeather.current());
      if (req.method === "GET" && path === "/external/yandex-weather/timeline")
        return json(res, 200, await yandexWeather.timeline());
      const weatherTile = path.match(
        /^\/external\/yandex-weather\/tiles\/(clouds|precipitation)\/(\d+)\/(\d+)\/(\d+)$/,
      );
      if (req.method === "GET" && weatherTile) {
        const bytes = await yandexWeather.tile(
          weatherTile[1] as "clouds" | "precipitation",
          Number(weatherTile[2]),
          Number(weatherTile[3]),
          Number(weatherTile[4]),
          Number(url.searchParams.get("time")),
          Number(url.searchParams.get("generation")),
        );
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(bytes);
        return;
      }
      if (req.method === "GET" && path === "/external/weather")
        return json(res, 200, await providers.weather());
      if (path === "/traffic/notifications" && req.method === "GET") {
        if (roadMonitor.configured) {
          const s = await snapshot();
          const geo = options.official ? (await options.official.snapshot()).geometries.map(mapGeometry) : geometries;
          void roadMonitor.refresh(s.vehicles.map(mapVehicle), s.routes.map(mapRoute), geo);
        }
        return json(res, 200, roadMonitor.state());
      }
      if (path === "/traffic/demo" && req.method === "POST") {
        const body = await readBody(req) as {vehicleId?: unknown; clear?: unknown};
        if (body.clear === true) { roadMonitor.clearDemo(); return json(res, 200, roadMonitor.state()); }
        if (typeof body.vehicleId !== "string") throw new ApiError(400, "Выберите автобус.");
        const s = await snapshot();
        if (!s.vehicles.some(v => v.id === body.vehicleId)) throw new ApiError(404, "Автобус не найден.");
        const geo = options.official ? (await options.official.snapshot()).geometries.map(mapGeometry) : geometries;
        try { await roadMonitor.demo(body.vehicleId, s.vehicles.map(mapVehicle), s.routes.map(mapRoute), geo); }
        catch { throw new ApiError(422, "Не удалось определить участок впереди автобуса. Выберите другой автобус."); }
        return json(res, 200, roadMonitor.state());
      }
      if (req.method === "GET" && path === "/external/traffic") {
        const route = base.routes.find(
          (r) => r.id === url.searchParams.get("route_id"),
        );
        if (!route) throw new ApiError(404, "Маршрут не найден.");
        return json(res, 200, await providers.traffic(route));
      }
      if (path === "/dispatch/commands" && req.method === "GET")
        return json(res, 200, dispatch.publicState());
      if (path === "/dispatch/driver-messages" && req.method === "GET") {
        if (!authorized(req)) throw new ApiError(401, "Нужен вход для просмотра сообщений водителям.");
        return json(res, 200, { items: driverOutbox.list(url.searchParams.get("route_id") || undefined) });
      }
      if (path === "/dispatch/driver-messages" && req.method === "POST") {
        const body = await readBody(req) as Record<string, unknown>;
        const s = await snapshot();
        const route = s.routes.find((r) => r.id === body.routeId);
        const vehicle = s.vehicles.find((v) => v.id === body.vehicleId);
        if (!route || !vehicle) throw new ApiError(404, "Маршрут или автобус не найден.");
        return json(res, 201, driverOutbox.save(body, mapRoute(route), mapVehicle(vehicle)));
      }
      if (path === "/dispatch/advice" && (req.method === "GET" || req.method === "POST")) {
        const body = req.method === "POST" ? await readBody(req) as { routeId?: unknown; refresh?: unknown } : null;
        const routeId = req.method === "GET" ? url.searchParams.get("route_id") : body?.routeId;
        const s = await snapshot();
        const rawRoute = s.routes.find((r) => r.id === routeId);
        if (!rawRoute) throw new ApiError(404, "Маршрут не найден.");
        const route = mapRoute(rawRoute);
        const vehicles = s.vehicles.filter((v) => v.route_id === route.id).map(mapVehicle);
        const reserve = options.official ? 0 : dispatch.publicState().reserve;
        const currentWeather = req.method === "POST" && gigachat.configured && yandexWeather.configured
          ? await yandexWeather.current().catch(() => null)
          : null;
        if (req.method === "GET") return json(res, 200, { configured: gigachat.configured, model: gigachat.modelName });
        if (!gigachat.configured) throw new ApiError(503, "GigaChat не подключён.");
        try {
          return json(res, 200, await gigachat.analyze(route, vehicles, reserve, currentWeather, body?.refresh === true));
        } catch (error) {
          const detail = (error as Error).message;
          console.warn("GigaChat route advice failed:", detail);
          if (/fetch failed|timeout|aborted/i.test(detail))
            throw new ApiError(503, "Нет соединения с GigaChat API. Повторите запрос, когда сеть будет доступна.");
          throw new ApiError(502, "Не удалось получить рекомендации GigaChat. Повторите запрос позже.");
        }
      }
      if (path === "/dispatch/reports" && req.method === "GET") {
        await snapshot();
        return json(res, 200, {
          items: dailyReports.list(), modelConfigured: gigachat.configured, model: gigachat.modelName,
        });
      }
      const dailyReportPath = path.match(/^\/dispatch\/reports\/(\d{4}-\d{2}-\d{2})(\/generate)?$/);
      if (dailyReportPath && (req.method === "GET" || req.method === "POST")) {
        await snapshot();
        const date = dailyReportPath[1];
        const report = dailyReports.get(date);
        if (!report) throw new ApiError(404, "Для этой даты нет наблюдений.");
        if (req.method === "GET" && !dailyReportPath[2]) return json(res, 200, report);
        if (req.method === "POST" && dailyReportPath[2]) {
          if (!gigachat.configured) throw new ApiError(503, "GigaChat не подключён.");
          if (report.source === "gigachat" && !report.needsRefresh) return json(res, 200, report);
          try {
            const generated = await gigachat.dailyReport(report);
            return json(res, 200, dailyReports.saveNarrative(date, generated.summary, generated.highlights, gigachat.modelName));
          } catch {
            throw new ApiError(502, "GigaChat не смог сформировать отчёт. Сводка по данным сохранена; попробуйте позже.");
          }
        }
      }
      if (
        path === "/dispatch/commands" &&
        req.method === "POST" &&
        options.official
      ) {
        const body = await readBody(req);
        if (body.mode !== "plan")
          throw new ApiError(
            409,
            "В официальном потоке доступно только сохранение плана. Применение учебных мер отключено.",
          );
        return json(
          res,
          201,
          // The official catalog has zero fleet counts; validate against the
          // same live source used by routes and dispatcher recommendations.
          dispatch.submit(
            body,
            String(req.headers["idempotency-key"] || ""),
            (await snapshot()).routes,
          ),
        );
      }
      if (path === "/dispatch/commands" && req.method === "POST")
        return json(
          res,
          201,
          dispatch.submit(
            await readBody(req),
            String(req.headers["idempotency-key"] || ""),
          ),
        );
      const cancel = path.match(/^\/dispatch\/commands\/([^/]+)\/cancel$/);
      if (cancel && req.method === "POST")
        return json(
          res,
          200,
          dispatch.cancel(
            decodeURIComponent(cancel[1]),
            (await readBody(req)).revision,
          ),
        );
      if (req.method !== "GET")
        throw new ApiError(405, "Метод не поддерживается.");
      if (path === "/analytics/forecast-evaluation") {
        if (!options.official) throw new ApiError(404, "Журнал доступен в официальном потоке.");
        const params = new URLSearchParams();
        for (const id of url.searchParams.getAll("route_id").slice(0, 1000)) params.append("route_id", id);
        return json(res, 200, await options.official.read(`/analytics/forecast-evaluation?${params}`));
      }
      const s = await snapshot();
      if (path === "/dispatch/recommendations")
        return json(res, 200, {
          revision: dispatch.state.revision,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
          method: "rules-v2",
          reserve: dispatch.publicState().reserve,
          items: recommendDispatch({
            routes: s.routes.filter((r) => r.predicted_delay_sec !== null && r.stops.length).map(mapRoute),
            vehicles: s.vehicles.filter((v) => v.predicted_delay_sec !== null).map(mapVehicle),
            plans: dispatch.plans,
            asOf: s.summary.timestamp,
            demo: true,
            geometries: options.official
              ? (await options.official.snapshot()).geometries.map(mapGeometry)
              : geometries,
          }),
        });
      if (path === "/network/summary") return json(res, 200, s.summary);
      if (path === "/routes") return json(res, 200, { items: s.routes });
      if (path === "/vehicles")
        return json(res, 200, {
          items: s.vehicles.filter(
            (v) =>
              !url.searchParams.get("route_id") ||
              v.route_id === url.searchParams.get("route_id"),
          ),
        });
      if (path === "/alerts") return json(res, 200, { items: s.alerts });
      if (path === "/analytics/delay-series")
        return json(res, 200, { points: s.points });
      if (path === "/analytics/top-routes")
        return json(res, 200, {
          items: [...s.routes].sort(
            (a, b) => (b.predicted_delay_sec ?? -Infinity) - (a.predicted_delay_sec ?? -Infinity),
          ),
        });
      if (path === "/analytics/risk-distribution")
        return json(
          res,
          200,
          Object.fromEntries(
            ["normal", "elevated", "high", "critical"].map((level) => [
              level,
              s.routes.filter((r) => r.risk_level === level).length,
            ]),
          ),
        );
      if (path === "/routes/geometry") {
        const geometries = options.official
          ? (await options.official.snapshot()).geometries
          : csvGeometries;
        return json(res, 200, { items: geometries });
      }
      if (path === "/forecast")
        return json(res, 200, {
          generated_at: s.summary.timestamp,
          horizon_min: 15,
          routes: s.routes,
          vehicles: s.vehicles,
          segments: s.segments,
        });
      const parts = path.split("/").map(decodeURIComponent),
        id = parts[2];
      if (parts[1] === "routes") {
        if (parts[3] === "geometry") {
          const geometries = options.official
            ? (await options.official.snapshot()).geometries
            : csvGeometries;
          const g = geometries.find((g) => g.properties.route_id === id);
          if (g) return json(res, 200, g);
        } else if (parts[3] === "segments")
          return json(res, 200, {
            items: s.segments.filter((g) => g.route_id === id),
          });
        else {
          const r = s.routes.find((r) => r.id === id);
          if (r) return json(res, 200, r);
        }
      }
      if (parts[1] === "vehicles") {
        const v = s.vehicles.find((v) => v.id === id);
        if (v) return json(res, 200, v);
      }
      if (parts[1] === "forecast" && parts[2] === "vehicles") {
        const v = s.vehicles.find((v) => v.id === parts[3]);
        if (v && options.official)
          return json(res, 200, {
            vehicle_id: v.id,
            points: v.predicted_delay_sec !== null && v.forecast_horizon_sec ? [
              {
                offset_sec: v.forecast_horizon_sec,
                predicted_delay_sec: v.predicted_delay_sec,
                risk_probability: v.risk_probability,
              },
            ] : [],
          });
        if (v)
          return json(res, 200, {
            vehicle_id: v.id,
            points: Array.from({ length: 901 }, (_, i) => ({
              offset_sec: i,
              predicted_delay_sec:
                (v.current_delay_sec ?? 0) +
                (((v.predicted_delay_sec ?? 0) - (v.current_delay_sec ?? 0)) * i) / 900,
              risk_probability: v.risk_probability,
            })),
          });
      }
      throw new ApiError(404, "Объект не найден.");
    } catch (error) {
      const e = error as Error;
      json(res, error instanceof ApiError ? error.status : 500, {
        error: {
          request_id: randomUUID(),
          code: error instanceof ApiError ? String(error.status) : "INTERNAL",
          message:
            error instanceof ApiError
              ? e.message
              : "Внутренняя ошибка сервера.",
        },
      });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on("upgrade", (req, socket, head) => {
    if (
      new URL(req.url!, "http://localhost").pathname !== "/api/v1/stream" ||
      !allowedOrigin(req) ||
      (!authorized(req) && !options.publicRead)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  const sequences = new WeakMap<WebSocket, number>();
  const send = (ws: WebSocket, type: string, payload: unknown) => {
    sequences.set(ws, sendStreamEvent(ws, sequences.get(ws) || 0, type, payload));
  };
  // Each client has its own consecutive sequence; broadcasts share the same events below.
  wss.on("connection", (ws) =>
    send(ws, "system.hello", { stream_id: "api-sandbox" }),
  );
  let busy = false,
    previous = new Set<string>(),
    previousRoutes = new Set<string>(),
    routeVersions = new Map<string, string>(),
    vehicleVersions = new Map<string, string>(),
    segmentVersion = "";
  const timer = setInterval(async () => {
    if (!wss.clients.size || busy) return;
    // Deliver new official telemetry on the next stream tick. The downstream
    // version checks keep unchanged vehicles and routes out of the batch.
    busy = true;
    try {
      const s = await snapshot();
      const events: [string, unknown][] = [[
        "system.heartbeat",
        { stale: options.official?.stale ?? false },
      ]];
      const ids = new Set(s.vehicles.map((v) => v.id));
      for (const id of previous)
        if (!ids.has(id)) {
          events.push(["vehicle.removed", { id }]);
          vehicleVersions.delete(id);
        }
      previous = ids;
      const routeIds = new Set(s.routes.map((r) => r.id));
      const knownRoutes = previousRoutes;
      for (const id of previousRoutes)
        if (!routeIds.has(id)) {
          events.push(["route.removed", { id }]);
          routeVersions.delete(id);
        }
      previousRoutes = routeIds;
      s.routes.forEach((r) => {
        const patch = {
          id: r.id,
          vehicle_count: r.vehicle_count,
          current_delay_sec: r.current_delay_sec,
          predicted_delay_sec: r.predicted_delay_sec,
          risk_probability: r.risk_probability,
          risk_level: r.risk_level,
          forecast_status: r.forecast_status,
        };
        const version = options.official ? routeStreamVersion(patch) : JSON.stringify(patch);
        if (!knownRoutes.has(r.id) || routeVersions.get(r.id) !== version)
          events.push(["route.updated", knownRoutes.has(r.id) ? patch : r]);
        routeVersions.set(r.id, version);
      });
      s.vehicles.forEach((v) => {
        const version = options.official ? vehicleStreamVersion(v) : JSON.stringify(v);
        if (vehicleVersions.get(v.id) !== version)
          events.push(["vehicle.updated", v]);
        vehicleVersions.set(v.id, version);
      });
      const nextSegmentVersion = JSON.stringify(s.segments);
      if (nextSegmentVersion !== segmentVersion) {
        events.push(["forecast.updated", { segments: s.segments }]);
        segmentVersion = nextSegmentVersion;
      }
      events.push(
        ["network.updated", s.summary],
        ["alerts.snapshot", { items: s.alerts }],
        ["analytics.snapshot", { points: s.points }],
      );
      await Promise.all([...wss.clients].map(async (ws) => {
        sequences.set(ws, await sendStreamBatch(ws, sequences.get(ws) || 0, events));
      }));
    } catch {
      for (const ws of wss.clients) ws.close(1011, "Snapshot unavailable");
    } finally {
      busy = false;
    }
  }, 1000);
  server.on("close", () => {
    clearInterval(timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      server.close(() => resolve());
    });
  return { server, dispatch, providers, model, close };
}
