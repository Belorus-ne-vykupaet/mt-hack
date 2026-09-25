import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, AlertTriangle } from "lucide-react";
import { integrationRequest } from "../shared/api/integrations";
import { config } from "../shared/config/env";
import "../styles/model-status.css";
interface Status {
  mode: string;
  status: string;
  stale?: boolean;
  asOf?: string;
  modelVersion?: string;
  pipelineMs?: number;
  inferenceMs?: number;
  predictedVehicles?: number;
  locatedVehicles?: number;
  freshVehicles?: number;
  staleVehicles?: number;
  totalVehicles?: number;
  scheduledVehicles?: number;
  contextVehicles?: number;
  scheduledWithoutPosition?: number;
  scheduledStale?: number;
  scheduledWithoutTarget?: number;
  metrics?: {
    maeSec: number;
    persistenceMaeSec: number;
    trainRows: number;
    testRows: number;
  };
  ndtp?: { frames: number; connections: number };
}
const loadStatus = () => integrationRequest<Status>("/ml/status");
export function ModelStatus() {
  const state = useQuery({
    queryKey: ["official-model-status"],
    queryFn: loadStatus,
    enabled: config.officialMode,
    refetchInterval: 5000,
    retry: false,
  });
  if (!config.officialMode) return null;
  const s = state.data,
    ready = s?.status === "connected" && !s.stale && !state.isError;
  return (
    <section
      className={`model-status ${ready ? "" : "model-status-warning"}`}
      aria-label="Статус модели CatBoost"
    >
      <div className="model-status-heading">
        {ready ? <BrainCircuit size={22} /> : <AlertTriangle size={22} />}
        <div>
          <strong>
            {ready
              ? "CatBoost · официальный датасет"
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
            · {s?.asOf?.replace("T", " ").slice(0, 19) || "—"} · часы CSV, без
            перевода часового пояса
          </span>
        </div>
      </div>
      {s?.metrics && (
        <div className="model-status-metrics">
          <span>
            MAE на тесте <b>{s.metrics.maeSec.toFixed(1)} с</b>
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
        <strong>{s?.locatedVehicles ?? "—"} GPS-точек на карте</strong> · {s?.freshVehicles ?? "—"} свежих · {s?.staleVehicles ?? "—"} последних известных · {s?.predictedVehicles ?? "—"} с прогнозом
        <span>
          В архиве {s?.totalVehicles ?? "—"} ТС: {s?.scheduledVehicles ?? "—"} с расписанием и {s?.contextVehicles ?? "—"} контекстных без него. По контекстным ТС прогноз не требуется.
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
