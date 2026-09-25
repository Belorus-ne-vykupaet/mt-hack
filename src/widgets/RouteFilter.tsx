import { useEffect, useRef, useState } from "react";
import type { Route } from "../entities/models";
import { useUi } from "../app/store";
import { matchesSearch } from "../shared/lib/search";
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
      <summary aria-label="Фильтр по маршрутам">
        {routeFilters.length
          ? `Маршруты: ${routeFilters.length}`
          : "Все маршруты"}
      </summary>
      <div className="route-filter-menu">
        <strong>Отслеживаемые маршруты</strong>
        <input
          aria-label="Найти маршрут для отслеживания"
          placeholder="Номер или название…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="text-button"
          onClick={() => set({ routeFilters: [] })}
        >
          Показать все маршруты
        </button>
        <div className="route-filter-options">
          {routes
            .filter((r) => matchesSearch(`${r.number} ${r.name}`, query))
            .map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  aria-label={`Отслеживать маршрут ${r.number}`}
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
          ) && <p>Маршрут не найден</p>}
        </div>
        <small>Выберите несколько. Пустой выбор показывает всю сеть.</small>
      </div>
    </details>
  );
}
