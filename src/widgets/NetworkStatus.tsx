import { config } from "../shared/config/env";
import { useMemo } from "react";
import {
  ArrowUpRight,
  BusFront,
  Route as RouteIcon,
  ChevronRight,
} from "lucide-react";
import type { Summary, Route, DelayPoint } from "../entities/models";
import { Panel, RouteBadge } from "../shared/ui/primitives";
import { Chart } from "../shared/ui/Chart";
import { riskHex, riskInk, minutes, time } from "../shared/ui/format";
import { useUi } from "../app/store";
export function DelayChart({
  points,
  height = 164,
}: {
  points: DelayPoint[];
  height?: number;
}) {
  const option = useMemo(
    () => ({
      grid: { left: 34, right: 12, top: 18, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#d9ddd2",
        textStyle: { color: "#30382c" },
        valueFormatter: (v: number) => `${Number(v).toFixed(1)} мин`,
      },
      xAxis: {
        type: "time",
        ...(config.officialMode && points.length
          ? {
              min: Date.parse(points[0].timestamp) - 30000,
              max: Date.parse(points.at(-1)!.timestamp) + 30000,
            }
          : {}),
        splitNumber: 3,
        axisLine: { lineStyle: { color: "#d9ddd2" } },
        axisTick: { show: false },
        axisLabel: {
          formatter: (value: number) => time(new Date(value).toISOString()),
          hideOverlap: true,
          color: "#818875",
        },
      },
      yAxis: {
        type: "value",
        splitNumber: 3,
        axisLabel: { formatter: "{value} м", color: "#818875" },
        splitLine: { lineStyle: { color: "#e6e9e0" } },
      },
      series: [
        {
          name: "Факт",
          type: "line",
          data: points.map((p) => [
            Date.parse(p.timestamp),
            p.actualDelaySec === null ? null : p.actualDelaySec / 60,
          ]),
          showSymbol: config.officialMode,
          smooth: 0.25,
          lineStyle: { color: "#36a8e9", width: 2 },
          areaStyle: { color: "#36a8e9", opacity: 0.08 },
        },
        {
          name: "Прогноз",
          type: "line",
          data: points.map((p) => [
            Date.parse(p.timestamp),
            p.predictedDelaySec === null ? null : p.predictedDelaySec / 60,
          ]),
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { color: "#e8b449", type: "dashed", width: 2 },
        },
      ],
    }),
    [points],
  );
  return (
    <Chart
      option={option}
      height={height}
      label="Динамика средней задержки: факт сплошной линией, прогноз пунктиром"
    />
  );
}
export function NetworkStatus({
  summary,
  routes,
  points,
  onShowRoutes,
}: {
  summary: Summary;
  routes: Route[];
  points: DelayPoint[];
  onShowRoutes: () => void;
}) {
  const selectRoute = useUi((s) => s.selectRoute);
  const top = routes
    .filter((r) => r.riskLevel !== "normal")
    .sort((a, b) => b.predictedDelaySec - a.predictedDelaySec)
    .slice(0, 5);
  return (
    <aside className="left-column">
      <Panel
        title="Состояние сети"
        action={
          <span className="live-small">
            <i />
            LIVE
          </span>
        }
      >
        <div className="rings">
          {[
            [summary.onTimePercent, "По графику", "#21ba96"],
            [summary.atRiskPercent, "С риском", "#e8b449"],
            [summary.delayedPercent, "С задержкой", "#f06479"],
          ].map(([value, label, color]) => (
            <div className="ring-group" key={label}>
              <svg viewBox="0 0 80 80" className="ring">
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="var(--surface-3)"
                  strokeWidth="4"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke={String(color)}
                  strokeWidth="4"
                  strokeDasharray={`${Number(value) * 2.01} 201`}
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                />
              </svg>
              <strong>{Math.round(Number(value))}%</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="network-totals">
          <div>
            <span>
              <BusFront size={14} />
              Транспорт на линии
            </span>
            <strong>
              {summary.vehiclesActive}
              <small> / {summary.vehiclesTotal}</small>
            </strong>
          </div>
          <div>
            <span>
              <RouteIcon size={14} />
              Маршруты
            </span>
            <strong>
              {summary.routesActive}
              <small> активны</small>
            </strong>
          </div>
        </div>
        <div className="card-foot">
          <span className="status-dot" />
          Состояние транспортной сети
        </div>
      </Panel>
      <Panel
        title="Динамика задержек"
        action={
          <span className="muted small">
            {config.officialMode ? "По потоку" : "2 часа"}
          </span>
        }
      >
        <div className="chart-key">
          <span>
            <i className="blue" />
            Факт
          </span>
          {!config.officialMode && (
            <span>
              <i className="dashed" />
              Прогноз +15 мин
            </span>
          )}
        </div>
        <DelayChart points={points} height={95} />
        <div className="trend-footer">
          <span>Средняя задержка</span>
          <strong>
            {minutes(summary.averageDelaySec)} <small>мин</small>
          </strong>
        </div>
      </Panel>
      <Panel
        title="Требуют внимания"
        action={
          <span className="count">
            {routes.filter((r) => r.riskLevel !== "normal").length}
          </span>
        }
      >
        <div className="top-route-list">
          {top.map((r) => (
            <button
              key={r.id}
              className="top-route"
              onClick={() => selectRoute(r.id)}
            >
              <RouteBadge number={r.number} risk={r.riskLevel} />
              <div>
                <div className="row-between">
                  <span>Маршрут {r.number}</span>
                  <b style={{ color: riskInk[r.riskLevel] }}>
                    {minutes(r.predictedDelaySec)} <small>мин</small>
                  </b>
                </div>
                <div className="bar-track">
                  <i
                    style={{
                      width: `${Math.min(100, r.predictedDelaySec / 6)}%`,
                      background: riskHex[r.riskLevel],
                    }}
                  />
                </div>
              </div>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        <button className="panel-link" onClick={onShowRoutes}>
          Все маршруты <ArrowUpRight size={15} />
        </button>
      </Panel>
    </aside>
  );
}
