import { useUi } from "../app/store";
import { horizonLabel } from "../shared/ui/format";

export function Timeline({ compact = false }: { compact?: boolean }) {
  const ui = useUi();
  return (
    <footer className={`timeline continuous-timeline forecast-slider ${compact ? "timeline-compact" : ""}`}>
      <div className="timeline-track">
        <input
          aria-label="Горизонт прогноза в минутах"
          aria-valuetext={horizonLabel(ui.forecastOffsetMin)}
          type="range"
          min="0"
          max="15"
          step="0.01"
          value={ui.forecastOffsetMin}
          onInput={(e) => ui.set({ forecastOffsetMin: e.currentTarget.valueAsNumber })}
        />
        <div className="timeline-ticks">
          {[0, 5, 10, 15].map((n) => (
            <button
              key={n}
              style={{ left: `${(n / 15) * 100}%` }}
              className={n === ui.forecastOffsetMin ? "active" : ""}
              onClick={() => ui.set({ forecastOffsetMin: n })}
            >
              {n} мин
            </button>
          ))}
        </div>
      </div>
    </footer>
  );
}
