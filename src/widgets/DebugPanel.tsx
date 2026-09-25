import { useState } from "react";
import { simulation } from "../mocks/scenario";
import type { Scenario } from "../mocks/scenario";
import { resync } from "../entities/queries";
import { useConnection } from "../app/store";
export default function DebugPanel() {
  const [, refresh] = useState(0);
  const update = () => refresh((x) => x + 1);
  return (
    <div className="debug-panel">
      <h3>Сценарий демонстрации</h3>
      <select
        aria-label="Демосценарий"
        value={simulation.scenario}
        onChange={(e) => {
          simulation.scenario = e.target.value as Scenario;
          simulation.seconds = 0;
          void resync();
          update();
        }}
      >
        <option value="route-primary-delay">Задержка маршрута м3</option>
        <option value="normal">Штатная работа</option>
        <option value="rush-hour">Час пик</option>
        <option value="network-disruption">Сбой в сети</option>
        <option value="recovery">Восстановление</option>
      </select>
      <div className="debug-buttons">
        <button
          onClick={() => {
            simulation.paused = !simulation.paused;
            update();
          }}
        >
          {simulation.paused ? "Продолжить" : "Пауза"}
        </button>
        <button
          onClick={() => {
            simulation.seconds = 0;
            void resync();
            update();
          }}
        >
          Сбросить
        </button>
        <select
          aria-label="Скорость демосценария"
          value={simulation.speed}
          onChange={(e) => {
            simulation.speed = Number(e.target.value);
            update();
          }}
        >
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <label>
        <input
          type="checkbox"
          checked={simulation.offline}
          onChange={(e) => {
            simulation.offline = e.target.checked;
            useConnection
              .getState()
              .set(e.target.checked ? "offline" : "reconnecting");
            if (!e.target.checked) void resync();
            update();
          }}
        />
        Отключить поток
      </label>
      <label>
        <input
          type="checkbox"
          checked={simulation.error}
          onChange={(e) => {
            simulation.error = e.target.checked;
            void resync().catch(() => {});
            update();
          }}
        />
        Ошибка сервиса
      </label>
    </div>
  );
}
