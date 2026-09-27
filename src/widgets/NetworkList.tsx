import { forecastAvailability, telemetryAge } from "../entities/availability";
import { indexStopForecasts, stopForecastKey } from "../entities/stop-forecasts";
import { uniquePhysicalStops } from "../entities/map-stops";
import { matchesSearch } from "../shared/lib/search";
import { useNavigate } from "react-router-dom";
import { config } from "../shared/config/env";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Route, Vehicle, Alert } from "../entities/models";
import { useUi } from "../app/store";
import { Empty, RouteBadge, RiskBadge } from "../shared/ui/primitives";
import { minutes, percent } from "../shared/ui/format";

export type NetworkListKind =
  | "forecasts"
  | "vehicles"
  | "routes"
  | "on-time"
  | "alerts"
  | "events"
  | "stops";
const isOnTime = (v: Vehicle) =>
  v.currentDelayKnown !== false && !v.telemetryStale && v.currentDelaySec >= -60 && v.currentDelaySec <= 120 && v.riskLevel === "normal";
const titles: Record<NetworkListKind, string> = {
  forecasts: "Автобусы с прогнозом",
  vehicles: config.officialMode ? "Автобусы на карте" : "Транспорт на линии",
  routes: config.officialMode ? "Планы ТС с расписанием" : "Активные маршруты",
  stops: "Остановки сети",
  "on-time": "Транспорт по расписанию",
  alerts: "События, требующие внимания",
  events: "Все события сети",
};
export function NetworkList({
  kind,
  routes,
  vehicles,
  alerts,
  onClose,
}: {
  kind: NetworkListKind;
  routes: Route[];
  vehicles: Vehicle[];
  alerts: Alert[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const q = query.trim().toLocaleLowerCase("ru");
  const routeById = useMemo(() => new Map(routes.map(route => [route.id, route])), [routes]);
  const routeStopsText = useMemo(() => kind === "stops" ? new Map<string, string>() : new Map(
    routes.map(route => [route.id, route.stops.map(stop => stop.name).join(" ")]),
  ), [routes, kind]);
  const stopForecasts = useMemo(() => indexStopForecasts(vehicles), [vehicles]);
  const rows = useMemo(() =>
    kind === "stops"
      ? routes.flatMap((r) =>
          (config.officialMode ? uniquePhysicalStops(r.stops, null) : r.stops)
          .filter(stop => stopForecasts.has(stopForecastKey(r.id, stop)))
          .map((stop) => {
            const forecast = stopForecasts.get(stopForecastKey(r.id, stop));
            return {
              key: `${r.id}-${stop.id}`,
              routeId: r.id,
              number: r.number,
              title: stop.name,
              description: r.name,
              delay: forecast?.predictedDelaySec ?? null,
              risk: forecast?.riskLevel ?? "unknown" as const,
              probability: forecast?.riskProbability ?? 0,
              info: forecast ? `Прогноз ТС ${forecast.id.replace("vehicle-", "")}` : `${config.officialMode ? "План ТС" : "Маршрут"} ${r.number}`,
              select: () => useUi.getState().selectStop(forecast?.nextStop?.id || stop.id, r.id),
            };
          }),
        )
      : kind === "routes"
        ? routes.map((r) => ({
            key: r.id,
            routeId: r.id,
            number: r.number,
            title: `${config.officialMode ? "План ТС" : "Маршрут"} ${r.number}`,
            description: r.name,
            delay: r.hasForecast === false ? null : r.predictedDelaySec,
            risk: r.riskLevel,
            probability: r.riskProbability,
            info: `${r.activeVehicleCount} ТС`,
            select: () => useUi.getState().selectRoute(r.id),
          }))
        : kind === "alerts" || kind === "events"
          ? alerts
              .filter(
                (a) =>
                  kind === "events" || config.officialMode ||
                  a.severity === "critical" ||
                  a.severity === "high",
              )
              .map((a) => ({
                key: a.id,
                routeId: a.routeId,
                number: a.routeId,
                title: a.title,
                description: a.description,
                delay: a.predictedDelaySec,
                risk:
                  a.severity === "critical"
                    ? ("critical" as const)
                    : a.severity === "high"
                      ? ("high" as const)
                      : a.severity === "warning"
                        ? ("elevated" as const)
                        : ("normal" as const),
                probability: a.riskProbability,
                info: a.attentionKind === "early_arrival" ? "Раннее прибытие" : config.csvMode
                  ? "Базовый прогноз"
                  : percent(a.riskProbability),
                select: () => useUi.getState().selectRoute(a.routeId),
              }))
          : vehicles
               .filter((v) => kind !== "on-time" || isOnTime(v))
              .filter((v) => kind !== "forecasts" || v.hasForecast !== false)
              .map((v) => ({
                key: v.id,
                routeId: v.routeId,
                number: v.routeId,
                title: `ТС ${v.id.replace("vehicle-", "")}`,
                description: routeById.get(v.routeId)?.name || v.routeId,
                delay:
                  kind === "on-time" ? v.currentDelaySec : v.hasForecast === false ? null : v.predictedDelaySec,
                risk: v.riskLevel,
                probability: v.riskProbability,
                info: config.officialMode ? `${telemetryAge(v)} · ${forecastAvailability(v)}` : `${Math.round(v.speedKmh)} км/ч`,
                select: () => useUi.getState().selectVehicle(v.id, v.routeId),
              })), [kind, routes, vehicles, alerts, routeById, stopForecasts]);
  const filtered = useMemo(() => !q ? rows : rows.filter((r) =>
    matchesSearch(
      `${r.title} ${r.number} ${r.description} ${routeStopsText.get(r.routeId) || ""}`,
      q,
    ),
  ), [rows, q, routeStopsText]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / 25) - 1);
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  return createPortal(
    <div
      className="network-list-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="network-list-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-list-title"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Tab") {
            const focusable = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input,a[href]",
              ) || [],
            );
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <div>
            <span className="list-eyebrow">МОСКВА · ВСЯ СЕТЬ</span>
            <h2 id="network-list-title">
              {titles[kind]} <span>{rows.length}</span>
            </h2>
          </div>
          <button aria-label="Закрыть список" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <p className="network-list-description">
          {kind === "on-time"
            ? "Транспорт с задержкой менее 2 минут и низким риском."
            : kind === "stops"
              ? "Остановки с доступным прогнозом."
            : kind === "alerts" || kind === "events"
              ? "События, требующие внимания."
              : "Полный список транспортной сети."}{" "}
          Выберите строку, чтобы открыть карточку на карте.
        </p>
        <label className="network-list-search">
          <Search size={17} />
          <input
            ref={input}
            aria-label="Поиск в полном списке"
            placeholder={config.officialMode ? "Поиск по ТС, плану или остановке…" : "Поиск по номеру, маршруту или остановке…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="network-list-table">
          <table>
            <thead>
              <tr>
                <th>{config.officialMode ? "План ТС / объект" : "Маршрут / объект"}</th>
                <th>Направление</th>
                <th>
                  {kind === "on-time" ? "Задержка сейчас" : config.officialMode ? "Прогноз к остановке" : "Прогноз +15 мин"}
                </th>
                <th>Риск</th>
                <th>
                  <span className="sr-only">Открыть</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td>
                    <button
                      className="list-row-button"
                      onClick={() => {
                        useUi.getState().set({ riskFilter: "all" });
                        navigate("/overview");
                        r.select();
                        onClose();
                      }}
                    >
                      <RouteBadge number={r.number} risk={r.risk} />
                      <span>
                        {r.title}
                        <small>{r.info}</small>
                      </span>
                    </button>
                  </td>
                  <td>{r.description}</td>
                  <td>{r.delay === null ? "—" : `${minutes(r.delay)} мин`}</td>
                  <td>
                    <RiskBadge risk={r.risk} />
                  </td>
                  <td>
                    <button
                      aria-label={`Открыть ${r.title}`}
                      onClick={() => {
                        useUi.getState().set({ riskFilter: "all" });
                        navigate("/overview");
                        r.select();
                        onClose();
                      }}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <Empty
              title="Ничего не найдено"
              description="Попробуйте другой номер или название."
            />
          )}
        </div>
        <footer>
          <span>
            {filtered.length
              ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, filtered.length)} из ${filtered.length}`
              : "0 объектов"}
          </span>
          <div>
            <button
              aria-label="Предыдущая страница"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {currentPage + 1} / {maxPage + 1}
            </span>
            <button
              aria-label="Следующая страница"
              disabled={currentPage >= maxPage}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
