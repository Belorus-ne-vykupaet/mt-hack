import { config } from "../shared/config/env";
import { Radio, Activity } from "lucide-react";
import { useUi } from "../app/store";
import { horizonLabel } from "../shared/ui/format";
import { activeModel, modelDisplayName, useOfficialModelStatus } from "../entities/official-model-status";
export function Timeline({ compact = false }: { compact?: boolean }) {
  const ui = useUi();
  const model = useOfficialModelStatus();
  const forecastLabel = model.isError || model.data?.stale
    ? "Данные устарели"
    : model.data?.status === "fallback"
      ? "Резервная оценка"
      : model.data?.status === "no_targets"
        ? "Нет цели прогноза"
        : activeModel(model.data, model.isError)
          ? modelDisplayName()
          : "Ожидание прогноза";
  if (config.officialMode)
    return (
      <footer className="timeline official-timeline">
        <div className="timeline-caption">
          <strong>Прогноз к остановке · 10–15 минут</strong>
          <span>Целевая остановка выбирается автоматически по расписанию</span>
        </div>
        <div
          className="official-view-toggle"
          role="group"
          aria-label="Данные на карте"
        >
          <button
            className={ui.forecastOffsetMin === 0 ? "active" : ""}
            onClick={() => ui.set({ forecastOffsetMin: 0 })}
          >
            Текущая задержка
          </button>
          <button
            className={ui.forecastOffsetMin !== 0 ? "active" : ""}
            onClick={() => ui.set({ forecastOffsetMin: 15 })}
          >
            {forecastLabel}
          </button>
        </div>
        <span className="forecast-live">
          <Activity size={14} /> По мере поступления телеметрии
        </span>
      </footer>
    );
  return (
    <footer
      className={`timeline continuous-timeline ${compact ? "timeline-compact" : ""}`}
    >
      <div className="timeline-caption">
        <strong>Горизонт прогноза</strong>
        <span>{horizonLabel(ui.forecastOffsetMin)}</span>
      </div>
      <button
        className={`live-button ${ui.forecastOffsetMin === 0 ? "active" : ""}`}
        onClick={() => ui.set({ forecastOffsetMin: 0 })}
      >
        <Radio size={14} />
        Сейчас
      </button>
      <div className="timeline-track">
        <div className="timeline-top">
          <span>СЕЙЧАС</span>
          <span>ПРОГНОЗ</span>
        </div>
        <input
          aria-label="Горизонт прогноза в минутах"
          aria-valuetext={horizonLabel(ui.forecastOffsetMin)}
          type="range"
          min="0"
          max="15"
          step="0.01"
          value={ui.forecastOffsetMin}
          onChange={(e) =>
            ui.set({ forecastOffsetMin: Number(e.target.value) })
          }
        />
        <div className="timeline-ticks">
          {[0, 5, 10, 15].map((n) => (
            <button
              key={n}
              style={{ left: `${(n / 15) * 100}%` }}
              className={n === ui.forecastOffsetMin ? "active" : ""}
              onClick={() => ui.set({ forecastOffsetMin: n })}
            >
              {n === 0 ? "Сейчас" : `+${n} мин`}
            </button>
          ))}
        </div>
      </div>
      <span className="forecast-live">
        <Activity size={14} />
        Обновляется непрерывно
      </span>
    </footer>
  );
}
