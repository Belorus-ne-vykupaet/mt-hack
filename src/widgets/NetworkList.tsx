import { matchesSearch } from "../shared/lib/search";
import { useNavigate } from "react-router-dom";
import { config } from "../shared/config/env";
import { useEffect, useRef, useState } from "react";
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
  | "vehicles"
  | "routes"
  | "on-time"
  | "alerts"
  | "events"
  | "stops";
const isOnTime = (v: Vehicle) =>
  v.currentDelaySec < 120 && v.riskLevel === "normal";
const titles: Record<NetworkListKind, string> = {
  vehicles: "Транспорт на линии",
  routes: "Активные маршруты",
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
  const routeName = (id: string) => routes.find((r) => r.id === id)?.name || id;
  const rows =
    kind === "stops"
      ? routes.flatMap((r) =>
          r.stops.map((stop) => ({
            key: `${r.id}-${stop.id}`,
            routeId: r.id,
            number: r.number,
            title: stop.name,
            description: r.name,
            delay: r.predictedDelaySec,
            risk: r.riskLevel,
            probability: r.riskProbability,
            info: `Маршрут ${r.number}`,
            select: () => useUi.getState().selectStop(stop.id, r.id),
          })),
        )
      : kind === "routes"
        ? routes.map((r) => ({
            key: r.id,
            routeId: r.id,
            number: r.number,
            title: `Маршрут ${r.number}`,
            description: r.name,
            delay: r.predictedDelaySec,
            risk: r.riskLevel,
            probability: r.riskProbability,
            info: `${r.activeVehicleCount} ТС`,
            select: () => useUi.getState().selectRoute(r.id),
          }))
        : kind === "alerts" || kind === "events"
          ? alerts
              .filter(
                (a) =>
                  kind === "events" ||
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
                info: config.csvMode
                  ? "Базовый прогноз"
                  : percent(a.riskProbability),
                select: () => useUi.getState().selectRoute(a.routeId),
              }))
          : vehicles
              .filter((v) => kind !== "on-time" || isOnTime(v))
              .map((v) => ({
                key: v.id,
                routeId: v.routeId,
                number: v.routeId,
                title: `ТС ${v.id.replace("vehicle-", "")}`,
                description: routeName(v.routeId),
                delay:
                  kind === "on-time" ? v.currentDelaySec : v.predictedDelaySec,
                risk: v.riskLevel,
                probability: v.riskProbability,
                info: `${Math.round(v.speedKmh)} км/ч`,
                select: () => useUi.getState().selectVehicle(v.id, v.routeId),
              }));
  const filtered = rows.filter((r) =>
    matchesSearch(
      `${r.title} ${r.number} ${r.description} ${
        routes
          .find((route) => route.id === r.routeId)
          ?.stops.map((stop) => stop.name)
          .join(" ") || ""
      }`,
      q,
    ),
  );
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
            : kind === "alerts" || kind === "events"
              ? "События с высоким и критическим уровнем риска."
              : "Полный список транспортной сети."}{" "}
          Выберите строку, чтобы открыть карточку на карте.
        </p>
        <label className="network-list-search">
          <Search size={17} />
          <input
            ref={input}
            aria-label="Поиск в полном списке"
            placeholder="Поиск по номеру, маршруту или остановке…"
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
                <th>Маршрут / объект</th>
                <th>Направление</th>
                <th>
                  {kind === "on-time" ? "Задержка сейчас" : "Прогноз +15 мин"}
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
                  <td>{minutes(r.delay)} мин</td>
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
