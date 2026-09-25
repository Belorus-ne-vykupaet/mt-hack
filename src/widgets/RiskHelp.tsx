import { useState } from "react";
import { Info, X } from "lucide-react";
import { Dialog } from "../shared/ui/Dialog";
import { riskInk } from "../shared/ui/format";
import { config } from "../shared/config/env";
export function RiskHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="text-button risk-help-button"
        onClick={() => setOpen(true)}
      >
        <Info size={15} />
        Как читать риски
      </button>
      {open && (
        <Dialog label="Как читать риски" onClose={() => setOpen(false)}>
          <section className="risk-help-content">
            <header>
              <h2>Как читать риски</h2>
              <button
                className="icon-button"
                aria-label="Закрыть пояснение рисков"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              {config.officialMode
                ? "Цвет показывает прогнозируемую задержку к целевой остановке через 10–15 минут. Переключатель позволяет сравнить её с текущей задержкой."
                : "Цвет показывает уровень задержки. На карте он меняется вместе с выбранным горизонтом; в списках указан прогноз на 15 минут."}
            </p>
            <ul>
              {(
                [
                  ["normal", "Норма", "менее 2 минут"],
                  ["elevated", "Внимание", "от 2 до 4 минут"],
                  ["high", "Высокий", "от 4 до 7 минут"],
                  ["critical", "Критический", "от 7 минут"],
                ] as const
              ).map(([risk, label, text]) => (
                <li key={risk}>
                  <i style={{ background: riskInk[risk] }} />
                  <strong>{label}</strong>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
            <p>
              {config.officialMode
                ? "По условию опоздание — более 120 секунд, раннее прибытие — менее −60 секунд. Границы 4 и 7 минут введены для приоритета диспетчерских событий, а не для оценки модели."
                : "Это пороги демонстрационного сценария. Подключённый сервис может передавать собственные уровни риска."}
            </p>
            <p>
              Маршрут показывает наибольший риск среди его участков и автобусов.
              Красный участок не означает, что задерживается весь маршрут. Цвет
              кольца под автобусом обозначает маршрут, а не риск.
            </p>
            <p>
              Высота столбца в 3D — задержка у остановки. Наведите на столбец,
              чтобы увидеть название и величину задержки.
            </p>
            <p>
              {config.officialMode
                ? "Проценты — результат отдельного CatBoost-классификатора для опоздания более 120 секунд. Вероятности пока не откалиброваны; это не точность модели. При отказе ML вероятность не оценена."
                : config.dataSource === "mock"
                  ? "Проценты в демо — условная вероятность задержки, а не измеренная точность ML-модели."
                  : "Проценты — вероятность задержки, переданная подключённым сервисом; это не точность модели."}
            </p>
          </section>
        </Dialog>
      )}
    </>
  );
}
