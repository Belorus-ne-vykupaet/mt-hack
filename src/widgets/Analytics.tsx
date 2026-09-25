import { useMemo } from "react";
import {
  BusFront,
  Route as RouteIcon,
  Clock3,
  Timer,
  CheckCircle2,
  ArrowUpRight,
} from "lucide-react";
import type { Summary, Route, DelayPoint } from "../entities/models";
import { Panel, RouteBadge, Boundary } from "../shared/ui/primitives";
import { Chart } from "../shared/ui/Chart";
import { DelayChart } from "./NetworkStatus";
import {
  riskHex,
  riskInk,
  riskLabels,
  minutes,
  time,
} from "../shared/ui/format";
import { config } from "../shared/config/env";
import { useUi } from "../app/store";
export default function Analytics({
  summary,
  routes,
  points,
}: {
  summary: Summary;
  routes: Route[];
  points: DelayPoint[];
}) {
  const kpis = [
    {
      label: "Пунктуальность",
      value: `${Math.round(summary.onTimePercent)}%`,
      sub: "Транспорт по графику",
      icon: CheckCircle2,
      color: "#257b54",
    },
    {
      label: "Средняя задержка",
      value: minutes(summary.averageDelaySec),
      unit: "мин",
      sub: "Текущее состояние",
      icon: Clock3,
      color: "#20231e",
    },
    {
      label: "Прогноз задержки",
      value: minutes(summary.averagePredictedDelaySec),
      unit: "мин",
      sub: config.officialMode
        ? "К остановке через 10–15 минут"
        : "Через 15 минут",
      icon: Timer,
      color: "#a88219",
    },
    {
      label: "Транспорт на линии",
      value: summary.vehiclesActive,
      sub: `Из ${summary.vehiclesTotal} транспортных средств`,
      icon: BusFront,
      color: "#547236",
    },
    {
      label: config.officialMode ? "Планы ТС в прогнозе" : "Активные маршруты",
      value: summary.routesActive,
      sub: "В транспортной сети",
      icon: RouteIcon,
      color: "#20231e",
    },
  ];
  const distribution = (
    ["normal", "elevated", "high", "critical"] as const
  ).map((level) => ({
    name: riskLabels[level],
    value: routes.filter((r) => r.riskLevel === level).length,
    itemStyle: { color: riskHex[level] },
  }));
  const histogram = useMemo(
    () => ({
      grid: { left: 42, right: 15, top: 18, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#d9ddd2",
        textStyle: { color: "#30382c" },
      },
      xAxis: {
        type: "category",
        data: points
          .filter((p) => p.actualDelaySec !== null)
          .map((p) => time(p.timestamp)),
        axisLabel: { interval: 4, color: "#818875" },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#d9ddd2" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: "{value} м", color: "#818875" },
        splitNumber: 4,
        splitLine: { lineStyle: { color: "#e6e9e0" } },
      },
      series: [
        {
          type: "bar",
          name: "Средняя задержка, мин",
          barWidth: "60%",
          data: points
            .filter((p) => p.actualDelaySec !== null)
            .map((p) => ({
              value: Number(((p.actualDelaySec || 0) / 60).toFixed(2)),
              itemStyle: {
                color: (p.actualDelaySec || 0) > 120 ? "#c76816" : "#547236",
                borderRadius: [2, 2, 0, 0],
              },
            })),
        },
      ],
    }),
    [points],
  );
  const donut = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#ffffff",
      borderColor: "#d9ddd2",
      textStyle: { color: "#30382c" },
    },
    series: [
      {
        type: "pie",
        radius: ["64%", "80%"],
        center: ["50%", "50%"],
        label: { show: false },
        borderWidth: 0,
        data: distribution,
      },
    ],
    graphic: [
      {
        type: "text",
        left: "center",
        top: "40%",
        style: {
          text: String(routes.length),
          fill: "#20231e",
          fontSize: 32,
          fontWeight: 600,
          fontFamily: "IBM Plex Sans Condensed, IBM Plex Sans, sans-serif",
        },
      },
      {
        type: "text",
        left: "center",
        top: "58%",
        style: {
          text: "маршрутов",
          fill: "#818875",
          fontSize: 12,
          fontFamily: "IBM Plex Sans, sans-serif",
        },
      },
    ],
  };
  return (
    <div className="analytics">
      <div className="kpi-grid">
        {kpis.map(({ label, value, unit, sub, icon: Icon, color }) => (
          <section key={label} className="panel kpi-card">
            <div>
              <span>{label}</span>
              <Icon size={16} />
            </div>
            <strong style={{ color }}>
              {value} <small>{unit}</small>
            </strong>
            <p>{sub}</p>
          </section>
        ))}
      </div>
      <div className="analytics-grid">
        <Panel
          title="Задержки по времени"
          action={
            <span className="muted">
              {config.officialMode
                ? "С начала воспроизведения"
                : "Последние 2 часа"}
            </span>
          }
        >
          <Boundary name="Диаграмма">
            <Chart
              option={histogram}
              label="Гистограмма средней задержки по времени"
              height={220}
            />
          </Boundary>
        </Panel>
        <Panel title="Распределение риска">
          <div className="distribution">
            <Chart
              option={donut}
              label="Распределение маршрутов по уровню риска"
              height={220}
            />
            <div>
              {distribution.map((d) => (
                <div className="distribution-row" key={d.name}>
                  <i style={{ background: d.itemStyle.color }} />
                  <span>{d.name}</span>
                  <strong>{d.value}</strong>
                  <small>
                    {Math.round((d.value / Math.max(1, routes.length)) * 100)}%
                  </small>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel
          title="Факт и прогноз"
          action={
            <div className="chart-key">
              <span>
                <i />
                Факт
              </span>
              <span>
                <i className="dashed" />
                Прогноз
              </span>
            </div>
          }
        >
          <DelayChart points={points} height={250} />
        </Panel>
        <Panel
          title="Маршруты с наибольшей задержкой"
          action={<span className="muted">Прогноз +15 мин</span>}
        >
          <div className="analytics-ranking">
            {[...routes]
              .sort((a, b) => b.predictedDelaySec - a.predictedDelaySec)
              .slice(0, 6)
              .map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => useUi.getState().selectRoute(r.id)}
                >
                  <span>{i + 1}</span>
                  <RouteBadge number={r.number} risk={r.riskLevel} />
                  <div>
                    <span>{r.name}</span>
                    <div className="bar-track">
                      <i
                        style={{
                          width: `${Math.min(100, r.predictedDelaySec / 6)}%`,
                          background: riskHex[r.riskLevel],
                        }}
                      />
                    </div>
                  </div>
                  <strong style={{ color: riskInk[r.riskLevel] }}>
                    {minutes(r.predictedDelaySec)}
                    <small> мин</small>
                  </strong>
                  <ArrowUpRight size={14} />
                </button>
              ))}
          </div>
        </Panel>
      </div>
      <p className="analytics-note">
        {config.dataSource === "mock"
          ? "Факт и прогноз — демонстрационные. "
          : ""}
        Показатели и временные ряды отражают всю сеть. Распределение риска и
        рейтинг учитывают выбранные фильтры.
      </p>
    </div>
  );
}
