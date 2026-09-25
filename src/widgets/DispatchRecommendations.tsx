import { ArrowRight, Route as RouteIcon } from "lucide-react";
import type { Route } from "../entities/models";
import type { DispatchRecommendation } from "../entities/dispatch-recommendations";
import { RouteBadge } from "../shared/ui/primitives";
import { useDispatchSettings } from "../app/dispatch-settings-store";
import { busLabel } from "../entities/dispatch-decisions";
import { deadlineLabel, urgency } from "./dispatch/decision-format";
const intervalLabel = (cycle: number | null, fleet: number, dwellDelta = 0) => {
  if (cycle === null || fleet < 1) return "—";
  const seconds = Math.round((cycle * 60 + dwellDelta) / fleet);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
export function RecommendationValue({
  before,
  after,
  unit = "",
}: {
  before: number | null;
  after: number | null;
  unit?: string;
}) {
  return (
    <span className="recommend-value">
      <span>
        {before ?? "—"}
        {before !== null && unit}
      </span>
      <ArrowRight size={13} />
      <strong className={before !== after ? "changed" : ""}>
        {after ?? "—"}
        {after !== null && unit}
      </strong>
    </span>
  );
}
export default function DispatchRecommendations({
  routes,
  items,
  onChoose,
}: {
  routes: Route[];
  items: DispatchRecommendation[];
  onChoose: (item: DispatchRecommendation) => void;
}) {
  const settings = useDispatchSettings((s) => s.settings);
  return (
    <section
      className="dispatch-recommendations"
      aria-label="Автоподсказки по маршрутам"
    >
      <div className="recommend-heading">
        <div>
          <span className="dispatch-eyebrow">
            <RouteIcon size={14} /> ПОДСКАЗКИ ПО МАРШРУТАМ
          </span>
          <h3>Что изменить на каждом маршруте</h3>
          <p>
            Сейчас → предлагается. Вверху — самые срочные и серьёзные
            решения.
          </p>
        </div>
        <span className="recommend-method">Подсказки по правилам</span>
      </div>
      <p className="recommend-explainer">
        Демодопущения: оборот {settings.cycleMin} мин, стоянка{" "}
        {settings.baseDwellSec} с, нижняя граница {settings.minDwellSec} с,
        удержание до {settings.maxHoldSec} с. Общий резерв распределяется между
        маршрутами. Эффект посчитан по правилу, не ML-моделью; параметры
        меняются в «Параметрах правил».
      </p>
      <div
        className="recommend-table-wrap"
        tabIndex={0}
        aria-label="Список рекомендаций, прокручивается"
      >
        <table className="recommend-table">
          <thead>
            <tr>
              <th>Маршрут / прогноз +15 мин</th>
              <th>Автобусы</th>
              <th>Стоянка, с</th>
              <th>Интервал, мин:с</th>
              <th>Почему / действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const route = routes.find((r) => r.id === item.routeId)!;
              return (
                <tr key={item.routeId} data-recommendation-route={item.routeId}>
                  <td data-label="Маршрут">
                    <RouteBadge number={route.number} risk={route.riskLevel} />
                    <small>
                      {item.predictedDelaySec === null
                        ? "Нет свежего прогноза"
                        : `${item.predictedDelaySec > 0 ? "+" : ""}${(item.predictedDelaySec / 60).toFixed(1)} мин`}
                    </small>
                  </td>
                  <td data-label="Автобусы">
                    <RecommendationValue
                      before={item.currentFleet}
                      after={item.targetFleet}
                    />
                  </td>
                  <td data-label="Стоянка, с">
                    <RecommendationValue
                      before={item.currentDwellSec}
                      after={item.targetDwellSec}
                    />
                    <small>
                      {item.vehicleId ? `${busLabel(item.vehicleId)} · ` : ""}
                      {item.stopName || "Нет данных об остановке"}
                      {item.dwellStops && item.dwellStops > 1
                        ? ` · ${item.dwellStops} ост.`
                        : ""}
                    </small>
                  </td>
                  <td data-label="Интервал, мин:с">
                    <span className="recommend-value">
                      {intervalLabel(item.cycleMin, item.currentFleet)}
                      <ArrowRight size={13} />
                      <strong>
                        {intervalLabel(
                          item.cycleMin,
                          item.targetFleet,
                          (item.targetDwellSec || 0) -
                            (item.currentDwellSec || 0),
                        )}
                      </strong>
                    </span>
                    <small>Расчёт равномерного выпуска</small>
                  </td>
                  <td data-label="Причина">
                    {item.decisions?.length ? (
                      <ul className="recommend-actions">
                        {item.decisions.map((d, i) => (
                          <li key={d.id}>
                            <strong>{d.title}</strong>
                            <span
                              className={`decision-deadline ${urgency(d)}`}
                            >
                              {deadlineLabel(d)}
                            </span>
                            {i === 0 && <small>{d.summary}</small>}
                          </li>
                        ))}
                        {item.reasons
                          .filter((r) => r.startsWith("Свободный резерв"))
                          .map((r) => (
                            <li key={r}>
                              <small>{r}</small>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p>{item.reasons.join(" ")}</p>
                    )}
                    <button
                      className="text-button"
                      disabled={item.status !== "suggested"}
                      onClick={() => onChoose(item)}
                      aria-label={`Подставить подсказки маршрута ${route.number}`}
                    >
                      {item.status === "suggested"
                        ? "Подставить в план"
                        : item.status === "active"
                          ? "Уже применён"
                          : item.status === "unavailable"
                            ? "Недостаточно данных"
                            : "Без изменений"}
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
