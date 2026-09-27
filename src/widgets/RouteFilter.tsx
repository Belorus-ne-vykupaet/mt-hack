import { useEffect, useRef, useState } from "react";
import type { Route } from "../entities/models";
import { useUi } from "../app/store";
import { matchesSearch } from "../shared/lib/search";
import { config } from "../shared/config/env";
export function RouteFilter({ routes }: { routes: Route[] }) {
  const { routeFilters, set } = useUi();
  const [query, setQuery] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      ref={menu}
      className="route-filter"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.open = false;
      }}
    >
      <summary aria-label={config.officialMode ? "Фильтр по планам ТС" : "Фильтр по маршрутам"}>
        {routeFilters.length
          ? `${config.officialMode ? "Планы ТС" : "Маршруты"}: ${routeFilters.length}`
          : config.officialMode ? "Все планы ТС" : "Все маршруты"}
      </summary>
      <div className="route-filter-menu">
        <strong>{config.officialMode ? "Планы ТС с расписанием" : "Отслеживаемые маршруты"}</strong>
        <input
          aria-label={config.officialMode ? "Найти план ТС для отслеживания" : "Найти маршрут для отслеживания"}
          placeholder="Номер или название…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="text-button"
          onClick={() => set({ routeFilters: [] })}
        >
          {config.officialMode ? "Показать все планы ТС" : "Показать все маршруты"}
        </button>
        <div className="route-filter-options">
          {routes
            .filter((r) => matchesSearch(`${r.number} ${r.name}`, query))
            .map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  aria-label={`${config.officialMode ? "Отслеживать план ТС" : "Отслеживать маршрут"} ${r.number}`}
                  checked={routeFilters.includes(r.id)}
                  onChange={(e) =>
                    set({
                      routeFilters: e.target.checked
                        ? [...routeFilters, r.id]
                        : routeFilters.filter((id) => id !== r.id),
                    })
                  }
                />
                <span>
                  <b>{r.number}</b> {r.name}
                </span>
              </label>
            ))}
          {!routes.some((r) =>
            matchesSearch(`${r.number} ${r.name}`, query),
          ) && <p>{config.officialMode ? "План ТС не найден" : "Маршрут не найден"}</p>}
        </div>
        <small>Выберите несколько. Пустой выбор показывает всю сеть.</small>
      </div>
    </details>
  );
}
