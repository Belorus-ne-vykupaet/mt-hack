import { incidentTiming } from "../entities/incident";
import { forecastAvailability, telemetryAge } from "../entities/availability";
import { matchesSearch } from "../shared/lib/search";
import { Timeline } from "./Timeline";
import { useState } from "react";
import {
  X,
  BusFront,
  ChevronRight,
  MapPin,
  ArrowUpRight,
  Info,
  Clock3,
  Gauge,
  Radio,
  Layers,
} from "lucide-react";
import { useTheme } from "../app/theme";
import { useUi } from "../app/store";
import { Panel, Empty, RiskBadge, RouteBadge } from "../shared/ui/primitives";
import { minutes, riskHex, riskInk, horizonLabel } from "../shared/ui/format";
import { Chart } from "../shared/ui/Chart";
import { config } from "../shared/config/env";
import { useOfficialModelStatus } from "../entities/official-model-status";
import type { Route, Vehicle, Segment, Alert } from "../entities/models";
import { useNavigate } from "react-router-dom";
const DebugPanel = () => import("./DebugPanel");
export function DetailsPanel({
  routes,
  vehicles,
  segments,
  alerts = [],
  forecastControl = false,
}: {
  routes: Route[];
  vehicles: Vehicle[];
  segments: Segment[];
  alerts?: Alert[];
  forecastControl?: boolean;
}) {
  const ui = useUi();
  const model = useOfficialModelStatus();
  const planClock = model.data?.mode === "official-ndtp" ? "UTC плана" : "часы CSV";
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"overview" | "stops" | "vehicles">("overview");
  const [query, setQuery] = useState("");
  const [Debug, setDebug] = useState<React.ComponentType | null>(null);
  const route = routes.find((r) => r.id === ui.selectedRouteId);
  const vehicle = vehicles.find((v) => v.id === ui.selectedVehicleId);
  const isVehicle = ui.rightPanel === "vehicle";
  const entity = isVehicle ? vehicle : route;
  const title =
    ui.rightPanel === "route"
      ? `Маршрут ${route?.number || ui.selectedRouteId || ""}`
      : isVehicle
        ? `ТС ${ui.selectedVehicleId?.replace("vehicle-", "") || ""}`
        : {
            routes: "Маршруты",
            vehicles: "Транспорт",
            stops: "Остановки",
            settings: "Настройки",
            alerts: "События",
            vehicle: "Транспорт",
          }[ui.rightPanel];
  const q = query.toLowerCase();
  const localVehicles = vehicles.filter(
    (v) =>
      (ui.rightPanel === "vehicle" || ui.rightPanel === "route"
        ? v.routeId === ui.selectedRouteId
        : true) && matchesSearch(`${v.id} ${v.routeId}`, q),
  );
  const routeSegments = segments.filter((s) => s.routeId === route?.id);
  const relatedAlerts = alerts
    .filter((alert) => isVehicle ? alert.vehicleId === vehicle?.id : alert.routeId === route?.id)
    .sort((a, b) => b.riskProbability - a.riskProbability);
  const factorVehicle = isVehicle ? vehicle : [...localVehicles]
    .filter((v) => v.observedFactor)
    .sort((a, b) => b.riskProbability - a.riskProbability)[0];
  const observedFactor = factorVehicle?.observedFactor || relatedAlerts.find((alert) => alert.observedFactor)?.observedFactor;
  const suspectedCause = factorVehicle?.suspectedCause || relatedAlerts.find((alert) => alert.suspectedCause)?.suspectedCause;
  const incident = relatedAlerts[0];
  const timing = incident ? incidentTiming(incident) : undefined;
  const currentSegment = routeSegments.find((segment) => segment.id === vehicle?.currentSegmentId);
  const renderVehicle = (v: Vehicle) => (
    <button
      className="entity-row"
      key={v.id}
      onClick={() => ui.selectVehicle(v.id, v.routeId)}
    >
      <BusFront size={16} />
      <div>
        <strong>ТС {v.id.replace("vehicle-", "")}</strong>
        <small>Маршрут {v.routeId}</small>
      </div>
      <span style={{ color: riskInk[v.riskLevel] }}>
        {v.hasForecast === false ? forecastAvailability(v) : `${minutes(v.predictedDelaySec)} мин`}
      </span>
      <ChevronRight size={14} />
    </button>
  );
  return (
    <Panel
      title={title || "Карточка"}
      className="detail-panel"
      action={
        <button
          className="icon-button"
          aria-label="Закрыть карточку"
          onClick={ui.clear}
        >
          <X size={17} />
        </button>
      }
    >
      {(ui.rightPanel === "route" || isVehicle) && (!entity || !route) ? (
        <Empty
          title="Объект больше не доступен"
          description="Он мог завершить рейс или исчезнуть из потока. Выберите другой объект."
        />
      ) : entity && route && (ui.rightPanel === "route" || isVehicle) ? (
        <>
          <p className="detail-name">{route.name}</p>
          <RiskBadge
            risk={entity.riskLevel}
            probability={entity.riskProbability}
          />
          {isVehicle && (
            <button
              className="route-back"
              onClick={() => ui.selectRoute(route.id)}
            >
              Открыть маршрут {route.number}
              <ArrowUpRight size={13} />
            </button>
          )}
          <div
            className="detail-tabs"
            role="tablist"
            aria-label="Карточка маршрута"
          >
            {(["overview", "stops", "vehicles"] as const).map((t, i) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {["Обзор", "Остановки", "Транспорт"][i]}
              </button>
            ))}
          </div>
          {tab === "overview" ? (
            <>
              {!isVehicle && (
                <div className="route-impact">
                  <strong>Участки и транспорт с риском</strong>
                  <span>
                    {routeSegments.length
                      ? `${routeSegments.filter((s) => s.riskLevel !== "normal" && s.riskLevel !== "unknown").length} из ${routeSegments.length} наблюдаемых участков`
                      : "Участок не определён"}
                    {" · "}
                    {vehicles.filter((v) => v.routeId === route.id && v.riskLevel !== "normal" && v.riskLevel !== "unknown").length}
                    {" из "}{route.activeVehicleCount} автобусов
                  </span>
                  <small>
                    Статус маршрута отражает наибольший риск. Цвет участка
                    показывает риск находящихся на нём ТС к целевой остановке.
                  </small>
                </div>
              )}
              {forecastControl && <Timeline compact />}
              {entity.hasForecast === false ? (
                <div className="official-detail-note" role="status">
                  <strong>{forecastAvailability(entity)}</strong>
                  <p>Автобус остаётся на карте по последней известной позиции. Отсутствие прогноза не означает движение по расписанию.</p>
                </div>
              ) : <div className="detail-forecast">
                <span>
                  {config.officialMode
                    ? `К остановке через ${((vehicle?.forecastHorizonSec || localVehicles[0]?.forecastHorizonSec || 900) / 60).toFixed(1)} мин`
                    : horizonLabel(ui.forecastOffsetMin)}
                </span>
                <strong style={{ color: riskInk[entity.riskLevel] }}>
                  {minutes(
                    config.officialMode
                      ? entity.predictedDelaySec
                      : entity.currentDelaySec +
                          ((entity.predictedDelaySec - entity.currentDelaySec) *
                            ui.forecastOffsetMin) /
                            15,
                  )}{" "}
                  <small>мин</small>
                </strong>
                <small>
                  {config.csvMode
                    ? "Базовый прогноз: задержка сохранится"
                    : config.dataSource === "mock"
                      ? "Демонстрационный прогноз"
                      : "Прогноз подключённого сервиса"}
                </small>
              </div>}
              <div className="detail-data">
                <span>
                  <Clock3 size={13} />
                  Текущая задержка
                </span>
                <strong>{entity.currentDelayKnown === false ? "Нет данных" : `${minutes(entity.currentDelaySec)} мин`}</strong>
              </div>
              {vehicle && isVehicle ? (
                <>
                  <div className="detail-data">
                    <span>
                      <Gauge size={13} />
                      {vehicle.telemetryStale ? "Скорость при последнем GPS" : "Текущая скорость"}
                    </span>
                    <strong>{Math.round(vehicle.speedKmh)} км/ч</strong>
                  </div>
                  {config.officialMode && vehicle.doorsOpen != null && <div className="detail-data">
                    <span>Двери{vehicle.telemetryStale ? " при последнем GPS" : ""}</span>
                    <strong>{vehicle.doorsOpen ? "Открыты" : "Закрыты"}</strong>
                  </div>}
                  <div className="detail-data">
                    <span>
                      {config.officialMode
                        ? "Целевая остановка прогноза"
                        : "Следующая остановка"}
                    </span>
                    <strong>{vehicle.nextStop?.name || "Не определена"}</strong>
                  </div>
                  <div className="detail-data">
                    <span>Текущий участок</span>
                    <strong>{currentSegment?.name || "Участок не определён"}</strong>
                  </div>
                  {currentSegment && <>
                    <div className="detail-data">
                      <span>Средняя скорость на участке</span>
                      <strong>{currentSegment.meanSpeedKmh == null ? "Нет данных" : `${currentSegment.meanSpeedKmh.toFixed(1)} км/ч`}</strong>
                    </div>
                    <div className="detail-data">
                      <span>Простой на участке</span>
                      <strong>{currentSegment.dwellSec == null ? "Нет данных" : `${(currentSegment.dwellSec / 60).toFixed(1)} мин`}</strong>
                    </div>
                  </>}
                  <div className="detail-data">
                    <span>{telemetryAge(vehicle)}</span>
                    <strong>{vehicle.updatedAt.replace("T", " ").slice(11, 19)} · {planClock}</strong>
                  </div>
                </>
              ) : (
                <div className="detail-data">
                  <span>
                    <BusFront size={13} />
                    Транспорт на линии
                  </span>
                  <strong>{route.activeVehicleCount} ТС</strong>
                </div>
              )}
              {config.officialMode && incident?.eventType === "late_threshold" && (
                <div className="official-detail-note">
                  <strong>Риск опоздания &gt;2 мин</strong>
                  <p>{timing?.event}. {timing?.warning}.</p>
                  {timing?.forecast && <small>{timing.forecast}.</small>}
                </div>
              )}
              <button
                className="primary-button"
                onClick={() => navigate("/dispatch")}
              >
                Управление маршрутом
                <ArrowUpRight size={15} />
              </button>
              {config.officialMode && entity.hasForecast !== false && (
                <p className="official-detail-note">
                  План:{" "}
                  {(
                    vehicle?.forecastTargetTime ||
                    localVehicles[0]?.forecastTargetTime
                  )?.slice(11, 19)}{" "}
                  · {planClock}. Вероятность — опоздание более 120 секунд.
                  Отрицательная задержка означает раннее прибытие. Промежуточный
                  прогноз по минутам не рассчитывается.
                </p>
              )}
              {!config.officialMode && (
                <>
                  <h3>Развитие задержки</h3>
                  <Chart
                    height={132}
                    label="Прогноз развития задержки маршрута"
                    option={{
                      grid: { left: 5, right: 12, top: 10, bottom: 25 },
                      xAxis: {
                        type: "category",
                        data: ["Сейчас", "+3", "+6", "+10", "+15"],
                        axisLabel: { color: "#818875" },
                        axisLine: { lineStyle: { color: "#d9ddd2" } },
                        axisTick: { show: false },
                      },
                      yAxis: { show: false, type: "value" },
                      tooltip: { trigger: "axis" },
                      series: [
                        {
                          name: "Задержка, мин",
                          type: "line",
                          data: [0, 3, 6, 10, 15].map((x) =>
                            Number(
                              (
                                (entity.currentDelaySec +
                                  ((entity.predictedDelaySec -
                                    entity.currentDelaySec) *
                                    x) /
                                    15) /
                                60
                              ).toFixed(1),
                            ),
                          ),
                          lineStyle: {
                            color: riskHex[entity.riskLevel],
                            type: "dashed",
                            width: 2,
                          },
                          itemStyle: { color: riskHex[entity.riskLevel] },
                          symbolSize: 5,
                          areaStyle: {
                            color: riskHex[entity.riskLevel],
                            opacity: 0.07,
                          },
                        },
                      ],
                    }}
                  />
                </>
              )}
              <div className="explanation-placeholder">
                <Info size={16} />
                <div>
                  <strong>Возможная причина</strong>
                  <p>{suspectedCause || "Пока не определена: недостаточно признаков для гипотезы."}</p>
                  {observedFactor && <small>Наблюдаемый признак: {observedFactor}. Это гипотеза по телеметрии, а не установленная причинность.</small>}
                </div>
              </div>
              <button
                className="primary-button"
                onClick={() => {
                  ui.set({ mapMode: "flow" });
                  navigate("/overview");
                  ui.selectRoute(route.id);
                }}
              >
                Показать на карте в 3D
                <ArrowUpRight size={15} />
              </button>
            </>
          ) : tab === "stops" ? (
            <>
              <h3>Остановки маршрута</h3>
              <div className="stops-list">
                {route.stops.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      navigate("/overview");
                      ui.selectStop(s.id, route.id);
                    }}
                  >
                    <i />
                    <div>
                      <strong>{s.name}</strong>
                      <small>Остановка {s.sequence}</small>
                    </div>
                    <MapPin size={14} />
                  </button>
                ))}
              </div>
              <p className="muted">
                Прогноз по каждой остановке пока недоступен.
              </p>
            </>
          ) : (
            <>
              <h3>{route.activeVehicleCount} ТС на маршруте</h3>
              {localVehicles.map(renderVehicle)}
            </>
          )}
        </>
      ) : ui.rightPanel === "settings" ? (
        <>
          <div className="settings-section">
            <span className="section-label">ОТОБРАЖЕНИЕ</span>
            <label>
              Тема интерфейса
              <select
                aria-label="Тема интерфейса"
                value={theme}
                onChange={(e) => setTheme(e.target.value as typeof theme)}
              >
                <option value="dark">Тёмная</option>
                <option value="light">Светлая</option>
              </select>
            </label>
            <label>
              <Layers size={15} />
              Маршруты на карте
              <input
                type="checkbox"
                checked={ui.routesVisible}
                onChange={(e) => ui.set({ routesVisible: e.target.checked })}
              />
            </label>
            <label>
              <BusFront size={15} />
              Транспорт на карте
              <input
                type="checkbox"
                checked={ui.vehiclesVisible}
                onChange={(e) => ui.set({ vehiclesVisible: e.target.checked })}
              />
            </label>
          </div>
          <div className="settings-section">
            <span className="section-label">ДАННЫЕ</span>
            <p>
              <Radio size={15} />
              {config.dataSource === "mock"
                ? "Демонстрационный поток"
                : "Поток транспортной сети"}
            </p>
            <p className="muted">
              {config.dataSource === "mock"
                ? "Маршруты и остановки — OpenStreetMap. Положение транспорта и прогнозы — демонстрационные."
                : "Данные поступают из подключённого сервиса."}
            </p>
            <p className="muted">Карта используется только для визуализации.</p>
          </div>
          {config.debug && (
            <>
              <button
                className="primary-button"
                onClick={() =>
                  void DebugPanel().then((m) => setDebug(() => m.default))
                }
              >
                Открыть сценарии демонстрации
              </button>
              {Debug && <Debug />}
            </>
          )}
        </>
      ) : (
        <>
          <input
            className="list-search"
            aria-label="Поиск в списке"
            placeholder="Найти в списке…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="entity-list">
            {ui.rightPanel === "routes"
              ? routes
                  .filter((r) => matchesSearch(`${r.number} ${r.name}`, q))
                  .map((r) => (
                    <button
                      className="entity-row"
                      key={r.id}
                      onClick={() => ui.selectRoute(r.id)}
                    >
                      <RouteBadge number={r.number} risk={r.riskLevel} />
                      <div>
                        <strong>Маршрут {r.number}</strong>
                        <small>{r.name}</small>
                      </div>
                      <span style={{ color: riskInk[r.riskLevel] }}>
                        {minutes(r.predictedDelaySec)}
                      </span>
                      <ChevronRight size={13} />
                    </button>
                  ))
              : ui.rightPanel === "vehicles"
                ? localVehicles.slice(0, 100).map(renderVehicle)
                : routes.flatMap((r) =>
                    r.stops
                      .filter((s) => matchesSearch(s.name, q))
                      .map((s) => (
                        <button
                          key={s.id}
                          className="entity-row"
                          onClick={() => {
                            navigate("/overview");
                            ui.selectStop(s.id, r.id);
                          }}
                        >
                          <MapPin size={16} />
                          <div>
                            <strong>{s.name}</strong>
                            <small>Маршрут {r.number}</small>
                          </div>
                          <ChevronRight size={14} />
                        </button>
                      )),
                  )}
          </div>
          {ui.rightPanel === "vehicles" && localVehicles.length > 100 && (
            <p className="muted">
              Показано 100 из {localVehicles.length}. Уточните поиск.
            </p>
          )}
          {query &&
            ((ui.rightPanel === "routes" &&
              !routes.some((r) => matchesSearch(`${r.number} ${r.name}`, q))) ||
              (ui.rightPanel === "vehicles" && !localVehicles.length) ||
              (ui.rightPanel === "stops" &&
                !routes.some((r) =>
                  r.stops.some((s) => matchesSearch(s.name, q)),
                ))) && <Empty title="Ничего не найдено" />}
        </>
      )}
    </Panel>
  );
}
