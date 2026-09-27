import { incidentTiming } from "../entities/incident";
import { config } from "../shared/config/env";
import { useState, useEffect } from "react";
import { TriangleAlert, ChevronRight, MapPin, CheckCheck } from "lucide-react";
import type { Alert, Segment } from "../entities/models";
import { Panel, Empty } from "../shared/ui/primitives";
import { minutes, percent, time } from "../shared/ui/format";
import { useUi } from "../app/store";
import { modelDisplayName, useOfficialModelStatus } from "../entities/official-model-status";
export function AlertsPanel({ alerts, segments = [] }: { alerts: Alert[]; segments?: Segment[] }) {
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => Date.now());
  const model = useOfficialModelStatus();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const sorted = [...alerts].sort(
    (a, b) => b.riskProbability - a.riskProbability,
  );
  const shown = sorted.filter((a) => filter === "all" || a.severity === filter);
  const currentSegments = new Map(segments.filter((s) => s.isCurrent).map((s) => [s.routeId, s.name]));
  return (
    <Panel
      title="Центр событий"
      className="alerts-panel"
      action={<span className="count">{alerts.length}</span>}
    >
      <div className="alert-tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Все <span>{alerts.length}</span>
        </button>
        <button
          className={filter === "critical" ? "active" : ""}
          onClick={() => setFilter("critical")}
        >
          Критические{" "}
          <span className="red-text">
            {alerts.filter((a) => a.severity === "critical").length}
          </span>
        </button>
        <button
          className={filter === "high" ? "active" : ""}
          onClick={() => setFilter("high")}
        >
          Высокие
        </button>
      </div>
      <div className="alert-list">
        {shown.length ? (
          shown.map((a) => (
            <button
              className={`alert-card ${a.severity}`}
              key={a.id}
              onClick={() => config.officialMode
                ? useUi.getState().selectVehicle(a.vehicleId, a.routeId)
                : useUi.getState().selectRoute(a.routeId)}
            >
              <div className="row-between">
                <div className="alert-title">
                  <TriangleAlert size={15} />
                  <strong>
                    {config.officialMode
                      ? `ТС ${a.vehicleId.replace("vehicle-", "")}`
                      : `Маршрут ${a.routeId}`}
                  </strong>
                </div>
                <span className="probability">
                  {config.csvMode
                    ? "CSV"
                    : config.dispatchApi && a.riskProbability === 0
                      ? "API"
                      : percent(a.riskProbability)}
                </span>
              </div>
              <div className="alert-main">
                <span>{a.eventType === "late_threshold" ? "Риск опоздания >2 мин" : a.title}</span>
                <strong>
                  {minutes(a.predictedDelaySec)}
                  <small> мин</small>
                </strong>
              </div>
              <div className="alert-location">
                <MapPin size={12} />
                {config.officialMode && a.targetTime && a.expectedArrivalAt
                  ? `План ${time(a.targetTime)} → ожидается ${time(a.expectedArrivalAt)}. ${a.modelStatus === "fallback" ? "ML недоступен; резервная оценка." : `Прогноз ${modelDisplayName(model.data)}.`}`
                  : a.description}
              </div>
              {config.officialMode && (
                <div className="alert-location">
                  <MapPin size={12} />
                  {`Участок: ${currentSegments.get(a.routeId) || "не определён"}. Возможная причина: ${a.suspectedCause || "пока не определена"}. ${a.suspectedCause ? `Признак: ${a.observedFactor || "телеметрия"}.` : ""}`}
                </div>
              )}
              {incidentTiming(a).event && (
                <div className="alert-location">{incidentTiming(a).event}</div>
              )}
              {incidentTiming(a).forecast && (
                <div className="alert-location">{incidentTiming(a).forecast}</div>
              )}
              <div className="alert-bottom">
                <span>
                  {config.officialMode && incidentTiming(a).warning
                    ? incidentTiming(a).warning
                    : config.officialMode
                    ? "К целевой остановке"
                    : "Прогноз через 15 мин"}
                </span>
                <span>
                  {config.officialMode && (a.eventLeadTimeSec != null || a.leadTimeSec != null) ? (
                    `Выдан ${time(a.createdAt)} · ${model.data?.mode === "official-ndtp" ? "UTC плана" : "часы CSV"}`
                  ) : config.csvMode || config.officialMode ? (
                    "Архив CSV"
                  ) : (
                    <>
                      {Math.max(
                        1,
                        Math.floor(
                          (now - new Date(a.createdAt).getTime()) / 60000,
                        ),
                      )}{" "}
                      мин назад
                    </>
                  )}{" "}
                  <ChevronRight size={13} />
                </span>
              </div>
            </button>
          ))
        ) : (
          <Empty
            title="Нет событий"
            description="Для выбранного уровня риска событий нет"
          />
        )}
      </div>
      <div className="alerts-foot">
        <CheckCheck size={14} />
        События обновляются автоматически
      </div>
    </Panel>
  );
}
