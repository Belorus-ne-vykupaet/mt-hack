import { ArrowRight, Route as RouteIcon } from "lucide-react";
import type { Route } from "../entities/models";
import type { DispatchRecommendation } from "../entities/dispatch-recommendations";
import { RouteBadge } from "../shared/ui/primitives";
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
            Сейчас → предлагается. Вверху — маршруты с большей суммарной
            задержкой.
          </p>
        </div>
        <span className="recommend-method">Подсказки по правилам</span>
      </div>
      <p className="recommend-explainer">
        Демодопущения: оборот 120 мин, стоянка 30 с, нижняя граница 20 с. Общий
        резерв распределяется между маршрутами. Это варианты для проверки,
        эффект на задержку моделью ещё не оценён.
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
                    <small>{item.stopName || "Нет данных об остановке"}</small>
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
                    <p>{item.reasons.join(" ")}</p>
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
