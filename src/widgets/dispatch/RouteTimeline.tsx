import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";
import { Chart } from "../../shared/ui/Chart";
import { riskHex } from "../../shared/ui/format";
import type { RouteLine } from "../../entities/route-line";
import { operatingSpeed } from "../../entities/route-line";
import type { DispatchDecision } from "../../entities/dispatch-decisions";
import { busLabel } from "../../entities/dispatch-decisions";
import type { DispatchSettings } from "../../entities/dispatch-settings";
import { trailOf } from "../../entities/vehicle-trail";

const BEFORE_MS = 10 * 60000,
  AFTER_MS = 15 * 60000,
  STEP_MS = 30000;
const clock = (t: number) =>
  new Date(t).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });

/** Time–distance diagram of one route: observed, forecast, timetable and the chosen action. */
export function RouteTimeline({
  line,
  decision,
  asOf,
  settings,
}: {
  line: RouteLine;
  decision?: DispatchDecision;
  asOf?: string;
  settings: DispatchSettings;
}) {
  const now = Date.parse(asOf || "");
  const km = line.length / 1000;
  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!Number.isFinite(now) || !line.path || !line.buses.length) return null;
    // One timetable speed for the whole route keeps the planned lines parallel, like a real graph.
    const fallback = operatingSpeed(line);
    const focus = new Set(
      decision?.vehicleId
        ? [decision.vehicleId]
        : decision?.kind === "shorten_all"
          ? line.buses
              .filter(
                (b) => b.vehicle.predictedDelaySec >= settings.lateSec,
              )
              .map((b) => b.vehicle.id)
          : [],
    );
    const series: object[] = [];
    const point = (t: number, along: number) => [
      t,
      Math.round(Math.min(line.length, Math.max(0, along))) / 1000,
    ];
    for (const bus of line.buses) {
      const v = bus.vehicle,
        speed = v.speedKmh / 3.6 >= 1 ? v.speedKmh / 3.6 : fallback;
      const color = riskHex[v.riskLevel];
      const focused = focus.has(v.id);
      const growth = Math.max(0, v.predictedDelaySec - v.currentDelaySec);
      // The bus loses time as its delay grows toward the 15-minute forecast.
      const forecastAt = (ms: number) =>
        bus.along + speed * (ms / 1000 - (growth * ms) / AFTER_MS);
      const history = trailOf(v.id)
        .filter((p) => p.t >= now - BEFORE_MS && p.t < now)
        .map((p) => point(p.t, p.along));
      const name = busLabel(v.id);
      series.push({
        name,
        type: "line",
        showSymbol: false,
        data: [...history, point(now, bus.along)],
        lineStyle: { color, width: focused ? 3 : 1.6 },
        itemStyle: { color },
        z: focused ? 5 : 2,
      });
      const forecast = [];
      for (let ms = 0; ms <= AFTER_MS; ms += STEP_MS)
        forecast.push(point(now + ms, forecastAt(ms)));
      series.push({
        name: `${name} · прогноз`,
        type: "line",
        showSymbol: false,
        data: forecast,
        lineStyle: {
          color,
          width: focused ? 2.4 : 1.2,
          type: "dashed",
          opacity: focused || !focus.size ? 1 : 0.55,
        },
        z: focused ? 5 : 2,
      });
      // Where the timetable wants this bus: ahead of it by its current delay.
      series.push({
        name: `${name} · по графику`,
        type: "line",
        showSymbol: false,
        data: [
          point(
            now - BEFORE_MS,
            bus.along + fallback * (v.currentDelaySec - BEFORE_MS / 1000),
          ),
          point(
            now + AFTER_MS,
            bus.along + fallback * (v.currentDelaySec + AFTER_MS / 1000),
          ),
        ],
        lineStyle: {
          color: "#818875",
          width: focused ? 1.6 : 1,
          type: "dotted",
          opacity: focused ? 1 : 0.6,
        },
        z: 1,
      });
      if (!focused) continue;
      const whatIf = [];
      if (decision?.holdSec && decision.stopId) {
        const stop = line.stops.find((s) => s.stop.id === decision.stopId);
        const arrive = decision.deadlineInSec * 1000,
          hold = decision.holdSec * 1000;
        for (let ms = 0; ms <= AFTER_MS; ms += STEP_MS)
          whatIf.push(
            point(
              now + ms,
              ms < arrive
                ? forecastAt(ms)
                : ms < arrive + hold
                  ? stop?.along ?? forecastAt(arrive)
                  : forecastAt(ms - hold),
            ),
          );
      } else if (decision?.dwell && decision.dwell.targetSec < decision.dwell.baseSec) {
        const save = decision.dwell.baseSec - decision.dwell.targetSec;
        const cap = Math.max(0, v.predictedDelaySec);
        for (let ms = 0; ms <= AFTER_MS; ms += STEP_MS) {
          const reached = forecastAt(ms);
          const passed = line.stops.filter(
            (s) => s.along > bus.along && s.along <= reached,
          ).length;
          const saved = Math.min(cap, save * Math.min(passed, decision.dwell.stops));
          whatIf.push(point(now + ms, forecastAt(ms + saved * 1000)));
        }
      }
      if (whatIf.length)
        series.push({
          name: `${name} · с решением`,
          type: "line",
          showSymbol: false,
          data: whatIf,
          lineStyle: { color: "#21ba96", width: 2.6, type: [6, 4] },
          z: 6,
        });
    }
    if (decision?.kind === "add_bus") {
      const enter = settings.deployMin * 60000;
      const data = [];
      for (let ms = enter; ms <= AFTER_MS; ms += STEP_MS)
        data.push(point(now + ms, fallback * ((ms - enter) / 1000)));
      if (data.length)
        series.push({
          name: "Резервный автобус · с решением",
          type: "line",
          showSymbol: false,
          data,
          lineStyle: { color: "#21ba96", width: 2.6, type: [6, 4] },
          z: 6,
        });
    }
    const stop = decision?.stopId
      ? line.stops.find((s) => s.stop.id === decision.stopId)
      : undefined;
    series.push({
      name: "Сейчас",
      type: "line",
      data: [],
      markLine: {
        silent: true,
        symbol: "none",
        label: { formatter: "сейчас", color: "#818875", fontSize: 10 },
        lineStyle: { color: "#20231e", width: 1, type: "solid" },
        data: [
          { xAxis: now },
          ...(stop
            ? [
                {
                  yAxis: stop.along / 1000,
                  label: {
                    formatter: stop.stop.name,
                    position: "insideStartTop",
                    color: "#818875",
                    fontSize: 10,
                  },
                  lineStyle: { color: "#547236", type: "dashed", width: 1 },
                },
              ]
            : []),
        ],
      },
      markArea: {
        silent: true,
        itemStyle: { color: "#e6e9e0", opacity: 0.35 },
        data: [[{ xAxis: now }, { xAxis: now + AFTER_MS }]],
      },
    });
    return {
      animation: false,
      grid: { left: 46, right: 18, top: 16, bottom: 30 },
      tooltip: {
        trigger: "item",
        backgroundColor: "#ffffff",
        borderColor: "#d9ddd2",
        textStyle: { color: "#20231e", fontSize: 11 },
        formatter: (p: { seriesName: string; value: [number, number] }) =>
          `${p.seriesName}<br/>${clock(p.value[0])} · ${p.value[1].toFixed(1)} км`,
      },
      xAxis: {
        type: "time",
        min: now - BEFORE_MS,
        max: now + AFTER_MS,
        splitNumber: 6,
        axisLabel: {
          color: "#818875",
          hideOverlap: true,
          formatter: (t: number) => clock(t),
        },
        axisLine: { lineStyle: { color: "#d9ddd2" } },
        splitLine: { show: true, lineStyle: { color: "#e6e9e0" } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: Math.ceil(km),
        name: "км",
        nameTextStyle: { color: "#818875", fontSize: 10 },
        axisLabel: { color: "#818875" },
        splitLine: { lineStyle: { color: "#e6e9e0" } },
      },
      series,
    };
  }, [line, decision, now, km, settings.lateSec, settings.deployMin]);
  if (!option)
    return (
      <p className="route-timeline-empty">
        Нет геометрии маршрута или свежих положений автобусов: график движения
        построить нельзя.
      </p>
    );
  return (
    <figure
      className="route-timeline"
      data-buses={line.buses.length}
      data-what-if={decision ? decision.kind : "none"}
    >
      <Chart
        option={option}
        height={260}
        label={`График движения маршрута ${line.route.number}: время и путь автобусов, прогноз на 15 минут${decision ? " и вариант с решением" : ""}`}
      />
      <figcaption>
        <span className="legend-line solid">факт с момента открытия</span>
        <span className="legend-line dashed">прогноз 15 мин</span>
        <span className="legend-line dotted">по графику</span>
        {decision && <span className="legend-line action">с решением</span>}
        <span className="legend-note">
          Наклон — скорость, горизонталь — стоянка. Путь — одно направление
          маршрута, {km.toFixed(1)} км.
        </span>
      </figcaption>
    </figure>
  );
}
