import { ChevronDown, PencilLine, RotateCcw, Settings2 } from "lucide-react";
import { useDispatchSettings } from "../../app/dispatch-settings-store";
import {
  DEFAULT_DISPATCH_SETTINGS,
  DISPATCH_SETTING_FIELDS,
} from "../../entities/dispatch-settings";

/** Every number the rules use, with where it comes from. Stored in this browser only. */
export function DispatchSettingsPanel({ apiMode }: { apiMode: boolean }) {
  const { settings, update, reset } = useDispatchSettings();
  const changed = DISPATCH_SETTING_FIELDS.filter(
    (f) => settings[f.key] !== DEFAULT_DISPATCH_SETTINGS[f.key],
  ).length;
  return (
    <details className="dispatch-settings">
      <summary>
        <Settings2 size={16} />
        <span>Параметры правил</span>
        <small>
          {changed
            ? `изменено: ${changed}`
            : "настройте пороги и времена"}
        </small>
        <strong><PencilLine size={14}/> Изменить <ChevronDown size={14}/></strong>
      </summary>
      <p>
        Все пороги и времена, по которым формируются подсказки.
        {apiMode
          ? " В режиме API подсказки считает сервер по своим параметрам; здесь они влияют только на ручную форму."
          : " Изменения сразу пересчитывают подсказки и хранятся только в этом браузере."}
      </p>
      <div className="dispatch-settings-grid">
        {DISPATCH_SETTING_FIELDS.map((f) => (
          <label key={f.key} className="dispatch-field">
            <span>
              {f.label}, {f.unit}
            </span>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={settings[f.key]}
              aria-label={`${f.label}, ${f.unit}`}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (Number.isFinite(value)) update({ [f.key]: value });
              }}
            />
            <small>{f.source}</small>
          </label>
        ))}
      </div>
      <button className="text-button" onClick={reset} disabled={!changed}>
        <RotateCcw size={14} />
        Вернуть значения по умолчанию
      </button>
    </details>
  );
}
