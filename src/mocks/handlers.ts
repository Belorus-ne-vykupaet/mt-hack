import { http, HttpResponse, delay } from "msw";
import { config } from "../shared/config/env";
import { getSnapshot, geometries, simulation } from "./scenario";
import type { Scenario } from "./scenario";
if (
  [
    "normal",
    "rush-hour",
    "route-primary-delay",
    "network-disruption",
    "recovery",
  ].includes(config.mockScenario)
)
  simulation.scenario = config.mockScenario as Scenario;
if (config.visualTest) simulation.seconds = 30;
const failure = () =>
  HttpResponse.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Объект не найден",
        request_id: "demo",
      },
    },
    { status: 404 },
  );
export const handlers = [
  http.get(
    `${new URL(config.apiUrl, globalThis.location?.origin || "http://localhost:5173").href}/*`,
    async ({ request }) => {
      await delay(100);
      if (simulation.error)
        return HttpResponse.json(
          {
            error: {
              code: "UNAVAILABLE",
              message: "Сервис недоступен",
              request_id: "demo",
            },
          },
          { status: 503 },
        );
      const url = new URL(request.url);
      const basePath = new URL(config.apiUrl, request.url).pathname.replace(
        /\/$/,
        "",
      );
      const path = url.pathname.slice(basePath.length + 1);
      const s = getSnapshot();
      if (path === "network/summary") return HttpResponse.json(s.summary);
      if (path === "routes") return HttpResponse.json({ items: s.routes });
      if (path === "vehicles") return HttpResponse.json({ items: s.vehicles });
      if (path === "alerts") return HttpResponse.json({ items: s.alerts });
      if (path === "analytics/delay-series")
        return HttpResponse.json({ points: s.points });
      if (path === "analytics/top-routes")
        return HttpResponse.json({
          items: [...s.routes].sort(
            (a, b) => b.predicted_delay_sec - a.predicted_delay_sec,
          ),
        });
      if (path === "analytics/risk-distribution")
        return HttpResponse.json(
          Object.fromEntries(
            ["normal", "elevated", "high", "critical"].map((level) => [
              level,
              s.routes.filter((r) => r.risk_level === level).length,
            ]),
          ),
        );
      if (path === "forecast")
        return HttpResponse.json({
          generated_at: new Date().toISOString(),
          horizon_min: 15,
          routes: s.routes,
          vehicles: s.vehicles,
          segments: s.segments,
        });
      if (path.startsWith("forecast/vehicles/")) {
        const v = s.vehicles.find((v) => v.id === path.split("/")[2]);
        return v
          ? HttpResponse.json({
              vehicle_id: v.id,
              points: Array.from({ length: 901 }, (_, i) => i).map(
                (offset) => ({
                  offset_sec: offset,
                  predicted_delay_sec:
                    v.current_delay_sec +
                    ((v.predicted_delay_sec - v.current_delay_sec) * offset) /
                      900,
                  risk_probability: v.risk_probability,
                }),
              ),
            })
          : failure();
      }
      const [, encodedId, part] = path.split("/");
      const id = decodeURIComponent(encodedId || "");
      if (path.startsWith("routes/")) {
        if (part === "geometry") {
          const g = geometries.find((g) => g.properties.route_id === id);
          return g ? HttpResponse.json(g) : failure();
        }
        if (part === "segments")
          return HttpResponse.json({
            items: s.segments.filter((g) => g.route_id === id),
          });
        const route = s.routes.find((r) => r.id === id);
        return route ? HttpResponse.json(route) : failure();
      }
      if (path.startsWith("vehicles/")) {
        const vehicle = s.vehicles.find((v) => v.id === id);
        return vehicle ? HttpResponse.json(vehicle) : failure();
      }
      return failure();
    },
  ),
];
