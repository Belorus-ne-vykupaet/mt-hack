/** Parameters of the dispatch rules. Defaults are demo assumptions, not carrier norms. */
export interface DispatchSettings {
  cycleMin: number;
  baseDwellSec: number;
  minDwellSec: number;
  maxHoldSec: number;
  lateSec: number;
  earlySec: number;
  bunchingRatio: number;
  gapRatio: number;
  deployMin: number;
  freshSec: number;
}
export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  cycleMin: 120,
  baseDwellSec: 30,
  minDwellSec: 20,
  maxHoldSec: 120,
  lateSec: 120,
  earlySec: 60,
  bunchingRatio: 0.6,
  gapRatio: 1.5,
  deployMin: 10,
  freshSec: 180,
};
export interface DispatchSettingField {
  key: keyof DispatchSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  source: string;
}
export const DISPATCH_SETTING_FIELDS: DispatchSettingField[] = [
  {
    key: "cycleMin",
    label: "Полный оборот",
    unit: "мин",
    min: 10,
    max: 360,
    step: 5,
    source:
      "Оба направления и отстой. Плановый интервал = оборот ÷ выпуск. Демодопущение.",
  },
  {
    key: "baseDwellSec",
    label: "Обычная стоянка",
    unit: "с",
    min: 5,
    max: 300,
    step: 5,
    source: "Средняя стоянка на остановке без вмешательства. Демодопущение.",
  },
  {
    key: "minDwellSec",
    label: "Минимальная стоянка",
    unit: "с",
    min: 5,
    max: 120,
    step: 5,
    source:
      "Ниже нельзя: посадка и высадка. Совпадает с минимумом учебного API.",
  },
  {
    key: "maxHoldSec",
    label: "Предельное удержание",
    unit: "с",
    min: 20,
    max: 300,
    step: 10,
    source:
      "Сколько автобус может стоять сверх графика на одной остановке. Демодопущение.",
  },
  {
    key: "lateSec",
    label: "Порог опоздания",
    unit: "с",
    min: 30,
    max: 600,
    step: 10,
    source:
      "Прогноз через 15 минут выше порога — автобус отстаёт. Совпадает с порогом цвета «Внимание».",
  },
  {
    key: "earlySec",
    label: "Порог опережения",
    unit: "с",
    min: 30,
    max: 600,
    step: 10,
    source: "Автобус раньше графика на столько — его придерживают. Демодопущение.",
  },
  {
    key: "bunchingRatio",
    label: "Слипание: интервал меньше",
    unit: "× плана",
    min: 0.2,
    max: 0.95,
    step: 0.05,
    source:
      "Доля планового интервала до впереди идущего автобуса. Демодопущение.",
  },
  {
    key: "gapRatio",
    label: "Разрыв: интервал больше",
    unit: "× плана",
    min: 1.1,
    max: 3,
    step: 0.1,
    source: "Доля планового интервала. Демодопущение.",
  },
  {
    key: "deployMin",
    label: "Выход резерва на линию",
    unit: "мин",
    min: 1,
    max: 60,
    step: 1,
    source:
      "Время от команды до появления резервного автобуса на маршруте. Демодопущение.",
  },
  {
    key: "freshSec",
    label: "Свежесть телеметрии",
    unit: "с",
    min: 30,
    max: 900,
    step: 30,
    source: "Старые сообщения не используются для подсказок.",
  },
];
export function normalizeSettings(
  input: Partial<DispatchSettings> | undefined,
): DispatchSettings {
  const result = { ...DEFAULT_DISPATCH_SETTINGS };
  for (const field of DISPATCH_SETTING_FIELDS) {
    const value = input?.[field.key];
    if (typeof value === "number" && Number.isFinite(value))
      result[field.key] = Math.min(field.max, Math.max(field.min, value));
  }
  if (result.minDwellSec > result.baseDwellSec)
    result.minDwellSec = result.baseDwellSec;
  if (result.gapRatio <= result.bunchingRatio)
    result.gapRatio = DEFAULT_DISPATCH_SETTINGS.gapRatio;
  return result;
}
