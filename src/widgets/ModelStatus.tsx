import { BrainCircuit, AlertTriangle } from "lucide-react";
import { activeModel, modelDisplayName, useOfficialModelStatus } from "../entities/official-model-status";
import { config } from "../shared/config/env";
import "../styles/model-status.css";

function countForm(count: number | undefined, one: string, few: string, many: string) {
  if (count === undefined) return many;
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = count % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

export function ModelStatus() {
  const state = useOfficialModelStatus();
  if (!config.officialMode) return null;
  const s = state.data,
    ready = activeModel(s, state.isError);
  return (
    <section
      className={`model-status ${ready ? "" : "model-status-warning"}`}
      aria-label="Статус модели прогноза"
    >
      <div className="model-status-heading">
        {ready ? <BrainCircuit size={22} /> : <AlertTriangle size={22} />}
        <div>
          <strong>
            {ready
              ? `${modelDisplayName(s)} · ${s?.mode === "official-ndtp" ? "поток NDTP" : "официальный датасет"}`
              : s?.stale || state.isError
                ? "Данные прогноза устарели"
              : s?.status === "fallback"
                ? "Резервный прогноз · модель недоступна"
                : s?.status === "no_targets"
                  ? "Нет свежих данных с целью через 10–15 минут"
                  : "Проверяем связь с моделью"}
          </strong>
          <span>
            {s?.mode === "official-ndtp"
              ? "Поток NDTP"
              : "Воспроизведение архива"}{" "}
            · {s?.asOf?.replace("T", " ").slice(0, 19) || "—"} · {s?.mode === "official-ndtp"
              ? "UTC текущего плана"
              : "часы CSV, без перевода часового пояса"}
          </span>
        </div>
      </div>
      {s?.metrics && (
        <div className="model-status-metrics">
          <span>
            MAE на тестовом сплите <b>{s.metrics.maeSec.toFixed(1)} с</b>
          </span>
          <span>
            Базовый прогноз <b>{s.metrics.persistenceMaeSec.toFixed(1)} с</b>
          </span>
          <span>
            Обработка <b>{s.pipelineMs?.toFixed(0) || "—"} мс</b>
          </span>
        </div>
      )}
      <p className="fleet-coverage" aria-label="Полнота транспортных данных">
        <strong>{s?.locatedVehicles ?? "—"} {countForm(s?.locatedVehicles, "GPS-точка", "GPS-точки", "GPS-точек")} на карте</strong> · {s?.freshVehicles ?? "—"} {countForm(s?.freshVehicles, "свежая", "свежие", "свежих")} · {s?.staleVehicles ?? "—"} последних известных · {s?.predictedVehicles ?? "—"} с прогнозом
        <span>
          {s?.mode === "official-ndtp" ? "В потоке" : "В архиве"} {s?.totalVehicles ?? "—"} ТС: {s?.scheduledVehicles ?? "—"} с расписанием и {s?.contextVehicles ?? "—"} контекстных без него. По контекстным ТС прогноз не требуется.
        </span>
        <span>
          Среди ТС с расписанием: {s?.predictedVehicles ?? "—"} с прогнозом сейчас · {s?.scheduledWithoutTarget ?? "—"} без остановки через 10–15 минут · {s?.scheduledStale ?? "—"} с устаревшим GPS · {s?.scheduledWithoutPosition ?? "—"} без позиции.
        </span>
      </p>
      <details>
        <summary>Что предсказывает модель</summary>
        <p>
          Задержку конкретного автобуса на первой остановке с плановым прибытием
          через 10–15 минут и вероятность опоздания более 120 секунд.
          Используются только наблюдения, уже доступные к моменту прогноза.
          Вероятности отдельного классификатора пока не откалиброваны.
          Модель задержки выбрана по доступному тестовому сплиту; оценка на скрытых данных может отличаться.
        </p>
        <p>
          {s?.metrics?.trainRows} обучающих примеров · {s?.metrics?.testRows}{" "}
          тестовых. MAE — локальная ошибка в секундах, не балл платформы. В CSV
          нет номеров маршрутов: на карте показаны планы отдельных ТС и следы
          GPS. Причины в карточках — наблюдаемые факторы, а не доказанная
          причинность.
        </p>
        <p>
          Нагрузочный тест с 125 автобусами использует искусственные записи и не
          меняет этот архив. Линии на карте — справочные участки по дорогам OSM,
          построенные из выданного расписания или GPS; пробелы между несвязанными
          участками не соединяются. Старая GPS-точка отмечена серым маркером,
          а не автобусом: место ТС сейчас неизвестно. Без подходящей остановки или свежего GPS запись остаётся доступной, но не включается в
          прогноз. Серый цвет означает отсутствие прогноза, а не отсутствие задержки. При отказе ML используется текущая задержка, при потере связи
          сохраняется последнее состояние. Погода и учебные диспетчерские меры
          не меняют официальный прогноз.
        </p>
        {(s?.stale || state.isError) && (
          <p role="alert">
            Связь потеряна. Показаны последние доступные данные.
          </p>
        )}
      </details>
    </section>
  );
}
