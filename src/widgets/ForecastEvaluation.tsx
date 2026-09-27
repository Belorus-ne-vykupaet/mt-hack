import { useUi } from "../app/store";
import { pairedForecasts, useForecastEvaluation } from "../entities/forecast-evaluation";
import { Chart } from "../shared/ui/Chart";
import { Panel } from "../shared/ui/primitives";
import { time } from "../shared/ui/format";

const seconds = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value)} с`;

export function ForecastEvaluation() {
  const routeIds = useUi(s => s.routeFilters);
  const query = useForecastEvaluation(routeIds);
  const data = query.data;
  const pairs = data ? pairedForecasts(data) : [];
  return <Panel title="Факт и сохранённый прогноз" action={<span className="muted">К одной целевой остановке</span>}>
    <div className="forecast-evaluation" data-testid="forecast-evaluation">
      {query.isPending ? <p role="status">Загружаем журнал прогнозов…</p>
        : query.isError ? <p role="alert">Журнал временно недоступен. <button onClick={() => void query.refetch()}>Повторить</button></p>
        : data && <>
          <div className="evaluation-summary">
            <span>Подтверждено <strong>{data.summary.observed}</strong> из {data.summary.total}</span>
            <span>Средняя абсолютная ошибка <strong>{data.summary.maeSec === null ? "Нет подтверждённых прибытий" : `${data.summary.maeSec.toFixed(1)} с`}</strong></span>
            <span>До планового срока <strong>{data.summary.pending}</strong></span>
            <span>Ожидают наблюдения <strong>{data.summary.awaitingObservation}</strong></span>
          </div>
          {pairs.length > 0 ? <Chart height={220} label={`Факт и первый прогноз для ${pairs.length} подтверждённых прибытий`} option={{
            grid: { left: 48, right: 16, top: 38, bottom: 38 },
            legend: { top: 0, data: ["Факт", "Первый прогноз"], textStyle: { color: "#30382c" } },
            tooltip: { trigger: "axis", backgroundColor: "#ffffff", borderColor: "#d9ddd2", textStyle: { color: "#30382c" } },
            xAxis: { type: "category", data: pairs.map(row => `ТС ${row.vehicleId.replace("vehicle-", "")} · ${time(row.plannedAt)} · ${row.targetStopId}`),
              axisLabel: { color: "#818875", interval: Math.max(0, Math.ceil(pairs.length / 6) - 1), formatter: (_: string, index: number) => time(pairs[index].plannedAt) } },
            yAxis: { type: "value", name: "сек", axisLabel: { color: "#818875" }, splitLine: { lineStyle: { color: "#e6e9e0" } } },
            series: [
              { name: "Факт", type: "line", data: pairs.map(row => row.actualDelaySec), itemStyle: { color: "#36a8e9" }, connectNulls: false },
              { name: "Первый прогноз", type: "line", data: pairs.map(row => row.predictedDelaySec), itemStyle: { color: "#a88219" }, lineStyle: { type: "dashed" }, connectNulls: false },
            ],
          }} /> : <p className="evaluation-empty">{data.summary.total
            ? "Первые прогнозы сохранены. Сравнение появится после наблюдения прибытия на целевую остановку."
            : "Пока нет сохранённых прогнозов для выбранных планов."}</p>}
          {data.items.length > 0 && <div className="evaluation-table-scroll"><table className="evaluation-table">
            <caption>Последние прогнозы и исходы · {Math.min(12, data.items.length)} записей</caption>
            <thead><tr><th>ТС / цель</th><th>Первый прогноз</th><th>План</th><th>Горизонт</th><th>Прогноз</th><th>Факт</th><th>Ошибка</th></tr></thead>
            <tbody>{data.items.slice(0, 12).map(row => <tr key={`${row.vehicleId}:${row.targetStopId}`}>
              <th title={row.stopName}>{row.vehicleId.replace("vehicle-", "")}<small>{row.stopName}</small></th>
              <td>{time(row.issuedAt)}</td><td>{time(row.plannedAt)}</td><td>{(row.horizonSec / 60).toFixed(1)} мин</td>
              <td>{seconds(row.predictedDelaySec)}</td>
              <td title={row.actualArrivalAt ? `Прибытие ${time(row.actualArrivalAt)}; факт получен ${time(row.observedAt!)}` : undefined}>
                {row.status === "observed" ? seconds(row.actualDelaySec) : row.status === "pending" ? "Ожидается" : "Нет наблюдения"}
              </td><td>{row.absoluteErrorSec === null ? "—" : `${Math.round(row.absoluteErrorSec)} с`}</td>
            </tr>)}</tbody>
          </table></div>}
          <p className="evaluation-note">Первый успешный прогноз модели фиксируется за 10–15 минут до плана и сохраняется после перезапуска. Факт появляется только после наблюдения прибытия. Нет GPS — исход неизвестен. Резервные оценки в MAE не входят.</p>
        </>}
    </div>
  </Panel>;
}
