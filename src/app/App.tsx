import { matchesSearch } from "../shared/lib/search";
import { Dialog } from "../shared/ui/Dialog";
import { RouteFilter } from "../widgets/RouteFilter";
import { RiskHelp } from "../widgets/RiskHelp";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Search,
  Radio,
  Route as RouteIcon,
  BusFront,
  MapPin,
  Bell,
  Settings,
  SlidersHorizontal,
  X,
  ArrowUpRight,
  Clock3,
  Sun,
  Moon,
  Orbit,
  FileText,
} from "lucide-react";
import { useNetwork, useGeometries, queryClient } from "../entities/queries";
import { useUi } from "./store";
import { config } from "../shared/config/env";
import { activeModel, modelDisplayName, modelHeaderLabel, useOfficialModelStatus } from "../entities/official-model-status";

import { AlertsPanel } from "../widgets/AlertsPanel";
import { Timeline } from "../widgets/Timeline";
import { Boundary, Empty, RouteBadge } from "../shared/ui/primitives";
import { AsciiPulse } from "../shared/ui/AsciiPulse";
import { DetailsPanel } from "../widgets/DetailsPanel";
import "../styles/app.css";
import { useDispatch } from "./dispatch-store";
import "../styles/dispatch.css";
import "../styles/design.css";
import { useTheme } from "./theme";
import { ResizableWorkspace } from "../widgets/ResizableWorkspace";
import { NetworkList } from "../widgets/NetworkList";
import type { NetworkListKind } from "../widgets/NetworkList";
import { NetworkStatus } from "../widgets/NetworkStatus";
import { HeaderStatus } from "../widgets/HeaderStatus";
import { InstallApp } from "../widgets/InstallApp";
import { AndroidDownload } from "../widgets/AndroidDownload";
import { installWebMcp } from "./webmcp";
const Integrations = lazy(() => import("../widgets/Integrations"));
const DispatchCenter = lazy(() => import("../widgets/DispatchCenter"));
const ReportsPage = lazy(() => import("../widgets/ReportsPage"));
const Analytics = lazy(() => import("../widgets/Analytics"));
const EMPTY_ROUTES: import("../entities/models").Route[] = [];
const EMPTY_VEHICLES: import("../entities/models").Vehicle[] = [];
const NetworkMap = lazy(() => import("../widgets/NetworkMap"));
export default function App() {
  useEffect(installWebMcp, []);
  const { theme, setTheme } = useTheme();
  const [listView, setListView] = useState<NetworkListKind | null>(null);
  const net = useNetwork();
  const officialModel = useOfficialModelStatus();
  const ui = useUi();
  const dispatchPlans = useDispatch((s) => s.plans);
  const activePlanCount = dispatchPlans.filter(
    (p) => p.status === "active",
  ).length;
  const location = useLocation();
  const navigate = useNavigate();
  const mode =
    location.pathname === "/integrations"
      ? "integrations"
      : location.pathname === "/dispatch"
        ? "dispatch"
        : location.pathname === "/reports"
          ? "reports"
        : location.pathname === "/analytics"
          ? "analytics"
          : "overview";
  useEffect(() => {
    if (location.pathname === "/flow") {
      useUi.getState().set({ mapMode: "flow" });
      navigate(`/overview${location.search}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);
  const routes = net.routes.data || EMPTY_ROUTES;
  const vehicles = net.vehicles.data || EMPTY_VEHICLES;
  const alerts = net.alerts.data || [];
  const summary = net.summary.data;
  const points = net.series.data || [];
  const geometry = useGeometries(routes.map((r) => r.id));
  const visibleRoutes = useMemo(
    () =>
      routes.filter(
        (r) =>
          (!ui.routeFilters.length || ui.routeFilters.includes(r.id)) &&
          (ui.riskFilter === "all" || r.riskLevel === ui.riskFilter),
      ),
    [routes, ui.routeFilters, ui.riskFilter],
  );
  const visibleIds = useMemo(
    () => new Set(visibleRoutes.map((r) => r.id)),
    [visibleRoutes],
  );
  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => visibleIds.has(v.routeId)),
    [vehicles, visibleIds],
  );
  const visibleRouteIdsKey = visibleRoutes.map((route) => route.id).join("|");
  const geometryTimestamp = summary?.timestamp;
  const visibleGeo = useMemo(
    () => {
      const ids = new Set(visibleRouteIdsKey.split("|"));
      const asOf = geometryTimestamp ? Date.parse(geometryTimestamp) : null;
      return (geometry.data || []).filter(
        (g) => ids.has(g.routeId) &&
          (asOf === null || !g.validFrom ||
            (Date.parse(g.validFrom) <= asOf && asOf <= Date.parse(g.validUntil || g.validFrom))),
      );
    },
    [geometry.data, visibleRouteIdsKey, geometryTimestamp],
  );
  const visibleSegments = useMemo(
    () => (net.segments.data || []).filter((segment) => visibleIds.has(segment.routeId)),
    [net.segments.data, visibleIds],
  );

  const search = ui.search.trim().toLowerCase();
  const searchRoutes = routes
    .filter((r) => matchesSearch(`Маршрут ${r.number} ${r.name}`, search))
    .slice(0, 4);
  const searchVehicles = vehicles
    .filter((v) =>
      matchesSearch(`${v.id} тс ${v.id.replace("vehicle-", "")}`, search),
    )
    .slice(0, 3);
  const searchStops = routes
    .flatMap((r) => r.stops.map((s) => ({ ...s, routeId: r.id })))
    .filter((s) => matchesSearch(s.name, search))
    .slice(0, 3);
  const navItems = [
    { icon: RouteIcon, label: "Маршруты", panel: "routes", path: undefined },
    { icon: BusFront, label: "Транспорт", panel: "vehicles", path: undefined },
    { icon: MapPin, label: "Остановки", panel: "stops", path: undefined },
    { icon: Bell, label: "События", panel: "events", path: undefined },
  ] as const;
  return (
    <div className={`app app-${mode}`}>
      <header className="header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <span className="brand-symbol">
            <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <path
                d="M7 30V14h12V7h14v14H21v12H7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinejoin="miter"
              />
              <circle cx="7" cy="14" r="3.5" fill="currentColor" />
              <circle cx="19" cy="7" r="3.5" fill="currentColor" />
              <circle cx="33" cy="21" r="3.5" fill="currentColor" />
              <circle cx="21" cy="33" r="3.5" fill="currentColor" />
            </svg>
          </span>
          <div>
            <strong>
              TRANSIT<span> / HUB</span>
            </strong>
            <small>ДИСПЕТЧЕРСКАЯ СЕТИ · МОСКВА</small>
          </div>
        </a>
        <nav className="mode-switch" aria-label="Режим отображения">
          <NavLink to="/overview">
            <Activity size={17} />
            <span>Обзор сети</span>
          </NavLink>
          <NavLink to="/analytics">
            <BarChart3 size={17} />
            <span>Аналитика</span>
          </NavLink>
          <NavLink to="/dispatch">
            <SlidersHorizontal size={17} />
            <span>Диспетчер</span>
          </NavLink>
          <NavLink to="/reports">
            <FileText size={17} />
            <span>Отчёты</span>
          </NavLink>
          <NavLink to="/integrations">
            <Orbit size={17} />
            <span>Интеграции</span>
          </NavLink>
        </nav>
        <div className="header-status">
          <span className="demo-badge">
            {config.officialMode
              ? modelHeaderLabel(officialModel.data, officialModel.isError)
              : config.csvMode
                ? "CSV · АРХИВ"
                : config.dataSource === "mock"
                  ? "ДЕМО"
                  : "API"}
          </span>
          <button
            className="theme-toggle"
            aria-label={
              theme === "dark"
                ? "Включить светлую тему"
                : "Включить тёмную тему"
            }
            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
          </button>
          <AndroidDownload />
          <InstallApp />
          <HeaderStatus />
        </div>
      </header>
      <div className="body-shell">
        <nav className="sidebar" aria-label="Навигация">
          {navItems.map(({ icon: Icon, label, panel }) => (
            <button
              title={label}
              key={label}
              className={listView === panel ? "selected" : ""}
              onClick={() => {
                setListView(panel);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "События" &&
                alerts.some((a) => a.severity === "critical") && (
                  <i className="notification-dot" />
                )}
            </button>
          ))}
          <div className="sidebar-bottom">
            <NavLink to="/welcome" title="О проекте" aria-label="О проекте">
              <Orbit size={19} />
              <span>О проекте</span>
            </NavLink>
            <button
              title="Настройки"
              className={ui.rightPanel === "settings" ? "selected" : ""}
              onClick={() => {
                ui.set({ rightPanel: "settings" });
              }}
            >
              <Settings size={19} />
              <span>Настройки</span>
            </button>
            <span className="avatar" title="Рабочее место диспетчера">
              Д
            </span>
          </div>
        </nav>
        <main className="main">
          <div className="workspace-heading">
            <AsciiPulse />
            <div>
              <div className="breadcrumb">
                МОСКВА <span>/</span> ТРАНСПОРТНАЯ СЕТЬ
              </div>
              <h1>
                <span className="heading-index" aria-hidden="true">
                  {mode === "overview"
                    ? "01"
                    : mode === "analytics"
                      ? "02"
                      : mode === "integrations"
                        ? "04"
                        : mode === "reports"
                          ? "05"
                        : "03"}
                </span>
                {mode === "overview"
                  ? "Обзор транспортной сети"
                  : mode === "analytics"
                    ? "Аналитика движения"
                    : mode === "integrations"
                      ? "Интеграции и API"
                      : mode === "reports"
                        ? "Отчёты по дням"
                      : "Диспетчерская"}
              </h1>
              <p
                className="page-description"
                style={
                  mode === "dispatch" || mode === "integrations" || mode === "reports"
                    ? { display: "none" }
                    : undefined
                }
              >
                {mode === "overview"
                  ? config.officialMode
                    ? "Официальная телеметрия, планы ТС и прогноз задержки к остановке."
                    : "Маршруты, транспорт и задержки на карте в текущем времени."
                  : mode === "analytics"
                    ? config.officialMode
                      ? "Наблюдаемые задержки и прогноз к остановкам по официальным данным."
                      : "Динамика задержек и риск по маршрутам за последние два часа."
                    : "Планируйте выпуск и стоянки до появления задержек."}
              </p>
            </div>
            <div
              className="search-container"
              style={
                mode === "dispatch" || mode === "integrations" || mode === "reports"
                  ? { display: "none" }
                  : undefined
              }
            >
              <Search size={16} />
              <input
                aria-label="Поиск маршрута, ТС или остановки"
                placeholder="Маршрут, транспорт, остановка…"
                value={ui.search}
                onChange={(e) => ui.set({ search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") ui.set({ search: "" });
                  if (e.key === "Enter" && searchRoutes[0]) {
                    ui.selectRoute(searchRoutes[0].id);
                    navigate("/overview");
                  }
                }}
              />
              <kbd>↵</kbd>
              {search && (
                <div className="search-results">
                  {!!searchRoutes.length && <small>МАРШРУТЫ</small>}
                  {searchRoutes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        ui.selectRoute(r.id);
                        navigate("/overview");
                      }}
                    >
                      <RouteBadge number={r.number} risk={r.riskLevel} />
                      {r.name}
                    </button>
                  ))}
                  {!!searchVehicles.length && <small>ТРАНСПОРТ</small>}
                  {searchVehicles.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        ui.selectVehicle(v.id, v.routeId);
                        navigate("/overview");
                      }}
                    >
                      <BusFront size={16} />
                      ТС {v.id.replace("vehicle-", "")} · Маршрут {v.routeId}
                    </button>
                  ))}
                  {!!searchStops.length && <small>ОСТАНОВКИ</small>}
                  {searchStops.map((s) => (
                    <button
                      key={`${s.routeId}-${s.id}`}
                      onClick={() => {
                        ui.selectStop(s.id, s.routeId);
                        navigate("/overview");
                      }}
                    >
                      <MapPin size={16} />
                      {s.name} · {s.routeId}
                    </button>
                  ))}
                  {!searchRoutes.length &&
                    !searchVehicles.length &&
                    !searchStops.length && <Empty title="Ничего не найдено" />}
                </div>
              )}
            </div>
          </div>
          {summary && mode === "overview" && (
            <div className="summary-strip">
              <div>
                <strong>{summary.vehiclesLocated ?? summary.vehiclesActive}</strong>
                <span>{config.officialMode ? <>GPS-позиций на карте<br /><small>{summary.vehiclesActive} свежих · {summary.vehiclesStale ?? 0} последних известных</small></> : "транспорт на линии"}</span>
                <button
                  aria-label="Посмотреть транспорт на линии"
                  onClick={() => setListView("vehicles")}
                >
                  Посмотреть
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div>
                <strong>{summary.vehiclesPredicted ?? summary.routesActive}</strong>
                <span>
                  {config.officialMode
                    ? "автобусов с прогнозом"
                    : "активных маршрутов"}
                </span>
                <button
                  aria-label="Посмотреть активные маршруты"
                  onClick={() => setListView(config.officialMode ? "forecasts" : "routes")}
                >
                  Посмотреть
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div>
                <strong>
                  {Math.round(summary.onTimePercent)}
                  <small>%</small>
                </strong>
                <span>по расписанию{config.officialMode && <><br /><small>среди {summary.vehiclesAssessed ?? 0} оценённых ТС</small></>}</span>
                <button
                  aria-label="Посмотреть транспорт по расписанию"
                  onClick={() => setListView("on-time")}
                >
                  Посмотреть
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="summary-risk">
                <span className="summary-risk-dot" />
                <span>
                  <strong>
                    {
                      alerts.filter(
                        (a) =>
                          config.officialMode ||
                          a.severity === "critical" ||
                          a.severity === "high",
                      ).length
                    }
                  </strong>{" "}
                  события требуют внимания
                </span>
                <button
                  aria-label="Посмотреть события, требующие внимания"
                  onClick={() => setListView("alerts")}
                >
                  Посмотреть
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          )}
          <div
            className="filter-bar"
            style={
              mode === "dispatch" || mode === "integrations" || mode === "reports"
                ? { display: "none" }
                : undefined
            }
          >
            <div className="filter-controls">
              <SlidersHorizontal size={15} />
              <RouteFilter routes={routes} />
              <span className="filter-divider" />
              <select
                aria-label="Фильтр по уровню риска"
                value={ui.riskFilter}
                onChange={(e) =>
                  ui.set({ riskFilter: e.target.value as typeof ui.riskFilter })
                }
              >
                <option value="all">Любой риск</option>
                <option value="normal">Норма</option>
                {config.officialMode && <option value="unknown">Нет прогноза</option>}
                <option value="elevated">Внимание</option>
                <option value="high">Высокий риск</option>
                <option value="critical">Критический риск</option>
              </select>
              {(ui.routeFilters.length > 0 || ui.riskFilter !== "all") && (
                <button
                  className="text-button"
                  onClick={() =>
                    ui.set({ routeFilters: [], riskFilter: "all" })
                  }
                >
                  <X size={14} />
                  Сбросить
                </button>
              )}
            </div>
            <RiskHelp />
            <span className="demo-caption">
              <span className="status-dot" />
              {config.officialMode
                ? `Официальные данные · ${activeModel(officialModel.data, officialModel.isError)
                  ? modelDisplayName(officialModel.data)
                  : modelHeaderLabel(officialModel.data, officialModel.isError).toLocaleLowerCase("ru-RU")}`
                : config.csvMode
                  ? "Воспроизведение CSV"
                  : config.dataSource === "mock"
                    ? "Демонстрационный поток"
                    : "Телематика NDTP"}{" "}
              ·{" "}
              {config.csvMode
                ? "базовый прогноз"
                : "обновление в реальном времени"}
            </span>
          </div>
          {!!activePlanCount &&
            !config.csvMode &&
            config.dataSource === "mock" && (
              <div className="dispatch-active-banner">
                <span>
                  Демо-сценарии управления: {activePlanCount} · выпуск и прогноз
                  изменены
                </span>
                <NavLink to="/dispatch">Открыть журнал и отменить</NavLink>
              </div>
            )}
          {mode === "integrations" ? (
            <Boundary name="Интеграции">
              <Suspense
                fallback={<div className="loading-workspace">Подключения…</div>}
              >
                <Integrations routes={routes} />
              </Suspense>
            </Boundary>
          ) : mode === "reports" ? (
            <Boundary name="Отчёты">
              <Suspense fallback={<div className="loading-workspace">Загрузка отчётов…</div>}>
                <ReportsPage />
              </Suspense>
            </Boundary>
          ) : !summary ? (
            <div className="loading-workspace">
              {net.summary.isError ? (
                <>
                  <Empty
                    title="Данные сети недоступны"
                    description="Проверьте подключение и повторите загрузку"
                  />
                  <button onClick={() => queryClient.invalidateQueries()}>
                    Повторить загрузку
                  </button>
                </>
              ) : (
                <>
                  <div className="skeleton" />
                  <span>Загружаем транспортную сеть…</span>
                </>
              )}
            </div>
          ) : mode === "dispatch" ? (
            <Boundary name="Диспетчер">
              <Suspense
                fallback={
                  <div className="loading-workspace">
                    Подготовка управления…
                  </div>
                }
              >
                <DispatchCenter
                  routes={routes}
                  vehicles={vehicles}
                  asOf={summary?.timestamp}
                  geometries={geometry.data}
                />
              </Suspense>
            </Boundary>
          ) : (
            <ResizableWorkspace mode={mode}>
              {mode === "overview" && (
                <NetworkStatus
                  summary={summary}
                  routes={visibleRoutes}
                  points={points}
                  onShowRoutes={() => setListView("routes")}
                />
              )}
              {mode !== "analytics" && (
                <div className="network-view">
                  <div className="center-column">
                    <Boundary name="Карта">
                      <Suspense
                        fallback={
                          <div className="loading-workspace">
                            Подготовка карты…
                          </div>
                        }
                      >
                        <NetworkMap
                          mode={ui.mapMode}
                          routes={visibleRoutes}
                          vehicles={visibleVehicles}
                          geometries={visibleGeo}
                          segments={visibleSegments}
                        />
                      </Suspense>
                    </Boundary>
                    <div className="map-strip">
                      <span>
                        <Radio size={14} />
                        {config.officialMode ? `${visibleVehicles.length} GPS-позиций на карте` : `${visibleRoutes.length} маршрутов в зоне обзора`}
                      </span>
                      <span>
                        <Clock3 size={13} />
                        Горизонт до 15 минут
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {mode === "analytics" && (
                <Boundary name="Аналитика">
                  <Suspense
                    fallback={
                      <div className="loading-workspace">
                        Загрузка аналитики…
                      </div>
                    }
                  >
                    <Analytics
                      summary={summary}
                      routes={visibleRoutes}
                      points={points}
                    />
                  </Suspense>
                </Boundary>
              )}
              <aside className="right-column">
                {ui.rightPanel === "alerts" || ui.rightPanel === "settings" ? (
                  <AlertsPanel
                    alerts={alerts.filter((a) => visibleIds.has(a.routeId))}
                  />
                ) : (
                  <DetailsPanel
                    key={`${ui.rightPanel}-${ui.selectedRouteId}-${ui.selectedVehicleId}`}
                    forecastControl={mode === "analytics"}
                    routes={routes}
                    vehicles={vehicles}
                    segments={net.segments.data || []}
                  />
                )}
              </aside>
            </ResizableWorkspace>
          )}
          {config.csvMode && (
            <div className="csv-source-note">
              Архив CSV · время данных:{" "}
              {summary
                ? new Date(summary.timestamp).toLocaleString("ru-RU", {
                    timeZone: "Europe/Moscow",
                  })
                : "…"}{" "}
              МСК · базовый прогноз сохраняет текущую задержку. После конца
              архива воспроизведение останавливается.
            </div>
          )}
          {mode === "overview" && <Timeline />}
          <div className="workspace-footer">
            <span>
              TRANSIT HUB <i />
              Рабочее место диспетчера
            </span>
            <span>
              {config.dataSource === "mock" ? "Демонстрационные данные · " : ""}
              Москва · 2026
            </span>
          </div>
        </main>
      </div>
      {ui.rightPanel === "settings" && (
        <Dialog label="Настройки" onClose={ui.clear}>
          <DetailsPanel
            routes={routes}
            vehicles={vehicles}
            segments={net.segments.data || []}
          />
        </Dialog>
      )}
      {listView && (
        <NetworkList
          kind={listView}
          routes={routes}
          vehicles={vehicles}
          alerts={alerts}
          onClose={() => setListView(null)}
        />
      )}
    </div>
  );
}
